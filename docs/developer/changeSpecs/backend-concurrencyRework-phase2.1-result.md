Result: Completed

Phase 2.1 added `forecastbox.utility.fastapi.register_common_exception_handling`,
which installs FastAPI exception handlers for the cross-domain utility
exceptions `ExecutionManagerError` (`utility/concurrency/manager.py`) and
`NoFreePortsException` (`utility/concurrency/ports.py`). Since Starlette
resolves exception handlers by walking the raised exception's MRO, registering
handlers for these two base classes also covers all of their existing
subclasses (`LifecycleError`, `RegistrationError`, `StartupError`,
`SubmissionRejected`). Both are mapped to a 503 response with a generic
"try again later" detail message, distinguishing them from domain-specific
exceptions that routes already translate individually. The handler is wired up
once, from `entrypoint/app.py`, right after the `FastAPI` app is constructed.

No new tests were added, per the plan. No behavioral changes were made to the
exceptions themselves or to any route.
