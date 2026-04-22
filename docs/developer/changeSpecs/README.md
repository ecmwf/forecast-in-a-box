Contains design of change proposals -- new features, refactorings, migrations, et cetera.

Workflow:
1. A human writes a proposal, collects feedback from other humans -- on both technical and user-story-fitness levels.
2. (optional) A human prompts a high reasoning agent to create a detailed task-breakdown and plan of implementation, as a document in this folder.
3. Implementation agents carry out the plan, prompted and reviewed by a human.
4. All docstrings and guidelines such as AGENTS.md and backend/development.md and frontend/AGENTS.md are updated to reflect the changed state -- collaboratively by a high-reasoner and a human.
5. All related documents in this folder are deleted by a human.

In the `main` branch, this folder contains only documents that are either in step 1, or for which the steps 2-4 are in progress.
The latter should however be minimized.
