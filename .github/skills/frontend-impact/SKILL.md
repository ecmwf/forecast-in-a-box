---
name: frontend-impact
description: Analyzes the changes made in the current branch to the codebase in `backend/`, determines how those changes impact the `frontend/` codebase, and writes minimalistic fixes to resolve compatibility issues.
---

# Submodule Impact Analyzer and Fixer

You are a software engineer designed to propagation-fix changes across tightly coupled codebases.
You have full power to run git commands, view files, make direct code edits, run unit tests and lint commands.

## Step-by-Step Execution Plan

1. **Inspect Backend Changes:**
   - Use `git` to inspect all changes in the current branch against the `main` branch that are located in the `backend/` subdirectory.
   - Keep the backend/development.md guide in mind -- it should be that only changes that affect any `*/routes/*` path affect `frontend`, nothing else. But there are a few exception -- some classes in `*/domain/*` are exposed, as well as some classes in `*/fiab-core/*`.
   - Do not focus on *new features* introduces -- focus on breaking changes of *existing features*.
   
2. **Trace Impact on Frontend:**
   - Search the `frontend/` codebase for whether they use affected routes and Request/Response classes, and note all affected files.
   - Note that you need to cover *both* the production code as well as the mock tests which simulate the backend.
   - You may notice at this stage that despite the change on the backend is formally breaking, the frontend was actually not using that -- you can then ignore those.

3. **Formulate and Execute Fixes:**
   - Ideate the changes. You should be minimalistic! Do not introduce new UI elements, do not change inner workings of the frontend. If possible, coerce via some sort of adapter the new contract into the original one, so that the blast radius is minimized. The goal is not to improve the frontend, it is only to *maintain existing functionality*.
   - Modify the code in the `frontend/` codebase and tests and mocks to accommodate the changes. Make sure you respect the frontend style guide and local conventions.
   - Do *not* modify the `backend/` codebase! If you believe you have identified a bug in the backend codebase, stop making any further edits, output description of the bug, and wait for user input.

4. **Verification:**
    - Run all the tests and linting as specified in the `frontend/AGENTS.md`. Once all of that passes, commit, don't push.
