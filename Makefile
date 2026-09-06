.PHONY: help backend-sync backend-run backend-test frontend-install frontend-run frontend-test frontend-build test

help:
	@echo "Available targets:"
	@echo "  make backend-sync      Install/sync backend dependencies with uv"
	@echo "  make backend-run       Run the FastAPI backend on http://127.0.0.1:8000"
	@echo "  make backend-test      Run backend tests"
	@echo "  make frontend-install  Install frontend npm dependencies"
	@echo "  make frontend-run      Run the Vite frontend on http://127.0.0.1:5173"
	@echo "  make frontend-test     Run frontend tests"
	@echo "  make frontend-build    Build the frontend"
	@echo "  make test              Run backend and frontend tests"

backend-sync:
	cd backend && uv sync

backend-run:
	cd backend && uv run uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

backend-test:
	cd backend && uv run pytest

frontend-install:
	cd frontend && npm install

frontend-run:
	cd frontend && npm run dev -- --host 127.0.0.1 --port 5173

frontend-test:
	cd frontend && npm test

frontend-build:
	cd frontend && npm run build

test: backend-test frontend-test
