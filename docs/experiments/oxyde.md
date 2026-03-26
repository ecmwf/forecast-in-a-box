# Goal
Feasibility of Replacing SQLAlchemy with Oxyde

TL;DR: Not feasible without significant rework, primarily due to three hard blockers.

---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# Details

## Hard Blockers (showstoppers)

1. fastapi-users is glued to SQLAlchemy

The user authentication system is built on fastapi-users[sqlalchemy]. It provides SQLAlchemyBaseUserTableUUID, SQLAlchemyBaseOAuthAccountTableUUID, and SQLAlchemyUserDatabase —
concrete SQLAlchemy ORM base classes and a session adapter. Oxyde has no fastapi-users adapter, and writing one would mean reimplementing the BaseUserDatabase protocol with
Oxyde's API. This affects:

 - schemas/user.py — model definitions inherit from SA base classes
 - db/user.py — session maker, SQLAlchemyUserDatabase dependency
 - auth/users.py — UserManager, get_user_manager, FastAPIUsers wiring
 - api/routers/admin.py — direct SA queries on UserTable

The only clean path here is abandoning fastapi-users entirely and rolling a custom auth layer. That's a substantial standalone feature.

2. Composite primary keys — Oxyde doesn't support them

Every one of the three core job tables uses composite PKs:

 - JobDefinition: (job_definition_id, version)
 - ExperimentDefinition: (experiment_definition_id, version)
 - JobExecution: (job_execution_id, attempt_count)

Oxyde models support only a single db_pk=True field. The versioning pattern (SELECT MAX(version) WHERE id = X, then INSERT version = max+1) is the heart of the immutability
design and would need to be restructured around a surrogate single PK, with version and attempt_count becoming regular indexed columns.

3. Subqueries are used pervasively for "latest version" semantics

db/jobs.py has ~15 subqueries driving the core query logic (getting the latest version/attempt across a group):

 subq = (
     select(JobDefinition.job_definition_id, func.max(JobDefinition.version).label("max_version"))
     .where(JobDefinition.is_deleted.is_(False))
     .group_by(JobDefinition.job_definition_id)
     .subquery()
 )
 query = select(JobDefinition).join(subq, ...)

Oxyde has no subquery API. The closest workaround would be two separate queries (first fetch max versions, then filter by them) — but this breaks atomicity and introduces race
conditions. Using RawSQL annotations wouldn't help because these are structural FROM subqueries, not just computed columns.

---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## Medium-complexity Issues

4. ForeignKeyConstraint on composite keys (__table_args__)

ExperimentDefinition and JobExecution use multi-column FK constraints referencing (job_definition_id, version). Oxyde's FK support (db_fk= pointing to a single field) can't
express this.

5. sqlalchemy.exc.OperationalError in dbRetry

db/core.py catches this specific exception class. Oxyde would need its own exception type identified (if it even raises one on transient SQLite errors). The retry/lock wrapper in
core.py is also tied to the SA session context manager pattern.

6. Migrations via MetaData.reflect()

db/migrations.py uses SA's metadata.reflect(bind=engine) to inspect existing schema before running ALTER TABLE migrations. Oxyde has its own makemigrations/migrate CLI, which is
a different model entirely. The manual reflection-based approach would need to be replaced.

---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

## Straightforward Changes (if blockers were solved)

┌──────────────────────────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────┐
│ What                                                                                                 │ Effort                                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ JobDefinition, ExperimentDefinition, etc. → Oxyde Model subclasses with Meta.is_table = True         │ Moderate — field-by-field, JSON cols map naturally to dict   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ Simple inserts/gets/updates → Model.objects.create(), .get(), .filter().update()                     │ Low                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ Soft-delete filter .where(is_deleted.is_(False)) → .filter(is_deleted=False)                         │ Trivial                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ func.min(ExperimentNext.scheduled_at) → .min("scheduled_at")                                         │ Trivial                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ Count queries → .count()                                                                             │ Trivial                                                      │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ create_db_and_tables() → db.init() + oxyde migrations                                                │ Low                                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────┤
│ Exception type in dbRetry                                                                            │ Trivial                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────┘

---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

# Summary

┌──────────────────────────────────────────────────────────────────────────┬───────────────────────────────────────────────────────┐
│ Area                                                                     │ Status                                                │
├──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
│ Jobs DB models (schemas/jobs.py)                                         │ Blocked by composite PKs                              │
├──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
│ Jobs CRUD (db/jobs.py)                                                   │ Blocked by subqueries + composite PKs                 │
├──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
│ User DB models + auth (schemas/user.py, db/user.py, auth/users.py)       │ Blocked by fastapi-users SQLAlchemy coupling          │
├──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
│ Admin user routes (api/routers/admin.py)                                 │ Dependent on user DB blocker                          │
├──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
│ Migrations (db/migrations.py)                                            │ Replaceable with oxyde CLI pattern                    │
├──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
│ Retry/session infra (db/core.py)                                         │ Replaceable (exception swap, drop SA session pattern) │
├──────────────────────────────────────────────────────────────────────────┼───────────────────────────────────────────────────────┤
│ Unit tests (test_jobs.py)                                                │ Fixtures entirely SA-specific — full rewrite          │
└──────────────────────────────────────────────────────────────────────────┴───────────────────────────────────────────────────────┘

The realistic minimum scope is: redesign models to use surrogate PKs, replace all subquery logic with multi-query Python, write a fastapi-users custom database backend for Oxyde,
and rewrite ~700 lines of DB layer. The tests would need full fixture replacement (currently they monkeypatch async_session_maker and use Base.metadata.create_all on an in-memory
SA engine — none of which applies to Oxyde).
