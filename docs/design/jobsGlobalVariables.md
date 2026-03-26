# Goal
To make workflows more convenient to define and modify, we want to introduce global variables on the job level, and a templating/interpolating expression language for configuration values.

# Relevant User Stories
As a forecaster, I want to run a job where
1. initial conditions are the most recent ones, without having to specify anything.
2. multiple models fetch some initial conditions or forecasts, each refering a single date -- and changing that date for re-runs should happen at one place only.
3. expver or some similar variable is defined globally, and all blocks can refer to it, so that a future change won't be inconsistent
4. refer to any date with possible modifications, like "given a date, eg from cron, round down to the nearest 6-hour multiple",
5. utilize a variable such as date or expver in a longer string, such as `outputPath=/data/myExperiment1/$expver/$date`
6. define user-level variables, such as `$outputBase=/home/myName/fiabOutputs`, and use them in any workflow

# High level changes
1. We will persist variable names and values on the job definition level -- those would contain new variables, defined within this job only.
2. We will persist global variables and values in a new table -- those are user-personal and admin-sitewide variables.
3. Certain variables, like `$jobId` or `$jobSubmitTime`, would be available and would not need explicit persistence -- we call them automatic variables.
4. When submitting a job, we need to collect all relevant variables, determine their actual values, and store that in the compiler context. The algorithm would work as follows:
    1. inspect all configuration options, and extract variable names
    2. for each variable name, pick the most relevant available source, in this order: from job definition, personal globals, sitewide globals, automatic variables
    3. for those that are not from job definition, persist their value in compiler context. That way, we can reliably rerun the job in the future
        4. TODO think about automatic variable values in the context of re-run
    4. if any finds no source, we can mark it as validation failure
5. When validating a job, all variable values can be resolved, except for automatic variables, for which we will have dummy values for the validation purpose
6. A block factory can define a default value for a configuration option, including variables. A particular example is initial conditions date defined utilizing $jobSubmitTime (possibly in a non-trivial expression)
7. We will define a templating language, for example a python f-string, that can be used in any configuration option
    1. TODO do we expect frontend to validate? Imagine a configuration option of the type integer, and value $myVariable -- frontend would need to be able to do a resolution like in point 4. My suggestion is frontend is able to validate on the type level _iff_ there are no $s
8. Variable value resolution needs to take order into account -- because a variable can refer to other variables. The algorithm will first consider variable pre-interpolation resolution from step 4, and only later, independently, evaluate for possible cyclicity.
    1. say we have $a=$b on job level, $b=$a on sitewide level, and $a=4 on sitewide level. This leads to a cycle, because we first pick $a on job level and $b on sitewide level -- even though there is a non-cycling resolution available.

# Not supported functionality -- but worth considering
1. How could a user configure that a certain block should take in a certain configuration option value from their personal variable?
    1. example: "when I used zarrOutput block, I want to always default the output path to /home/myName/fiabOutputs/$jobSubmitTime.date/$jobTag.name$expver"
2. How could an admin configure that all blocks of certain kind, or all configuration options of certain kind, take some value?
    1. example: "if there is any configuration option that is ensemble member, set it to 4"
3. What about some secrets as variable values? Like passwords and keys.
4. What about conditional settings? Like "if the job has tag 'bigExperiment', set any ensemble members to 16"
5. What about setting other things than variables, which ultimately affect only block configurations? Like environment config (workers, hosts), env vars

# Implementation details
(very much in progress, and of least interest to the reviewer)
1. Expand the JobDefinition structures for the variables KV/json blob
2. Adapt the GlobalDefaults table to hold the KV and some indication of the level (presumably `created_by` is enough)
3. Expand the compiler context of JobExecution to be a structured type capable of additionally holding the resolved variables
4. Implement the resolution algorithm from step 4 in the api/execute
5. Implement the variable value resolution, ie, the f-string like. Including the topological order first
6. Extend the ConfigurationOption from fiab core to allow for defaults
7. Implement automatic variable provider
