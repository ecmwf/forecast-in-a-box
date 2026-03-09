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
9. export/import a fable builder, in a way thats robust across different installations
10. star a fable builder as my favorite, regardless of who created it, or otherwise create builder collections

# What we currently track
On the job level: jobId, status, created-updated timestamps, author, graph spec json, outputs spec json, error detail, progress detail

On the "preset" (current name for fable builder template) level: builderId, created-updated timestamps, author, builder spec json, tags json, 

On the schedule level:
* schedule itself: scheduleId, created-updated timestamps, author, cron expr, exec spec json, dynamic expr json, enabled flag, max acceptable delay hours.
* schedule run: scheduleId, jobId, attemptCnt,  scheduledAt, trigger (enum: cron, event, backfill, adhoc, ...)
* schedule next: scheduleNextId, scheduleId, scheduledAt

# Suggested Changes
1. Change jobId from cascade-owned to fiab-owned, add cascadeId+cascadeProcId as a foreign optional.
2. (Invalidated: we'll tag only on fable builder level) Add tagging to jobs -- a string array or json? This could cover "experimentId" as well.
3. Add version to fable builder -- the table must be immutable. Similarly for schedules
4. Add builderId+version nullable to jobs
5. Add attemptCnt to jobs (I think this is for discussion -- see the User Stories 3 and 5)
6. Support `created_by` to hold users _and_ like storeIds or pluginIds or whatnot
7. Add display name, display description, to fable builders and to schedules
8. Garbage collection mechanism -- delete jobs older than X outside a schedule, delete ephemeral builders without jobs. Never automatically delete named builders, schedules, scheduled jobs. Deletion of schedule is cascaded -- into jobs, schedule next, schedule run, fable builders. Deletion of builders is cascaded -- into jobs and schedules. User deletion is tombstoned, and garbage collected after a time interval.
9. Introduce table for defaults -- some sort of key/value, where key is a ConfigurationOption _type_ or block name matcher, value is a templated string, and additionally some sort of level indication (user, system).
  * An example is "every ConfigurationOption which is 'ensembleMembers' is 4", or "every 'zarrOutput' goes to $USER/fiabOutputs/$jobId", or "every 'initialConditionsDate' defaults to $todayRoundDown6hours".
  * This one I have thought through the least -- but since it is in relation with no other table, we can give it some time.
10. Replace graph spec in schedule definition with fable builder id + version
11. Introduce plugin versions into the fable builder
12. Introduce fable builder collection table, with an id, name, description, owner, collection type (favourite, custom, ...), and either a lookup table or content array. This relation would be on fableBuilderId only, ie, excluding version

## Notes and Questions
* graph spec json vs builder spec json -- we need to effectively store both. The builder spec is potentially *incomplete* -- it may lack dynamic information as provided by schedule (for example, initial conditions date) or system- or user- level defaults (such as default filesystem output root), containing either blanks or placeholders. On the other hand, graph spec is compiled with all values being concrete and constant.
  * We *could* save space by only saving the dynamic inputs on the job level -- this would prove particularly fruitful for scheduled jobs. We can afford to do so due to immutability of builder tables. We would pay by re-run being more costly, we would need to re-load the builder, impute dynamic values, and compile to cascade again -- but this we need to for scheduled jobs next runs *anyway*, and re-run (in the sense of User Story 5 or schedule job failure) is not expected to be a regular occurrence.
  * We could also argue that the rows from the table from Suggested Change 9 should also be linked to a job run -- but I think we better save the concrete values for that only. This means that reloading a builder from a past run and running it again (in the sense of User Story 3) would *not* lead to the same run in case those system defaults have changed, but that is I believe desirable. In the sense of User Story 5 this is arguable -- I would say that in the presence of system default change, it may be a good idea to explicitly backfill instead of re-run.
* we can presumably utilize the fable builder collection for visibility restrictions later, ie, introduce collection type "visibility group", so that only certain groups of users are allowed to use some builders
* we dont add description or tags on the job level -- we believe on the fable builder level it would be sufficient. We expect to always save the fable builder.
* should we introduce a parenting relationship to fable builders? A job has at most one fableBuilderId. Consider the user loads a fable builder template, makes a small change, and submits a job from that. We will have saved a fable builder reflecting that small change, and the job will point to that, not to the original template. Do we want to preserve the original template relationship? Note that the change the user makes to the template can be of just imputing some unspecified configuration values, or it can be a complete rewrite of the graph -- we can't easily tell.
