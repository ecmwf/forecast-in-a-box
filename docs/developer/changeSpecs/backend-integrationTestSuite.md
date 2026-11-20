# Backend Integration Test Suite -- Redesign Proposal

Status: proposal (step 1 of the changeSpecs workflow). Measurements and code references are from commit `ef372beb`.

## 1. Motivation

`backend/tests/integration` holds the backend tests that sit between isolated unit tests and the `largeE2E`
suite. They do not test integration with external services (that is the job of `largeE2E`). They test that the
whole backend -- FastAPI app, thread pools, background threads, the cascade gateway subprocess, the plugin
subsystem, the databases -- works together, by sending real HTTP requests to a real running backend.

The current setup has the following problems:

* It is slow. A full run takes over a minute, which hurts both CI and the local edit-test loop.
* It is hard to tell what it covers. When a pull request comes in, we want to answer "is this change exercised by
  the integration suite?" without reading 3500 lines of test code. Unit tests are cheap and can be added freely,
  but integration scenarios are expensive, so we have to add them carefully. That only works if we can see what
  is already covered.
* It is unstable at the process level. Teardown has gone wrong several times and left CI jobs hanging until the
  job deadline.
* pytest may be the wrong tool here. It is a good fit for the unit tests. For a suite that starts one heavy
  backend and runs long HTTP journeys against it, it may not be.

The proposed direction from the task description:

1. Keep starting the backend separate from running the scenarios. One backend instance, a configurable number of
   threads or processes, each running scenarios one after another against that instance. `largeE2E` already has a
   similar split.
2. Have fewer but longer scenarios. Each scenario file is a user journey with a description at the top. It covers
   the happy path plus a few refusals along the way. Negative cases that belong to no journey go into dedicated
   "negative-only" scenarios.
3. Do not hot-reload the backend. Tear it down quickly and start a fresh one for every suite run. Support
   selecting a subset of scenarios, like `pytest -k`.
4. Avoid running several backend instances on one machine at the same time, because it strains the CI runners.

## 2. Current system and its flaws

### 2.1 How it works today

* `conftest.py` has a session-scoped fixture, `backend_client`, which does the following inside the pytest process:
  * creates temporary `FIAB_ROOT` and data directories, and monkeypatches `forecastbox.utility.config.fiab_home`
    and `os.environ`
  * symlinks a placeholder `static/` into the source tree `src/forecastbox/static` if it is missing
  * starts a fake artifact registry, which is a `SimpleHTTPRequestHandler` in a child process
  * calls `forecastbox.entrypoint.main.launch_all(config)`. This calls `previous_cleanup()`, exports the config to
    environment variables, and starts the backend in a `forkserver` child process. The backend then starts the
    cascade gateway in its own `forkserver` (or `spawn`) process, and the gateway starts per-job controller and
    worker processes.
  * registers the admin user, waits until plugins report `ok`, installs the test plugin through the API, and waits
    for `ok` again
* `backend_client_user` and `backend_client_admin` are session-scoped clients built on top of it. The user client
  is shared by every test.
* There are 53 test functions in 7 files. `test_blueprint.py` alone is 2200 lines. The tests build request
  payloads from `forecastbox` pydantic classes such as `BlueprintBuilder` and `BlueprintSaveCommand`.
* `pyproject.toml` forces `-n0 -s`, live DEBUG logging, and `filterwarnings = error`. `just test` runs
  `pytest tests/integration` after the unit tests. CI runs this on 3 Python versions times {ubuntu, self-hosted
  macOS ARM}, with a 20 minute job timeout.

### 2.2 Measurement (local, 16 cores, Linux)

`pytest tests/integration --durations=0`: 53 passed in 101.7s. Breakdown:

| Item | Time |
|---|---|
| backend startup, admin registration, plugin install (fixture setup) | 7.5s |
| `test_gateway_restart_with_in_progress_job` | 20.1s (10s of that is the gateway's own shutdown handshake, see `stop_gateway`) |
| `test_blueprint_expand_missing_glyph_warnings` | 17.5s (despite its name, it runs two full executions) |
| 7 other tests that run jobs | 5-8.5s each, about 52s together |
| plugin settings / disable / exclusion tests | about 4s |
| backend teardown | about 3s |
| the remaining ~40 tests | under 0.6s each, about 3s together |

Nearly all wall time goes into actual job executions and into polling (`sleep=1` loops) for their completion. The
per-test overhead of pytest itself is negligible.

### 2.3 Evaluation of the concerns raised

* **Slowness -- valid, but the cause is different from what it looks like.** The tests run strictly one after
  another (`-n0`). They were written so they could overlap, but they never do. pytest itself is not the
  bottleneck. Using concurrency, however, runs into F2 and F3 below. One more hidden limit: the gateway defaults to
  `max_concurrent_jobs=1`, so even with concurrent clients the ~13 job executions in the suite would queue up in
  the gateway, unless the test configuration raises that limit.
* **"The tests are concurrent and do not interfere" -- only partly true.** See F2. Several tests change global
  backend state, and running them concurrently with the others would break those others.
* **Granularity and coverage reasoning -- valid.** Test names and contents have drifted apart. Many tests check
  one refusal each (for example `test_blueprint_retrieve_nonexistent`, `test_run_delete_not_found`, four
  `test_submit_job_v2_*_not_found`). A large share of `test_blueprint.py` tests pure `/blueprint/expand`
  validation, which has no side effects. The file's own TODO already says this belongs in unit tests.
* **Is pytest the right tool -- partly.** pytest is fine for writing assertions. It fits poorly at three things:
  owning the lifecycle of a multi-process server, running scenarios concurrently in one process against one
  server, and enforcing hard deadlines. Its main parallelism mechanism, xdist, uses processes, and each process
  would by default start its own session fixture, meaning its own backend. That is exactly what we want to avoid.
* **Hot reload -- the pessimism is justified.** Reloading would have to deal with the forkserver, the gateway
  subprocess, pools, threads, pyrsistent managers, the plugin module cache and sqlite handles. Restarting is
  cheap (about 7.5s, and less with some tuning, see 3.6). A restart per suite invocation is the right default.

### 2.4 Flaws

Severity reflects impact on the goals above: speed, stability, and reasoning about coverage.

**F1. The suite runs serially (High, speed).** It takes about 100s, while the longest single journey takes about
20s. The design tolerates concurrency, but nothing uses it.

**F2. Global-state mutators and shared identities make concurrency unsafe (High, stability; currently hidden
because everything runs serially).**

* These tests change state for everybody:
  * `test_gateway_restart_with_in_progress_job` kills the gateway. Every in-flight run of any other scenario
    becomes `unknown`, then `evicted`.
  * `test_plugin_disable_removes_templates_and_enable_restores` disables the only plugin. Expand, validation and
    execution of every other scenario fail while it is disabled.
  * `test_plugin_template_exclusion` permanently changes the plugin settings (excluded templates, glyph
    remapping). Later tests see the changed state, so there is an ordering dependency.
  * `test_scheduler_restart` restarts the scheduler thread.
* Every test shares one user, `user1@somewhere.org`. Tests that compare against a baseline count, such as
  `test_schedule_v2_list` (`total == baseline_total + 2`), are racy as soon as another scenario creates
  experiments at the same time.
* Some tests assume they run once on a fresh backend. `test_blueprint_artifact_execute` asserts that the artifact
  "must not be downloaded before this test runs". `test_download_model` asserts that no checkpoint is available
  yet. `test_admin_flows` assumes the admin is the first entry of `/admin/users`. None of these can be repeated
  (`--repeat`) or run against an already-running backend.

**F3. Process lifecycle and hang risks (High, stability).**

* The backend is a child of the pytest process. Teardown in `ChildProcessGroup.shutdown` sends SIGINT and waits 3s,
  then terminate and 3s, then kill. It only signals the direct child. If the backend is SIGKILLed while its
  gateway or cascade workers are still alive, those become orphans, because nothing signals the process group.
  The same thing happens when pytest itself is killed (CI cancellation, OOM, Ctrl-C twice). The orphans inherit
  stdout and stderr, because of `-s` and logging to stdout. A runner that waits for EOF on the step's output pipe
  then waits until the job timeout. This is the most likely explanation for the "CI hanging until deadline" cases.
  It has not been confirmed from CI logs, see Conclusion.
* There is no deadline per test or for the whole suite (no `pytest-timeout`). The only safety net is the 20 minute
  job timeout. Some calls use `timeout=None`, for example `/run/outputContent` on Linux in `test_run_output_content`.
  Waits are written as `attempts x sleep`, which ignores how long each request takes, so the real deadline is
  unclear.
* Teardown does not check the backend's exit code or how long shutdown took. A lifespan shutdown failure
  (`launch_backend` exits with 1) or a slow shutdown goes unnoticed, so the suite does not catch regressions in the
  product's own shutdown either.
* Mixed multiprocessing contexts: the fake registry gets an `Event()` from the default context, but the
  `Process` comes from `get_mp_ctx("other")`. It works today, but it is fragile.

**F4. `previous_cleanup()` can kill unrelated processes (High for local development and the self-hosted runners;
low for GitHub-hosted runners).** `launch_all` calls `previous_cleanup()`. It terminates every process whose
`psutil.Process.exe()` equals the current one, except itself and its direct children. With uv-managed venvs, the
venv's `python` is a symlink and `exe()` resolves to the shared base interpreter (verified:
`~/.local/share/uv/python/cpython-3.13.13-.../python3.13`). So running the integration tests can terminate any
other Python process of the same user and interpreter version: a backend or test run in another worktree, a
`just dev` backend, another pytest. On the self-hosted macOS runners, concurrent jobs for the same Python version
on one host would kill each other's backends, which looks like random failures or hangs. This behaviour is
reasonable for the end-user launcher. It is wrong inside a test harness.

**F5. Coverage cannot be read off the suite (Medium-High, reasoning).**

* There is no mapping from tests to the routes or capabilities they exercise. Test names are often misleading
  (see `test_blueprint_expand_missing_glyph_warnings` above).
* As one example (this is not a coverage analysis), `routes/lens.py` declares 8 routes and the suite never
  mentions `/lens`. Today the only way to find such gaps is grep.
* What belongs at the integration level is not stated anywhere. Expand-validation edge cases, which are cheap as
  unit tests, sit next to process-topology tests such as gateway kill and restart.

**F6. Diagnostics (Medium).** The backend's DEBUG log, the uvicorn access log and the fake registry's log are all
interleaved on stdout via `log_cli`. With concurrent scenarios it would be impossible to tell which scenario made
a request. Background failures that no test asserts on, such as the execution manager's monitored-failure history
(`/status` -> `concurrency`) or ERROR log lines, pass silently.

**F7. External dependency in an "internal" suite (Medium).** `test_admin_flows` calls `/admin/release`, which calls
the GitHub API. It is skipped through `CI_GITHUB_RATELIMIT` on part of the matrix. This goes against the
definition of the suite and is a source of flakiness.

**F8. Client payloads reuse the server's own pydantic classes (Low-Medium, reasoning).** Building requests with
`BlueprintBuilder` and similar classes is convenient and type-checked. But a wire-format change made in a shared
class changes both the client and the server, so the suite stays green while the frontend breaks. It also means
the scenarios cannot run against a different build of the backend. This is a trade-off rather than a pure defect
(see 3.5).

**F9. Side effects on the developer environment (Low).**

* A symlink is created inside `src/forecastbox`.
* `os.environ` and module globals of the test process are mutated.
* The plugin install goes through `uv pip install -e` into the active development venv. It is effectively a no-op
  today, but two concurrent suites in one venv would race on it.

**F10. Polling granularity (Low, speed).** Fixed `sleep=1.0` polls add on average about 0.5s per wait, and some
scenarios have several waits. There is no run-finished notification to subscribe to (the existing notifications
are plugin, gateway, artifact and test only).

## 3. Proposals

The proposals are grouped into axes:

* **Axis A (runner)** -- choose exactly one option.
* **Axis B (lifecycle hardening)** and **Axis C (isolation contract)** -- not alternatives. Both are needed for
  any option in A, and most of B is worth doing even if nothing else changes.
* **Axis D (coverage reasoning)** -- layers that can be stacked. At least D1 and D2 are recommended.
* **Axis E (scenario organization)** and **Axis F (developer loop)** -- conventions that apply on top of any A.

Every option in A works with every combination of B to F.

### Axis A -- runner and execution model (choose one)

#### A1. Keep pytest, start the backend outside the test processes, parallelize with xdist

* A launcher starts the backend once, outside the pytest worker processes. It can be a `just` recipe or a
  `pytest_sessionstart` hook that runs only on the xdist controller. The launcher exports
  `FIAB_IT_BASE_URL`, the admin credentials and the registry port. Worker fixtures only connect to that URL.
* Each scenario is one test function, and there is one file per scenario. Run with `-n N --dist loadfile`.
* Exclusive scenarios (see Axis C) are marked `@pytest.mark.exclusive`. They run in a second pytest invocation,
  `-m exclusive -n0`, against the same backend, and the backend is stopped only after both invocations finish. The
  wrapper owns the backend and the stop.
* Deadlines come from `pytest-timeout`, using the signal method, plus the wrapper's global watchdog.

Pros:

* Least migration work. Existing tests can be merged into journeys gradually.
* Keeps pytest's assertion rewriting, `-k`, junit output and IDE integration.

Cons:

* xdist workers are processes. Each imports `forecastbox` and its dependencies, which is slower and uses more
  memory than threads.
* The lifecycle is split between a wrapper and the conftest.
* The exclusive phase needs two pytest invocations.
* Some pytest features would have to be explicitly ignored: function-scoped fixtures, parametrization, the
  session-fixture pattern that caused this situation. Contributors used to pytest will reach for them, so
  reviewers have to enforce the rule that each test is a whole journey.
* `pytest-timeout` cannot reliably interrupt a thread stuck in C code. The outer watchdog is still required.

#### A2. A dedicated scenario runner (no pytest), modeled after `largeE2E` (recommended)

A small Python module, for example `backend/tests/scenarios/run.py`, invoked as
`uv run python -m tests.scenarios.run`. It:

* Starts the backend with the hardened supervisor from Axis B, or attaches to `--url`.
* Discovers `scenario_*.py` modules. Each one exposes `SPEC = ScenarioSpec(...)` (name, tags, `exclusive`, the
  roles it needs, a timeout) and `def run(ctx: ScenarioContext) -> None`.
* Runs the shared scenarios on a thread pool of `--workers N`, default 4. Threads are enough because the scenarios
  are I/O-bound HTTP and websocket clients. After that it runs the exclusive scenarios one at a time. The ordering
  and barrier logic is about 30 lines.
* Gives each scenario a `ScenarioContext` with:
  * a freshly registered user and its client
  * an admin client, if declared
  * a private tmpdir
  * `ctx.step("...")` context managers, which give a step name on failure plus step timings
  * deadline-based wait helpers
  * a notification websocket helper
  * a per-scenario logger
* Selection with `-k <glob or substring>` and `--tag`. Also `--repeat N` and `--shuffle --seed S` for flake hunting.
* Enforces deadlines in two layers. Each scenario has a deadline, checked by a watchdog thread. On overrun it marks
  the scenario failed and dumps all thread stacks with `faulthandler`. It does not try to kill the thread. Then a
  global suite deadline. Past it, the runner tears the backend down and calls `os._exit` with a failure code. All
  HTTP calls have finite timeouts by construction, because the context's clients have defaults and do not allow
  `None`.
* Writes a junit XML file (simple to generate), a human-readable summary table (scenario, status, duration,
  failing step), and the coverage artifacts from Axis D.

Pros:

* One owner for the whole lifecycle.
* Real concurrency against one backend within a single process.
* The exclusive barrier is built in.
* Every request can be attributed to a scenario (see D2 and B6).
* No temptation to fall back into small-test habits.
* With plain-dict payloads (3.5) it could even reuse code with `largeE2E`.

Cons:

* About 300-500 lines of runner code to own and maintain.
* pytest's assertion introspection is lost. This can be mitigated by enabling pytest's assertion-rewriting import
  hook for scenario modules (`_pytest.assertion.rewrite.AssertionRewritingHook`, which works without running
  pytest) or by a convention of explicit assertion messages, which the existing code mostly follows already.
* No IDE "run this test" button. `just itest -k name` replaces it.

#### A0 (baseline, not recommended on its own). Keep the current structure and apply only Axes B to E.

A0 still gives the stability and coverage gains. Speed stays at about 100s. It is listed so the value of A1 and A2
can be judged against doing the minimum.

**Expected wall time (A1 or A2, 4 workers, gateway `max_concurrent_jobs=4`):**

* startup: about 7s
* shared phase: bounded by the longest shared journey, about 20-25s once the current job-running tests are
  regrouped
* exclusive phase: about 25s, dominated by the gateway kill journey and its 10s shutdown handshake
* teardown: about 2s

Total is about 55-60s, compared with about 100s today. If the gateway shutdown with a running job is made faster
(a product-side improvement, already a TODO in `stop_gateway`), the total drops to about 45s. These are estimates;
see Conclusion. Startup tuning (3.6) and adaptive polling (B7) take off a few more seconds.

### Axis B -- backend lifecycle hardening (needed for any A)

* **B1. Separate supervisor.** Start the backend as a subprocess in its own session (`start_new_session=True`).
  Configure it through `FIAB_ROOT` and environment variables. Do not monkeypatch the test process's
  `forecastbox` module. Stop it like this: SIGTERM to the process group, wait with a bounded timeout, then
  SIGKILL to the whole process group, and verify that nothing is left in the group. This removes the orphan
  gateway and cascade problem regardless of how the backend died. It needs a check that cascade does not
  `setsid` its own processes, see Conclusion.
* **B2. Lifeline.** On Linux, set `PR_SET_PDEATHSIG` (via `prctl` in a `preexec_fn`, or a tiny wrapper) so the
  backend dies if the supervisor is SIGKILLed. On macOS, which has no PDEATHSIG, use a pipe: the backend gets a
  pipe from the supervisor and exits on EOF. This could be a small opt-in, test-only watchdog thread enabled by an
  environment variable. A leftover-cleanup step at the start of the suite, which kills only processes whose
  `FIAB_ROOT` points into the suite's temporary area, catches the rest.
* **B3. No `previous_cleanup()` in tests.** Add a config flag, or let the supervisor bypass `launch_all` and start
  `launch_backend` directly. Separately, consider narrowing `previous_cleanup` in the product itself, for example
  to processes with the same `FIAB_ROOT`. That is a decision for the product, but F4 affects developers anyway.
* **B4. Logs go to files, not stdout.** Write the backend log and the fake registry log into the suite's
  artifact directory. On failure, print a tail and the lines of the failing scenario (see B6). CI uploads the
  directory as an artifact. stdout then only carries runner output, which also removes the stdout-pipe hang
  mechanism.
* **B5. Post-suite health audit, as a test result in its own right.** After the last scenario:
  * `/status` reports no monitored failures in the execution manager
  * all managed threads are alive
  * there are no ERROR or CRITICAL backend log lines outside an explicit allowlist
  * shutdown completes within N seconds with exit code 0
  * the process group is empty afterwards

  This turns background-thread failures and shutdown regressions, which are invisible today, into failures.
* **B6. Request attribution.** Every client in a `ScenarioContext` sends an `X-Fiab-Scenario: <name>/<step>`
  header. A small test-only middleware puts it into the log record, or, without backend changes, the uvicorn access
  log line can be correlated by client port. This makes per-scenario log extraction possible under concurrency.
* **B7. Deadline-based waits with adaptive polling.** `wait_until(fn, deadline_s, poll=0.1 rising to 1.0)` replaces
  `attempts x sleep`.
* **B8. Test configuration.**
  * `max_concurrent_jobs` equal to the number of workers
  * `config.backend.launch_browser=False`
  * no GitHub access: point the release check at the fake registry server, or disable it in the test
    configuration
  * serve the placeholder `static/` directory from the test tree through configuration, not with a symlink into
    `src` (needs a config field or environment override for the static directory -- check whether `SPAStaticFiles`
    can be parametrized)

### Axis C -- isolation contract (needed for any A that runs scenarios concurrently)

Each scenario declares one of two classes:

* **shared** -- runs concurrently with other shared scenarios. It must:
  * use only its own user (the runner registers `scn-<name>-<uuid>@somewhere.org`) and the entities it created
  * not assert global counts. It asserts membership, or counts filtered by its own user, experiment or blueprint id.
  * write files only under its own tmpdir or `${runId}`-templated paths
  * tolerate shared, idempotent global effects such as artifact downloads, which are deduplicated by the backend,
    as `largeE2E` already requires
  * make no assumptions about what exists before it starts
  * be repeatable, so it can run twice against the same backend
* **exclusive** -- may change global state: gateway kill and restart, plugin settings and enablement, scheduler
  restart, admin config. It runs alone after the shared phase. It must restore the global state it changed, or
  declare that it does not and be placed last. The runner enforces the ordering, not the scenario author.

The current "artifact not yet downloaded" checks can be rewritten either way. A shared scenario uses an artifact id
reserved for it in the fake registry, for example `test_blueprint_checkpoint_<scenario>`. Or the download check
moves into an exclusive scenario.

Optionally, a read-write lock can replace the two-phase barrier, so that exclusive scenarios interleave with
shared ones. That only helps if there are many exclusive scenarios, so it is not worth it now.

### Axis D -- making coverage reasonable (layers that can be stacked)

**D1. Structured scenario headers (required, cheap).** Each scenario module starts with a docstring of this form:

```
Journey:   <one paragraph user story>
Actors:    user | admin | anonymous
Class:     shared | exclusive
Covers:    <capability ids from the catalogue, eg run.create, run.stop.refuse-completed, schedule.execute>
Not here:  <related things deliberately covered elsewhere, with pointer>
```

A capability catalogue (`backend/tests/scenarios/CAPABILITIES.md`, or a Python enum) lists the user-visible
capabilities per domain. A capability is coarser than a route and finer than a domain. The runner checks that
every `Covers` id exists in the catalogue. A small generated table, capability to scenarios, can be printed with
`--list`.

Pro: semantic, reviewable, and it says *why* something is covered. Con: written by hand, so it can drift from
reality. D2 checks it against what actually happens.

**D2. Observed route x status matrix with a gate (recommended).** The runner records every request as a tuple
(scenario, step, method, route template, status code). Clients do this with httpx event hooks. Route matching is
almost trivial, because `routes/__init__.py` forbids path parameters except in `admin/users/{user_id}`; the route
templates come from the backend's `/openapi.json` at startup. From this it produces:

* `coverage/routes.md` and `routes.json`: for each route, the scenarios and status codes observed. For example
  `POST /run/stop: 200 (run_lifecycle), 404 (run_lifecycle), 409 (run_lifecycle)`.
* **A gate.** Every route in the OpenAPI schema is either hit by at least one scenario or listed in
  `coverage/exempt.toml` with a one-line reason. A new route without a scenario or exemption fails CI. A route
  that becomes unreachable also fails CI if its exemption has gone stale. The gate is cheap, deterministic, and
  answers the most common pull request question: "you added or changed route X -- which scenario exercises it?"
* Optionally, a check that every `Covers` capability in D1 is backed by at least one observed request of the kind
  it claims. This needs a small mapping from capability to routes in the catalogue.

Recording status codes makes negative coverage visible. It is easy to see that, for example, every user-managed
entity's `get` has an observed 404 and every `update` an observed 409 or 404. That is exactly what the
"negative-only" scenarios are for.

Pros: automatic, cheap, and serves as documentation. Cons: route-level only, so it says nothing about which
branches inside a route ran. Websocket routes need a separate hook (the helper can record them).

**D3. Backend code coverage with diff-cover (optional, heavier).** Run the backend under `coverage.py`. This
needs process-tree support for the forkserver and spawn children, through a `.pth` or `sitecustomize` hook with
`COVERAGE_PROCESS_START`. Then combine the data files and run `diff-cover` against the pull request diff. This
gives a line-level "is this pull request exercised by the integration suite" report, kept separate from unit-test
coverage so the two signals do not mix.

Pros: answers the pull request question most directly, including for non-route code such as background threads,
the scheduler and plugin loading.

Cons:

* about 20-40% runtime overhead
* coverage inside cascade workers and plugin runtime code is harder to get and may need extra configuration
* noisy if used as a hard gate, so it is better as an informational comment or artifact
* one more thing to maintain in CI

Recommended for a nightly or on-demand job (`just itest --cov`), not for every push.

D1 and D2 together give a semantic index plus an automatic consistency check at almost no runtime cost. D3 can be
added later if D2 turns out not to answer pull request questions well enough.

### Axis E -- scenario organization and placement rules

**E1. What goes where.** A behaviour belongs in the integration suite only if it needs at least one of the
following:

* the real process topology: gateway, cascade, forkserver
* background threads: scheduler, garbage collector, dispatcher
* cross-domain wiring through the event dispatcher or notifications
* the plugin subsystem, live
* the real databases under concurrent access
* the HTTP and auth stack end to end

Everything else, especially validation branches of `/blueprint/expand` and request-model validation (422s), goes
to unit tests. Unit tests can use FastAPI's `TestClient` with faked dependencies where an HTTP shape is wanted.
This rule goes into `backend/development.md`, because it is what makes it possible to say no to adding an
integration scenario in review.

**E2. Journey catalogue.** An initial grouping of the current tests, to be refined during implementation:

| Scenario | Class | Content (from today's tests) |
|---|---|---|
| `auth_and_admin` | shared | register and login, domain allowlist refusal, duplicate register, admin user listing and detail, non-admin refused on admin routes and maintenance trigger |
| `blueprint_authoring` | shared | catalogue, glyph listing, save, version, get by version, list filters, update conflicts and 404, reserved tag and glyph refusal, one representative expand per feature (composite glyph, jinja, nullable, missing-glyph warning) |
| `run_lifecycle` | shared | create, poll, outputs (file, image, filetree zip), output content types, refusal of non-fetchable zip, stop (running, completed refusal, idempotent), delete (running refusal, success, 404 after), restart attempt conflict, compilation detail |
| `run_glyph_semantics` | shared | full blueprint execution checking the intrinsic, global and local glyph values written by sinks |
| `run_with_runtime_artifact` | shared | execution that downloads a dedicated artifact on demand, then the display name resolves |
| `artifacts` | shared | catalogue, parallel downloads, `artifactDownloadFinished` notifications, model details |
| `schedule` | shared | experiment create, get, update, list, next run, pagination refusals, scheduler-executed run and its output |
| `api_refusals` | shared | one sweep of all "entity not found" and "malformed" refusals that belong to no journey -- the negative-only scenario |
| `platform_status` | shared | db files exist, plugin installed without error, scheduler and collector threads up, maintenance trigger completes, test notification over websocket |
| `plugin_administration` | exclusive | template listing and example values, exclusion, glyph remapping, validation-failure reporting, disable, enable, restore |
| `gateway_resilience` | exclusive | kill with an in-flight run, notification, unknown then evicted, restart, cached text output survives, binary output lost |
| `scheduler_operations` | exclusive | restart twice, non-admin refused |

That is about 12 scenarios instead of 53 tests, each with a clear journey. `run_lifecycle` and
`run_glyph_semantics` together replace the seven current tests that run jobs. Several of those run near-identical
jobs, so merging them also removes a few executions.

**E3. Steps inside a scenario.** `with ctx.step("stop a completed run is refused"):` blocks give failure
reporting at the granularity people are used to from pytest, plus per-step timing, without the cost of separate
tests. Steps run in order and the first failing step ends the scenario. A failure in a journey usually makes the
rest of it meaningless anyway.

**E4. Review rule for pull requests.** A pull request that adds or changes backend behaviour of the E1 kind must
do one of the following:

* extend an existing scenario (and update its `Covers` line)
* add a capability to the catalogue together with the scenario that covers it
* add an exemption with a reason

A new scenario file is justified only by a new journey, not by a new route. The D2 report attached to CI shows the
reviewer the before and after picture.

### Axis F -- developer loop

* **F-1. Fresh backend per invocation (default).** `just itest`, `just itest -k run_lifecycle`,
  `just itest --workers 1 --tag exclusive`. The cost is startup (about 7s, see 3.6) plus the selected scenarios.
  Teardown is fast because of B1.
* **F-2. Attach mode.** `just itest --url http://localhost:8000` runs scenarios against a backend the developer
  started themselves, for example with a debugger attached. This only works because Axis C makes shared scenarios
  repeatable and free of assumptions about prior state. Exclusive scenarios are refused in attach mode unless
  `--allow-exclusive` is given.
* **F-3. Keep-alive with a staleness guard (optional).** `--keep` leaves the supervised backend running and writes
  `{pid, url, source_fingerprint}` to a state file. The fingerprint is a hash of `git diff HEAD` plus `HEAD` for
  `backend/src` and `backend/packages`. The next `just itest` reuses the backend only if the fingerprint matches;
  otherwise it restarts it. This gives most of the benefit of hot reload without any of its risks. It is only
  worth doing if startup cannot be brought down to a few seconds.

### 3.5 Cross-cutting choice: how scenarios build request payloads

This choice is independent of the axes. Pick one:

* **P1. Keep importing `forecastbox` and `fiab_core` models** (current approach). Type-checked and refactor-friendly.
  It hides wire-contract changes (F8). This can be offset by a separate unit-level OpenAPI snapshot test that fails
  on any schema change of `/api/v1` routes and must be updated on purpose. That test is valuable on its own, given
  the backward-compatibility rules in `routes/__init__.py`.
* **P2. Plain dicts and JSON, as in `largeE2E`.** Tests the real wire contract and can run against any build,
  including older releases for upgrade tests. More verbose, no type help, and scenarios break loudly on intended
  contract changes, which arguably is the point.

P1 together with the snapshot test is the pragmatic choice. P2 is better if we expect to run these scenarios
against released wheels, or to merge them with `largeE2E`.

### 3.6 Startup cost (independent quick wins)

The 7.5s setup covers backend boot, waiting for plugin store initialization, an API-driven `uv pip install -e` of
an already-installed test plugin, and a second wait. Possible reductions:

* poll `/status` at 0.1-0.2s instead of 1s
* configure the test plugin as pre-installed, so the backend only loads it. The install path can then be covered
  by one scenario instead of paying for it at every start, which also removes the venv race in F9.
* start the fake registry in a thread of the runner instead of in a process

A boot of about 3-4s looks achievable, but this needs profiling.

## 4. Conclusion

### Recommendation

Choose A2 together with B (all of it), C, D1 + D2, E, F-1 + F-2, and P1 with an OpenAPI snapshot test. Treat D3
and F-3 as later options.

If the team prefers to stay with pytest, A1 with the same B to E is a sound second choice. The differences are
mostly ergonomics, and it is somewhat weaker at lifecycle ownership and deadlines.

### Can be done now, independent of the redesign

These address the stability complaints directly and are small:

* B3: no `previous_cleanup` in tests, and evaluate narrowing it in the product
* B1 and B2: process-group teardown and a lifeline
* B4: backend logs to file instead of stdout
* hard timeouts: remove `timeout=None`, add a suite deadline
* F7: drop the GitHub call from the suite
* B5: the post-suite health audit

### Trade-offs where we do not know how you value them

* **Concurrency against reproducibility.** Running concurrently makes the suite faster and also exercises the
  backend's concurrency (sqlite lock, pools, dispatcher), which is a real bonus. The price is nondeterministic
  interleavings and harder-to-reproduce failures. `--workers 1`, `--shuffle --seed` and the per-step logs (B6)
  reduce but do not remove that price. If reproducibility matters more, run CI with 2 workers and keep 4 for local
  runs.
* **Fewer, longer scenarios against failure localization.** A journey stops at its first failing step, so a single
  CI run shows fewer independent failures than 53 small tests would. Steps (E3) keep the cause readable, but you
  will sometimes need a second run to see the next problem.
* **Owning a runner against pytest familiarity.** A2 is a few hundred lines we maintain. A1 keeps the familiar tool
  but needs discipline against habits from small tests.
* **Gate strictness (D2).** A hard "every route covered or exempted" gate occasionally adds friction to pull
  requests. A soft, report-only mode adds none, but is easy to ignore.
* **Typed payloads against contract fidelity (3.5).**

### Assumptions not fully verified

* That the observed CI hangs come from orphaned gateway or cascade processes keeping stdout open, or from the
  missing deadlines (F3). This was inferred from the code. It was not confirmed from CI job logs. Checking
  `ps` output in a post-step on a hung runner would confirm it.
* That the self-hosted macOS runners may run several jobs on one host with the same Python interpreter, so F4's
  cross-kill can happen there. Depends on how the runners are set up.
* That cascade and its gateway do not detach into their own sessions or process groups. If they do, B1's
  process-group kill is not enough, and the lifeline (B2) or a `FIAB_ROOT`-scoped sweep becomes the main mechanism.
* The wall-time estimates in Axis A assume:
  * raising `max_concurrent_jobs` to 4 does not slow individual trivial jobs much on CI runners
  * the 10s gateway shutdown with a running job is cascade-side behaviour and not a test artifact
  * job executions in the current tests can be merged roughly as the E2 table suggests

  Where a trivial run spends its 5-8s (compile, cascade job start, worker process start and imports, polling) was
  not profiled. Profiling it may show bigger wins than suite-level parallelism.
* That threads are sufficient for A2 workers. They are, as long as scenarios do only I/O. If a scenario does
  significant CPU work on the client side, such as large zip or image checks, a process pool would be needed.

### Other notes for decision makers

* Migrate incrementally. Build the runner and supervisor first and port two scenarios, `run_lifecycle` and
  `gateway_resilience`, while the old pytest suite keeps running in CI. Then move the rest file by file and delete
  `tests/integration` at the end. Moving expand-validation tests to unit tests (E1) can happen in parallel and
  shrinks what needs porting.
* The CI matrix runs the suite 6 times (3 Python versions times 2 operating systems). Once the suite is
  parallelized, the `max_concurrent_jobs` and worker count should account for the self-hosted macOS hosts running
  matrix jobs side by side. That is where the concern about not running multiple heavy instances actually applies.
* Overlap with `largeE2E`: its runner and the proposed A2 runner share discovery, `retry_until`, client building
  and the "already running backend, not clean, not alone" assumptions. Sharing a small common core is possible. It
  is only clean with P2 (no `forecastbox` imports), because `largeE2E` must run outside the backend venv.
* The health audit (B5) and the route matrix (D2) will likely find real issues on day one, such as ERROR log lines
  and untested routes. Plan for an initial allowlist and exemption file rather than blocking the migration on
  fixing all of them.
