# Goal
Replace FastAPI with TurboAPI (a drop-in replacement, written in Zig, more performant): https://github.com/justrach/turboAPI

# Analysis
1. Python version — TurboAPI requires >=3.14; the backend currently declares >=3.11.
TurboAPI's peak performance needs the free-threaded build (3.14t), but regular Python 3.14 runs via the ASGI fallback, which is reportedly very slow (100x?).
We don't know what other impact degradations would be caused by the switch to free-threaded version.

2. fastapi-users has no TurboAPI equivalent — This is the largest single effort. Four files are completely woven around it:
┌───────────────────────┬───────┬──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ File                  │ Lines │ What must be replaced                                                                                                                    │
├───────────────────────┼───────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ auth/users.py         │ 110   │ FastAPIUsers, BaseUserManager, UUIDIDMixin, CookieTransport, JWTStrategy, SQLAlchemyUserDatabase, InvalidPasswordException               │
├───────────────────────┼───────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ api/routers/auth.py   │ 58    │ All routes are auto-generated via fastapi_users.get_auth_router(), get_register_router(), etc.                                           │
├───────────────────────┼───────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ db/user.py            │ 30    │ SQLAlchemyUserDatabase dependency factory                                                                                                │
├───────────────────────┼───────┼──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ schemas/user.py       │ 42    │ SQLAlchemyBaseUserTableUUID, SQLAlchemyBaseOAuthAccountTableUUID, fastapi_users.schemas                                                  │
└───────────────────────┴───────┴──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

These ~240 source lines must be replaced with ~400–600 lines of manual JWT/cookie auth (PyJWT + SQLAlchemy directly). The business logic inside UserManager (entitlements check,
first-user-becomes-superuser, domain allowlist) must be preserved.

3. sse-starlette / EventSourceResponse — gateway.py uses `sse_starlette.sse.EventSourceResponse` for SSE streaming. TurboAPI has StreamingResponse but not an SSE-specific class.
Needs a small custom EventSourceResponse wrapper (~15 lines) or an alternative SSE library.

4. StaticFiles / Jinja2Templates (Starlette) — entrypoint.py subclasses Starlette's StaticFiles for SPA routing and imports `fastapi.templating.Jinja2Templates`. TurboAPI doesn't
bundle Starlette, so SPAStaticFiles(StaticFiles) won't compile. Options: keep Starlette as a direct dependency just for file serving, or reimplement SPAStaticFiles without
inheritance (~25 lines).

5. Pydantic — mostly stays as-is. TurboAPI recommends `dhi.BaseModel` for HTTP request models, but since it also advertises ASGI/FastAPI drop-in compatibility, Pydantic models passed as route parameters should continue to work in ASGI mode. So either we accept the slowdown, or replace at least the request/response usage of pydantic with dhi. In more detail:
 - `rjsf/from_pydantic.py` introspects pydantic.fields.FieldInfo and `pydantic_core.PydanticUndefined` to generate JSON Schema — must stay Pydantic.
 - config.py uses pydantic-settings — separate package, unaffected.
 - models/, api/plugin/ use Pydantic for internal DTOs — no change needed.
 - api/types/jobs.py, api/types/fable.py, api/types/scheduling.py — the 3 HTTP request/response type files could be migrated to dhi, but are not required to be for tests to pass.
