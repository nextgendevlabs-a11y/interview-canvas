# Interview Canvas Backend

FastAPI implementation of the root `openapi.yaml` contract, backed by SQLAlchemy.

## Run

```powershell
uv sync
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 8091
```

The server reads `DATABASE_URL` for its SQLAlchemy connection string. It defaults to `sqlite:///./interview_canvas.db`.
For example, in PowerShell:

```powershell
$env:DATABASE_URL = "sqlite:///./interview_canvas.db"
```

Or on Windows:

```powershell
.\run.ps1
.\run.ps1 -Port 8000
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

An empty database is initialized with demo data:

- Email: `demo@interview.dev`
- Password: `password`

The demo account owns seeded draft and live sessions with participants, guest links, and canvas content.
