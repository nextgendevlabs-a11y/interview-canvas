# Interview Canvas Backend

FastAPI implementation of the root `openapi.yaml` contract, backed by an in-memory store.

## Run

```powershell
uv sync
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Or on Windows:

```powershell
.\run.ps1
.\run.ps1 -Port 8091
```

## Test

```powershell
uv run pytest
```

Or on Windows:

```powershell
.\test.ps1
```

## Seed Data

The store resets on process restart and starts with demo data:

- Email: `demo@interview.dev`
- Password: `password`

The demo account owns seeded draft and live sessions with participants, guest links, and canvas content.
