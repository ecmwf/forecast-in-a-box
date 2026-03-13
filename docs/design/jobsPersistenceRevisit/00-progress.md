Done:
  * 00-overview.md -- Initial overview and task breakdown written
  * 01-add-jobs2-db-plumbing.md -- Added `sqlite_jobs2db_path` to `DatabaseSettings` in `config.py`, created `backend/src/forecastbox/db/jobs2.py` with an empty `Base` and `create_db_and_tables()`, and added `backend/tests/integration/test_db_startup.py`; the new db is auto-discovered by the existing startup loop and created at `{FIAB_ROOT}/jobs2.db` alongside `user.db` and `job.db`.

Not done:
  * 02-add-jobs2-schema-and-crud.md
  * 03-add-fable-save-and-retrieve-v2.md
  * 04-add-fable-compile-v2.md
  * 05-add-job-execute-v2.md
  * 06-add-job-read-and-rerun-v2.md
  * 07-add-schedule-persistence-v2.md
  * 08-add-scheduler-runtime-and-runs-v2.md
