# Goal
Revisit what we persist in the Jobs table.

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

# What we currently track
On the job level: jobId, status, created-updated timestamps, author, graph spec json, outputs spec json, error detail, progress detail

On the "preset" (current name for fable builder template) level: builderId, created-updated timestamps, author, builder spec json, tags json, 

On the schedule level:
* schedule itself: scheduleId, created-updated timestamps, author, cron expr, exec spec json, dynamic expr json, enabled flag, max acceptable delay hours.
* schedule run: scheduleId, jobId, attemptCnt,  scheduledAt, trigger (enum: cron, even, manual, ...)
* schedule next: scheduleNextId, scheduleId, scheduledAt

# Suggested Changes
1. Change jobId from cascade-owned to fiab-owned, add cascadeId+cascadeProcId as a foreign optional.
2. Add flagging to jobs -- a string array or json? This could cover "experimentId" as well.
3. Add version to fable builder -- the table must be immutable. Similarly for schedules
4. Add builderId+version nullable to jobs
5. Add attemptCnt to jobs (I think this is for discussion -- see the User Stories 3 and 5)
6. Support `created_by` to hold users _and_ like storeIds or pluginIds or whatnot
7. Add display name, display description, to fable builders and to schedules
8. Garbage collection mechanism -- delete jobs older than X outside a schedule, delete ephemeral builders without jobs. Never automatically delete named builders, schedules, scheduled jobs. Deletion of schedule is cascaded -- into jobs, schedule next, schedule run, fable builders. Deletion of builders is cascaded -- into jobs and schedules. User deletion is tombstoned, and garbage collected after a time interval.
9. Introduce table for defaults -- some sort of key/value, where key is a ConfigurationOption _type_ or block name matcher, value is a templated string, and additionally some sort of level indication (user, system). An example is "every ConfigurationOption which is 'ensembleMembers' is 4", or "every 'zarrOutput' goes to $USER/fiabOutputs/$jobId", or "every 'initialConditionsDate' defaults to $todayRoundDown6hours".

## Notes
* graph spec json vs builder spec json -- we need to effectively store both. The builder spec is potentially *incomplete* -- it may lack dynamic information as provided by schedule (for example, initial conditions date) or system- or user- level defaults (such as default filesystem output root), containing either blanks or placeholders. On the other hand, graph spec is compiled with all values being concrete and constant. We *could* save space by only saving the dynamic inputs on the job level -- this would prove particularly fruitful for scheduled jobs. We can afford to do so due to immutability of builder tables. We would pay by re-run being more costly, we would need to re-load the builder, impute dynamic values, and compile to cascade again -- but this we need to for scheduled jobs next runs *anyway*, and re-run (in the sense of User Story 5 or schedule job failure) is not expected to be a regular occurrence.
