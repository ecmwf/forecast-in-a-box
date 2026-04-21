Contains design of change proposals -- new features, refactorings, migrations, et cetera.

Workflow:
1. A human writes a proposal, collects feedback from other humans -- on both technical and user-story-fitness levels.
2. (optional) A human prompts a high reasoning agent to create a detailed task-breakdown and plan of implementation, as a document in this folder.
3. Implementation agents carry out the plan, prompted and reviewed by a human.
4. Top-level documents and AGENT.md etc are updated to reflect the changed state -- collaboratively by a high-reasoner and a human.
5. All related documents in this folder are deleted by a human.

TODO -- how to capture at which stage a particular document is? We currently have a bunch of documents at the start of the step 4 here. We should not utilize branches and PRs for this, we want to allow intermediate merges to `main`.
