from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app, store


def client() -> TestClient:
    store.reset(seed=True)
    return TestClient(app)


def auth_headers(api: TestClient, email: str = "demo@interview.dev", password: str = "password") -> dict[str, str]:
    response = api.post("/v1/auth/sign-in", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_seeded_dashboard_sessions_are_available() -> None:
    api = client()
    response = api.get("/v1/sessions", headers=auth_headers(api))
    assert response.status_code == 200
    sessions = response.json()
    assert len(sessions) >= 2
    assert {session["state"] for session in sessions} >= {"draft", "live"}


def test_sign_up_hashes_password_and_issues_bearer_token() -> None:
    api = client()
    response = api.post(
        "/v1/auth/sign-up",
        json={"email": "new@example.com", "password": "secret", "display_name": "New User"},
    )
    assert response.status_code == 201
    body = response.json()
    assert body["token"]
    user_id = body["user"]["id"]
    assert store.password_hashes[user_id] != "secret"
    assert store.password_hashes[user_id].startswith("pbkdf2_sha256$")


def test_authenticated_session_lifecycle_and_canvas() -> None:
    api = client()
    headers = auth_headers(api)
    created = api.post(
        "/v1/sessions",
        headers=headers,
        json={"title": "Design Search", "prompt": "Indexing and ranking", "scheduled_at": None},
    )
    assert created.status_code == 201
    session_id = created.json()["id"]

    started = api.post(f"/v1/sessions/{session_id}/start", headers=headers)
    assert started.status_code == 200
    assert started.json()["state"] == "live"

    snapshot = {
        "schema_version": 1,
        "item_order": ["shape-1"],
        "items": {
            "shape-1": {
                "kind": "shape",
                "id": "shape-1",
                "shape_type": "service",
                "x": 10,
                "y": 20,
                "width": 160,
                "height": 80,
                "label": "API",
                "description": "",
                "color": "#3b82f6",
                "z": 1,
            }
        },
    }
    saved = api.put(f"/v1/sessions/{session_id}/canvas", headers=headers, json=snapshot)
    assert saved.status_code == 204
    loaded = api.get(f"/v1/sessions/{session_id}/canvas", headers=headers)
    assert loaded.status_code == 200
    assert loaded.json()["items"]["shape-1"]["label"] == "API"


def test_guest_link_validate_join_and_participant_canvas_auth() -> None:
    api = client()
    headers = auth_headers(api)
    session = api.post("/v1/sessions", headers=headers, json={"title": "Guest Flow", "prompt": ""}).json()
    link_response = api.post(f"/v1/sessions/{session['id']}/guest-links", headers=headers, json={"role": "candidate"})
    assert link_response.status_code == 201
    token = link_response.json()["token"]

    validated = api.post(f"/v1/join/{token}/validate")
    assert validated.status_code == 200
    assert validated.json()["session_id"] == session["id"]

    joined = api.post(f"/v1/join/{token}", json={"display_name": "Candidate One"})
    assert joined.status_code == 200
    participant_token = joined.json()["participant_token"]
    canvas = api.get(f"/v1/sessions/{session['id']}/canvas", headers={"X-Participant-Token": participant_token})
    assert canvas.status_code == 200


def test_owner_only_endpoints_reject_missing_or_wrong_auth() -> None:
    api = client()
    headers = auth_headers(api)
    session = api.post("/v1/sessions", headers=headers, json={"title": "Private", "prompt": ""}).json()
    assert api.post(f"/v1/sessions/{session['id']}/archive").status_code == 401

    api.post("/v1/auth/sign-up", json={"email": "other@example.com", "password": "pw", "display_name": "Other"})
    other_headers = auth_headers(api, "other@example.com", "pw")
    forbidden = api.post(f"/v1/sessions/{session['id']}/archive", headers=other_headers)
    assert forbidden.status_code == 403


def test_websocket_room_join_and_document_update() -> None:
    api = client()
    headers = auth_headers(api)
    session = api.post("/v1/sessions", headers=headers, json={"title": "Socket", "prompt": ""}).json()
    link = api.post(f"/v1/sessions/{session['id']}/guest-links", headers=headers, json={}).json()
    joined = api.post(f"/v1/join/{link['token']}", json={"display_name": "Candidate"}).json()
    participant_id = joined["participant"]["id"]

    participant_token = joined["participant_token"]

    with api.websocket_connect(
        f"/v1/ws/sessions/{session['id']}?participant_id={participant_id}&participant_token={participant_token}"
    ) as ws:
        initial = ws.receive_json()
        assert initial["type"] == "room_joined"
        ws.send_json(
            {
                "type": "document_update",
                "session_id": session["id"],
                "operation": {
                    "op": "add",
                    "item": {
                        "kind": "sticky",
                        "id": "note-1",
                        "x": 0,
                        "y": 0,
                        "width": 120,
                        "height": 120,
                        "text": "hello",
                        "color": "#fde68a",
                        "z": 1,
                    },
                },
            }
        )

    loaded = api.get(f"/v1/sessions/{session['id']}/canvas", headers={"X-Participant-Token": participant_token})
    assert loaded.json()["items"]["note-1"]["text"] == "hello"


def test_websocket_document_update_reaches_other_clients() -> None:
    api = client()
    headers = auth_headers(api)
    session = api.post("/v1/sessions", headers=headers, json={"title": "Socket Broadcast", "prompt": ""}).json()
    link = api.post(f"/v1/sessions/{session['id']}/guest-links", headers=headers, json={}).json()
    joined = api.post(f"/v1/join/{link['token']}", json={"display_name": "Candidate"}).json()
    participant_id = joined["participant"]["id"]
    participant_token = joined["participant_token"]
    owner_token = headers["Authorization"].split(" ", 1)[1]

    owner_url = f"/v1/ws/sessions/{session['id']}?participant_id=owner&access_token={owner_token}"
    candidate_url = f"/v1/ws/sessions/{session['id']}?participant_id={participant_id}&participant_token={participant_token}"

    with api.websocket_connect(owner_url) as owner_ws, api.websocket_connect(candidate_url) as candidate_ws:
        assert owner_ws.receive_json()["type"] == "room_joined"
        assert candidate_ws.receive_json()["type"] == "room_joined"

        owner_ws.send_json(
            {
                "type": "document_update",
                "session_id": session["id"],
                "operation": {
                    "op": "add",
                    "item": {
                        "kind": "sticky",
                        "id": "note-2",
                        "x": 10,
                        "y": 20,
                        "width": 120,
                        "height": 120,
                        "text": "broadcast",
                        "color": "#fde68a",
                        "z": 1,
                    },
                },
            }
        )

        update = candidate_ws.receive_json()
        assert update["type"] == "document_update"
        assert update["operation"]["item"]["id"] == "note-2"
