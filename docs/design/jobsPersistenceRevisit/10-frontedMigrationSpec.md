Role: You are an architect, inspecting differences between v2 and v1 of endpoints, and planning migration of frontend from v1 to v2.
Context:
  * Refer to docs/design/jobsPersistenceRevisit/00-overview.md for high level description of the backend migration.
  * Refer to backend/src/forecastbox/api/routers for individual endpoint definition -- the most relevant ones are in fable.py, job.py and schedule.py
  * Refer to frontend for implementation of the frontend
Goal:
  * Identify which endpoints have v2 introduced, based on backend code. Write this to the file docs/design/jobPersistenceRevisit/10-migrationGoal.md. There should be a bullet point for each endpoint migration, in the format of `v1_route -> v2_route: notable changes`, where you summarize like body param changes and semantical changes
  * Inspect frontend code for invocations of these endpoints, including tests. Formulate migration plans, broken down in stages which are related, and for each write a single file, for example: 11-fableEndpoints, 12-jobEndpoints, 13-scheduleEndpoints; but feel free to create it more granularly. Each such file will be read by a single standalone agent -- as such, it should contain sufficient amount of detail and instructions, and be self-contained and validable on its own.
  * Lastly, create a docs/design/jobPersistenceRevisit/10-migrationProgress.md file where individual sub-agents will track progress.
Constraints:
  * Do not implement any code yourself -- only inspect the codebase, and create files in docs/design/jobPersistenceRevisit
Output:
  * List the endpoints which need to be migrated, and briefly describe each migration plan file.


