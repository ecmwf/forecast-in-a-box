This is a minor interlude between phases 2 and 3, where we need to address one particular annoyance.

Consult the files
docs/developer/changeSpecs/backend-concurrencyRework-design.md
docs/developer/changeSpecs/backend-concurrencyRework-migration.md
in this repo for the context of the whole work, and the files
docs/developer/changeSpecs/backend-concurrencyRework-phase0result.md
docs/developer/changeSpecs/backend-concurrencyRework-phase1result.md
for what has already been addressed.

The concern we are having here right now is handling of common exceptions in web routes.
Many domains in backend/src/forecastbox/domain define their own exception classes,
and then correspondingly convert them into http codes in the respective routes.

However, there are some cross domain exceptions in the utility code: search for
`class .*(Exception)` in backend/src/forecastbox/utility.

Those can happen almost anywhere, and very often should be addressed by reporting
to the user in spirit of "some internal resource starvation, try later".

Your task is to investigate how to implement some sort of generic handler/middleware
in the FastAPI/starlette we have in the backend, and define it for the common
exceptions present in the utility code.

This new code would ideally live in utility/fastapi.py as `def register_common_exception_handling(app)`,
and be invoked from the app/entrypoint.py.

No need to add new tests.
