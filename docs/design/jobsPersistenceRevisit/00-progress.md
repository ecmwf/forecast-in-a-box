Done:
  * 00-overview.md -- Initial overview and task breakdown written
  * 01-add-jobs2-db-plumbing.md -- Added `sqlite_jobs2db_path` to `DatabaseSettings` in `config.py`, created `backend/src/forecastbox/db/jobs2.py` with an empty `Base` and `create_db_and_tables()`, and added `backend/tests/integration/test_db_startup.py`; the new db is auto-discovered by the existing startup loop and created at `{FIAB_ROOT}/jobs2.db` alongside `user.db` and `job.db`.
  * 02-add-jobs2-schema-and-crud.md -- Created `backend/src/forecastbox/schemas/jobs2.py` with five ORM models (`JobDefinition`, `ExperimentDefinition`, `JobExecution`, `GlobalDefaults`, `ExperimentNext`) using composite PKs `(id, version)` / `(id, attempt_count)` and composite FK constraints; updated `backend/src/forecastbox/db/jobs2.py` to import from the schema and add full insert/get/list/update-runtime/soft-delete helpers for each table; added 12 unit tests in `backend/tests/unit/test_jobs2.py` covering latest-version, latest-attempt, soft-delete, and list semantics; note that `ExperimentDefinition` FK constraints reference `JobDefinition(id, version)` but SQLite does not enforce them by default, so callers must supply valid values.

Not done:
  * 03-add-fable-save-and-retrieve-v2.md
  * 04-add-fable-compile-v2.md
  * 05-add-job-execute-v2.md
  * 06-add-job-read-and-rerun-v2.md
  * 07-add-schedule-persistence-v2.md
  * 08-add-scheduler-runtime-and-runs-v2.md
