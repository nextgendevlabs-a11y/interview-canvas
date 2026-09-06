param(
    [int]$Port = 8091
)

uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port $Port
