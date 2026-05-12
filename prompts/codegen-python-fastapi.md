# Codegen — Python + FastAPI + SQLAlchemy + Postgres

**Write every file under `config.output_dir`** from `.backend-design/config.json` (default `./backend`). The layout below uses `backend/` as the placeholder — substitute the real value.

**If `auth.json.strategy === "none"`:** skip everything auth-related — do not create `app/lib/jwt.py`, `app/lib/password.py`, the `app/routers/auth.py` file, or the `User` model unless it appears in `entities.json` for a non-auth reason. Drop `python-jose` and `bcrypt` from dependencies. Do not add `JWT_SECRET` to `.env.example`. Do not include `get_current_user` in `app/deps.py`. No endpoint may use `Depends(get_current_user)`.

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
- `bcrypt>=4.0,<5.0` for password hashing (cost from `auth.json -> bcrypt_cost`). Use `bcrypt` directly — do not use `passlib`, which is unmaintained and has a known incompatibility with bcrypt 4.x (`AttributeError: module 'bcrypt' has no attribute '__about__'`).
- **Extended auth flows** (per `auth.json` flags): `PasswordReset` model + `app/routers/auth.py` endpoints `/auth/password-reset/request` and `/auth/password-reset/confirm`; `email_verified_at` column on `User` + `/auth/verify-email`; OAuth `start`/`callback` per provider as additional FastAPI routes. `app/lib/email.py` stub uses `print` / `logger.info`. Add per-provider `<PROVIDER>_CLIENT_ID` / `_SECRET` to `.env.example`.
- Use `uv` in the README for dep management (or `pip` as fallback)
- Each `routers/<resource>.py` exports `router = APIRouter(prefix="/posts", tags=["posts"])`
- `main.py` includes each router via `app.include_router(...)`
- Protected endpoints use `Depends(get_current_user)`
- **RBAC**: when an endpoint has `required_role`, add `Depends(require_role("admin"))` (or the allowed roles list). `require_role` is a factory in `app/deps.py` returning a callable that raises `HTTPException(403)` on mismatch. The `User` model must have a `role: Mapped[str]` column.
- **List endpoints**: declare query params as typed function arguments (`limit: int = 20`, `cursor: str | None = None`, plus one optional per filterable field). For sort, use a constrained `Literal[...]` of whitelisted fields. Return `{"data": [...], "next_cursor": ...}` (cursor) or `{"data": [...], "total": ...}` (offset). Build SQLAlchemy queries with `.where(...)` and `.order_by(...)` from the validated params.
- **Nested-resource scoping**: path params come in as function arguments. Verify access to the parent (`SELECT ... WHERE id = :org_id AND ... member of current_user`) and raise `HTTPException(404)` on no access. Then filter the child query by `<parent>_id`.
- Pydantic schemas drive both validation (request) and serialization (response). Mirror the input validation from `endpoints[].request_body` and `forms.json -> forms[].inputs[].validation`.
- **Multipart endpoints** (`content_type: "multipart/form-data"`): use `UploadFile = File(...)` from `fastapi`, plus `Form(...)` for non-file fields. Enforce `content_type` against `accept` and check `len(await file.read())` against `max_size_mb * 1024 * 1024`. `app/lib/storage.py` stub `save_file(file: UploadFile, key: str) -> str` writes under `uploads/` with a `# TODO` for S3.
- **Placeholder endpoints** (any endpoint where `temporary: true`): scaffold per the rules in the "Placeholder endpoint scaffolding" section prepended above. Do NOT add a pydantic request model, attach `Depends(get_current_user)`, or touch SQLAlchemy on placeholder routes.
- **Webhook endpoints** (`is_webhook: true`): accept `request: Request` (FastAPI's `starlette.requests.Request`) and call `await request.body()` to get the raw bytes. Read the `signature_header`, verify against `os.environ["<WEBHOOK_SOURCE>_WEBHOOK_SECRET"]`. Return `Response(status_code=401)` on invalid, `{"ok": True}` on valid. Add the env var to `.env.example`.
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
