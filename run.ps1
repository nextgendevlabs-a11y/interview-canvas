param(
    [int]$Port = 8000
)

Set-Location -Path $PSScriptRoot\backend
uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port $Port
