---
name: Overall Review
---
Act as a software architect.

1. Read thoroughly the guidelines at backend/development.md
2. Inspect the codebase for where it is conflicting with the guidelines. Do not make changes to the codebase itself, only find where there is misalignment. You can spawn subagents for individual submodules and parts of the guide.
3. Write the results to the file docs/developer/changeSpecs/overallReviewResult.md. Format it into sections, such that each section can be taken by a software developer / agent, as a task for fixing. Refer to which element from the guideline the section addresses, and which files and their parts constitute the breach, and possibly hints or options for fixing.
4. Commit the file, do not push.
