# Goal
To support new functionality and future user stories, we need to refactor database schemata, ie, as defined in the backend/src/forecastbox/schemas module.
The refactoring needs to support existing functionality, but we don't need to handle migration -- that is, existing installations will have their databases deleted and recreated.

# Relevant User Stories
As a forecaster user, I want to
1. see the list of jobs I've recently executed, and basic details: submit time, success/fail time, fail reason, links to output visualization;
2. explore the configuration and blocks of a job I've submitted;
3. reload the fable builder from an existing job and keep building with it or just execute anew without a change;
4. filter jobs by: flags, named fable builder template used for it, whether they used particular block or block configuration value (like model checkpoint);
5. re-execute a failed job without change, and be able to connect individual job re-executions (this is different from point 3!);
6. save a fable builder as a named template, load a named template as a builder, and save edited (possibly as a copy);
7. inspect all templates, filter them by whether they used particular block or block configuration value, who is their author (user, admin, external template -- affects editability),
8. inspect job schedules, in a manner compatible with the above -- a schedule itself can be filtered by blocks and configurations, can be created from a template, a job links the schedule, jobs within a schedule distinguish between re-runs and next runs, et cetera.
9. export/import a fable builder, in a way thats robust across different installations
10. star a fable builder as my favorite, regardless of who created it, or otherwise create builder collections

# What we currently track
On the job level, in `forecastbox.schemas.job`: jobId, status, created-updated timestamps, author, graph spec json, outputs spec json, error detail, progress detail.

On the "preset" (current name for fable builder template) level, in `forecastbox.schemas.fable`: builderId, created-updated timestamps, author, builder spec json, tags json, 

On the schedule level, in `forecastbox.schemas.schedule`:
* schedule itself: scheduleId, created-updated timestamps, author, cron expr, exec spec json, dynamic expr json, enabled flag, max acceptable delay hours.
* schedule run: scheduleId, jobId, attemptCnt,  scheduledAt, trigger (enum: cron, event, backfill, adhoc, ...)
* schedule next: scheduleNextId, scheduleId, scheduledAt

# What the tables should look like after the change
We will have three main tables:
* JobDefinition -- captures information needed to _execute_ a job. What fable blocks, configuration options, infrastructure settings, environment values. Allowed to be only partially filled, to facilitate saving of templates, presets, works in progress. Immutable -- changes will happen via versioning.
* ExperimentDefinition -- captures that a JobDefinition is to be executed multiple times, with a small variance in parameters. It will link exactly one JobDefinition, have an enum column which defines the type of experiment (cron_schedule, batch_execution, external_trigger) and experiment_definition column which will be a json column with content dependent on the type.
* GlobalDefaults -- this will a be table which will specify that for example that the default of ConfigurationOption of type "outputType" has value "zarr", or the ConfigurationOption of type "modelCheckpoint" should have value "aifs-1.0". It should have id, created_by, created_at, option_specs (json), value_specs (json).
* JobExecution -- a single computation that has or is happening. Must have a link to JobDefinition which holds all information what the job was about. The JobExecution only contains runtime data, such as job status (failure, success, progress), outputs URLs. It will have optional column experimentId and compilerRuntimeContext (a json), in case this execution is part of an experiment -- in which case the context will contain the specifics of the experiment (if its a cron schedule then its the time, if batch execution then the iterable within batch, if external trigger then the triggering message) and how to use it to fill in runtime values. In addition, this will contain relevant entries from GlobalDefaults

Additional requirements and notes:
- all tables should have a `created_by`, `created_at`, its unique `id`
  - the JobExecution is mutable because it changes as the job progresses through the computation. Thus it should have `updated_at` as well
  - JobDefinition and ExperimentDefinition are immutable, but allow for "save new version" -- so the unique primary key is actually a combination of (id, version).
    - the foreign keys are always the (id, version) combination
  - JobExecution would support "re-run" -- therefore, it's unique primary key will actually be (id, attemptCount)
- JobDefinition should have a source -- this would be an extensible enum with values like `plugin_template`, `user_defined`, `oneoff_execution`. This will be used for filtering in UI
- JobDefinition should have an optional `parent` id which is a job definition id (but not version!). This captures that the users would open a template, extend it, and save under a different name. It will be used only for analytical/lineage queries, thus we actively don't want the version in this lookup.
- currently, the `job` table is having a cascade-issued `id` as its primary key, which is undesirable. Instead, it should its own primary key, and cascadeId + cascadeProc should be columns which will be filled after the job is succesfully submitted
- ExperimentDefinition and JobDefinition should have a `tag` column which would be a string array, a `display_name` and `display_description` which are just strings. No need for these on JobExecution.
- this design is purposefully not normalized, for keeping related entities tight as opposed to spreading acros multiple tables
- all tables will support user-provided deletion -- which will however be done via a `is_deleted` column, and garbage collected over time. Setting `is_deleted` will work in cascade fashion -- deletion of experiment deletes job executions, deletion of job definition deletes experiment definitions and job executions.
- The garbage collection will be configurable, for example: delete all `is_deleted` entities that are older than 7 days, delete all jobs which have no experimentId that are older than 30 days, delete all JobDefinitions whose type is `oneoff_execution` older than 7 days that don't have a job. The garbage collection will be a background thread launched with a delay to not busy the process at the start time

# Implementation Considerations
This should be a gradual change, composed of steps where at each step all tests are still passing and the code is valid.
Thus we will be introducing new tables, and migrate functionality one by one.

The first stage should consist of introducing a wholly new database file (see the `forecastbox.config` module and how it declares user db and jobs db), probably "jobs2", and introduce all tables mentioned here in there, in the form of `forecastbox.schemata` submodules. Make sure the tables are correctly created at the application startup in `forecastbox.entrypoint`.

The second stage should target rework of the `forecastbox.api.routers.fable`. There is already saving of fable builder, but it misses many important details.
The goal should be to introduce a new endpoint `save/` there which inserts a JobDefinition, and a new `compile/` endpoint which takes a JobDefinition id instead.
Introduce these new endpoints in parallel to existing ones, suffixing them with a `_v2` (we'll delete original ones and remove the suffix prior to actual release).

The third stage should support execution -- that is, taking the output of the `compile/` endpoint and inserting a `JobDefinition`.
Note that GlobalDefaults and Experiments are not implemented yet.
The execution is currently blocking with respect to Artifacts downloads and Cascade submission -- leave it like that for now.

The fourth stage would cover scheduling -- rework it to insert an ExperimentDefinition instead.
You will need some analogy of the ScheduleNext table -- we could have it in the ExperimentDefinition, but we want to have that table strictly immutable.
But note there is no ScheduleRun table -- all that data now effectively resides in the JobExecution table.

Each of these stages would be marked as done by an integration test:
- for the first stage, the only observable change is creation of tables, which is subject to test under any existing integration test. No change thus needed
- for the second stage, no existing integration test covers saving a JobDefinition, but you can copy the fable building part from `tests/integration/test_fable.py` and test that save & load work.
- for the third stage, the relevant tests are in `test_submit_job.py` and `test_fable.py` -- you should copy these tests, adjust the endpoints and parameters.
- for the fourth stage, the relevant tests are in `test_schedule.py` -- copy them over.

# Left Over for the Future
These are purposefully *not* covered for now:
 - implementation of the garbage collection
 - implementation of the GlobalDefaults table
 - rework of job execution to be non-blocking, Future-based
 - implementation of templates
 - implementation of batch experiments or message-triggered experiments

They will be addressed after the existing functionality is reliably replicated by the new endpoints, and the old code deleted.
Keep them in mind while refactoring however.


