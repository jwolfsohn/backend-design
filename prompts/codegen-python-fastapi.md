# Codegen — Python + FastAPI + SQLAlchemy + Postgres

**Write every file under `config.output_dir`** from `.backend-design/config.json` (default `./backend`). The layout below uses `backend/` as the placeholder — substitute the real value.

**If `auth.json.strategy === "none"`:** skip everything auth-related — do not create `app/lib/jwt.py`, `app/lib/password.py`, the `app/routers/auth.py` file, or the `User` model unless it appears in `entities.json` for a non-auth reason. Drop `python-jose` and `bcrypt` from dependencies. Do not add `JWT_SECRET` to `.env.example`. Do not include `get_current_user` in `app/deps.py`. No endpoint may use `Depends(get_current_user)`.

**If `auth.json.strategy === "session"`:** follow the "Cookie sessions + CSRF" section below instead of the JWT path. Mutually exclusive with `jwt`.

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

## Best-practice column semantics

Every entity in `entities.json` carries `deleted_at`, `version`, and (when a `users` entity exists) `created_by`, `updated_by`. Handlers must respect them:

- **Soft delete (`deleted_at`)**: every list and detail query filters with `.where(<Model>.deleted_at.is_(None))`. `DELETE /<resource>/{id}` sets `obj.deleted_at = func.now()` (after `session.get`) and commits — do NOT issue `session.delete(obj)`. No restore endpoint.
- **Optimistic locking (`version`)**: prefer SQLAlchemy 2.0's built-in optimistic concurrency by adding `__mapper_args__ = {"version_id_col": <Model>.version}` on every soft-deletable model. SQLAlchemy will auto-increment on update and raise `StaleDataError` on mismatch. In PATCH handlers, if the request has an `If-Match` header, parse to int and assign `obj.version = parsed_int` (the mapper raises if stale); catch `StaleDataError` and return `HTTPException(status_code=409, detail={"error": "version_conflict", "current_version": <current>})` after a re-fetch. Pydantic response models include `version`.
- **Audit columns (`created_by`, `updated_by`)**: in POST handlers set both to `current_user.id` (from `Depends(get_current_user)`). In PATCH set `updated_by` only. Endpoints with `auth: "none"` omit both.
- **Partial unique indexes for soft-deletable entities**: emit `Index("ix_<table>_<col>_active_unique", "<col>", unique=True, postgresql_where=text("deleted_at IS NULL"))` in the model's `__table_args__` instead of a column-level `unique=True`. Required so re-creating soft-deleted rows doesn't collide.
- **Placeholder routes (`temporary: true`)** never touch the DB.
- **Webhook routes** typically have no `current_user`; leave `created_by`/`updated_by` as `None` when writes target audit-equipped entities.

## Type mapping (entities.json → SQLAlchemy)

| entities.json type | SQLAlchemy |
|--------------------|------------|
| `uuid` (pk)        | `Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)` |
| `text`             | `Mapped[str] = mapped_column(String)` |
| `int`              | `Mapped[int] = mapped_column(Integer)` |
| `boolean`          | `Mapped[bool] = mapped_column(Boolean)` |
| `timestamptz`      | `Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())` |

## Cookie sessions + CSRF (when `auth.strategy === "session"`)

Replaces JWT-specific instructions above. Mutually exclusive with `jwt`.

- **Skip** `app/lib/jwt.py`. Generate `app/lib/session.py` instead. Drop `python-jose` from `pyproject.toml`.
- **Deps** to add: `starsessions` (Starlette/FastAPI session middleware). Postgres store: `starsessions-sqlalchemy` if available; otherwise write a thin custom adapter at `app/lib/session_store.py` (~50 lines) implementing `async load(session_id) -> dict` and `async write(session_id, data, ttl) -> str` against the `Session` SQLAlchemy model. Redis store: `starsessions-redis` (or a small `redis.asyncio` adapter). Also add `fastapi-csrf-protect`.
- **`Session` SQLAlchemy model** (when `auth.store === "postgres"`) — from `entities.json`. Use `String` for `id` (session IDs are opaque strings), not `UUID`.
- **Middleware order** in `app/main.py`: CORS → `SecurityHeadersMiddleware` → `SessionMiddleware(store=...)` → routes. CSRF runs via FastAPI dependency on each mutating route (see below).
- **Session config:**
  ```python
  from starsessions import SessionMiddleware
  app.add_middleware(
      SessionMiddleware,
      store=session_store,  # PostgresStore or RedisStore
      cookie_name="sid",
      cookie_https_only=True,
      cookie_same_site="lax",
      cookie_secure=os.environ.get("NODE_ENV") == "production",
      lifetime=int(os.environ.get("SESSION_MAX_AGE_DAYS", "7")) * 86400,
  )
  ```
- **CSRF:** configure `CsrfProtect` once in `app/main.py` with `CsrfSettings(secret_key=os.environ["SESSION_SECRET"], cookie_secure=...)`. Add `Depends(csrf_protect.validate_csrf)` to every mutating route — POST/PATCH/PUT/DELETE — **except** webhooks (`is_webhook: true`).
- **Endpoints to generate** in `app/routers/auth.py`:
  - `POST /auth/signup` — hash password, insert user, `request.session.regenerate()`, `request.session["user_id"] = str(user.id)`, return user.
  - `POST /auth/login` — verify, regenerate, set user_id, return user.
  - `POST /auth/logout` — `await request.session.clear()` → `Response(status_code=204)`.
  - `GET /auth/csrf-token` — returns `{"csrfToken": csrf_protect.generate_csrf()}` and sets the corresponding cookie via the helper.
- **`get_current_user` dependency** (replaces JWT version): reads `request.session.get("user_id")`, 401 if absent, fetches the user row, returns it.
- **Startup event:** raise `RuntimeError` on missing `SESSION_SECRET` in production.
- **`.env.example`:** add `SESSION_SECRET`, `REDIS_URL` (only when `store === "redis"`), `SESSION_MAX_AGE_DAYS` (optional, commented).

## Security baseline (required)

In `app/main.py`, register these middlewares (order matters — CORS first, then rate limit, then security headers):

- `CORSMiddleware` from `fastapi.middleware.cors` with `allow_origins` parsed from `os.environ["ALLOWED_ORIGINS"].split(",")` (default `["http://localhost:3000"]`). `allow_credentials=True`. Set `allow_methods` and `allow_headers` to `["*"]`.
- `slowapi` rate limit: `from slowapi import Limiter, _rate_limit_exceeded_handler` and `from slowapi.util import get_remote_address`. Set `app.state.limiter = Limiter(key_func=get_remote_address, default_limits=[f"{os.environ.get('RATE_LIMIT_MAX', '1000')}/15 minutes"])`. Add `@limiter.limit(f"{os.environ.get('RATE_LIMIT_WRITE_MAX', '100')}/15 minutes")` decorator on every POST/PATCH/PUT/DELETE route.
- A `SecurityHeadersMiddleware` (custom, ~10 lines) that adds `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Frame-Options: DENY`.

Configure `structlog` in `app/lib/logging.py`: JSON renderer when `os.environ.get("LOG_LEVEL")` matches production-shaped values, console renderer in dev. Set log level from `LOG_LEVEL` (default `INFO`). Replace any `print()` calls in scaffolded code with `structlog` logger calls.

Startup event in `app/main.py`: if `os.environ.get("NODE_ENV") == "production"` (or `ENV == "production"` — adopt whichever is set in the project) and `ALLOWED_ORIGINS` is unset or contains `*`, raise `RuntimeError` at startup. Same for missing `JWT_SECRET` under JWT auth.

Add to `pyproject.toml` deps: `slowapi`, `structlog`. Remove `passlib` if previously listed (the existing brief already favors `bcrypt` directly).

Document new env vars (`ALLOWED_ORIGINS`, `LOG_LEVEL`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WRITE_MAX`) in `.env.example`.

## OpenAPI / Swagger UI (required)

FastAPI auto-generates its own OpenAPI spec from your Pydantic models and serves Swagger UI at `/docs` plus Redoc at `/redoc` out of the box. **Do not override `openapi_url` to serve the orchestrator's static file** — FastAPI's live spec is more accurate (it picks up any models or routes the developer adds after the initial scaffold). The orchestrator's static `./openapi.json` still gets written at the repo root for design-time reviewers (Stoplight, openapi-typescript, etc.) so two specs co-exist and that's intentional.

Tasks for codegen:

1. Document the divergence in `BACKEND_SETUP.md`:
   > Two OpenAPI specs exist:
   > - **`./openapi.json` (repo root)** — design-time contract emitted by backend-design from `.backend-design/state/`. Source of truth for the design doc and `npx openapi-typescript` clients.
   > - **`http://localhost:8000/openapi.json` / `/docs` / `/redoc`** — FastAPI's runtime spec, derived from your Pydantic models. Always reflects the current code.
   >
   > Re-run `node <SKILL_DIR>/scripts/render-openapi.mjs` to regenerate the static file after editing the design.
2. **Gate `/docs` and `/redoc` in production.** Add to `app/main.py`:
   ```python
   app = FastAPI(
       docs_url=None if os.environ.get("NODE_ENV") == "production" and not os.environ.get("OPENAPI_PUBLIC") else "/docs",
       redoc_url=None if os.environ.get("NODE_ENV") == "production" and not os.environ.get("OPENAPI_PUBLIC") else "/redoc",
   )
   ```
   When you need them in production, set `OPENAPI_PUBLIC=1` — opt-in only. Document this env var in `.env.example`.
3. No new dependencies.

## Tests (required)

Generate a `tests/` directory with pytest + httpx + `testcontainers[postgres]`.

Add to `pyproject.toml` dev dependencies: `pytest`, `pytest-asyncio`, `httpx`, `testcontainers[postgres]`.

Add a `pytest.ini`:

```ini
[pytest]
asyncio_mode = auto
testpaths = tests
```

Files:

- **`tests/conftest.py`** — `@pytest.fixture(scope="session")` that spins up a `PostgresContainer`, points `os.environ["DATABASE_URL"]` at it, runs `alembic upgrade head` via `subprocess.run(["alembic", "upgrade", "head"], check=True)`, and yields. Plus a function-scope `truncate` fixture that issues `TRUNCATE TABLE ... CASCADE` for every table after each test. Plus a `client` fixture yielding `TestClient(app)` from `fastapi.testclient`. Plus a `user_and_token` fixture that signs up a fixture user and returns `(user, token, {"Authorization": f"Bearer {token}"})`.
- **`tests/test_auth.py`** — under `auth.json.strategy === "jwt"`: signup → 201, login → 200 with token, protected route without token → 401, with valid token → 200. Under `strategy === "session"`: use `TestClient(app)` (its `cookies` jar persists across calls by default); assert signup sets a `sid` cookie; reuse the client to assert protected route reachable; assert `POST /auth/logout` → 204 and next request → 401; assert mutating route without `X-CSRF-Token` → 403 and with the right token (fetched from `GET /auth/csrf-token`) → 200/201.
- **`tests/test_<resource>.py`** — one per non-auth resource. List empty → `[]`, POST → 201 with `version: 1`, PATCH with `If-Match: 1` → 200 with `version: 2`, PATCH with stale `If-Match` → 409 with `current_version`, DELETE → 204, soft-deleted row excluded from subsequent list.

Skip tests for placeholder routes and webhook routes.

## README run commands

```
uv venv && source .venv/bin/activate
uv pip install -e .
cp .env.example .env             # fill in DATABASE_URL and JWT_SECRET
alembic upgrade head             # apply migrations
uvicorn app.main:app --reload
pytest                            # runs the suite against a testcontainer Postgres (needs Docker)
```

## Verification

1. `uv pip install -e .` succeeds (or `pip install -e .`)
2. `alembic check` runs without import errors
3. `python -c "from app.main import app"` imports cleanly (catches model and router import errors)
4. `pytest` passes (skip with "Docker not running" note if `docker info` fails)
