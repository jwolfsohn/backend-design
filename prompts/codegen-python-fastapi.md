# Codegen — Python + FastAPI + SQLAlchemy + Postgres

Scaffold a Python backend. Authoritative spec is in `.backend-design/state/`:

- `entities.json` → SQLAlchemy models in `app/models/`
- `relationships.json` → SQLAlchemy `relationship()` + `ForeignKey()` directives
- `endpoints.json` → one route per entry, organized by resource router
- `auth.json` → JWT auth dependency + `/auth/*` routes
- `config.json` → output directory (default `./backend`)

## Layout

```
backend/
  pyproject.toml          # uv-friendly, declares deps + entry point
  alembic.ini
  alembic/
    env.py
    versions/             # generated migrations
  app/
    __init__.py
    main.py               # FastAPI app, includes routers
    db.py                 # SQLAlchemy engine, SessionLocal, Base
    deps.py               # get_db(), get_current_user()
    models/
      __init__.py
      <resource>.py       # SQLAlchemy ORM classes
    schemas/
      <resource>.py       # Pydantic v2 request/response models
    routers/
      <resource>.py       # APIRouter with endpoints
      auth.py             # /auth/signup, /auth/login, /auth/logout
    lib/
      jwt.py              # create_access_token, decode_token
      password.py         # bcrypt via passlib
  .env.example
  README.md
```

## Constraints

- Python 3.11+
- FastAPI 0.110+
- SQLAlchemy 2.0+ (with the new typed `Mapped[]` syntax)
- Pydantic v2
- Alembic for migrations (do not use `Base.metadata.create_all` in prod paths)
- `python-jose[cryptography]` for JWT
- `passlib[bcrypt]` for password hashing (cost from `auth.json -> bcrypt_cost`)
- Use `uv` in the README for dep management (or `pip` as fallback)
- Each `routers/<resource>.py` exports `router = APIRouter(prefix="/posts", tags=["posts"])`
- `main.py` includes each router via `app.include_router(...)`
- Protected endpoints use `Depends(get_current_user)`
- Pydantic schemas drive both validation (request) and serialization (response). Mirror the input validation from `endpoints[].request_body` and `forms.json -> forms[].inputs[].validation`.
- Return models should set `model_config = ConfigDict(from_attributes=True)` so they serialize SQLAlchemy ORM objects.
- Do not implement endpoints not in `endpoints.json`. Do not invent fields not in `entities.json`.

## Type mapping (entities.json → SQLAlchemy)

| entities.json type | SQLAlchemy |
|--------------------|------------|
| `uuid` (pk)        | `Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)` |
| `text`             | `Mapped[str] = mapped_column(String)` |
| `int`              | `Mapped[int] = mapped_column(Integer)` |
| `boolean`          | `Mapped[bool] = mapped_column(Boolean)` |
| `timestamptz`      | `Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())` |

## README run commands

```
uv venv && source .venv/bin/activate
uv pip install -e .
cp .env.example .env             # fill in DATABASE_URL and JWT_SECRET
alembic upgrade head             # apply migrations
uvicorn app.main:app --reload
```

## Verification

1. `uv pip install -e .` succeeds (or `pip install -e .`)
2. `alembic check` runs without import errors
3. `python -c "from app.main import app"` imports cleanly (catches model and router import errors)
