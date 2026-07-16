---
name: architecture-consolidation
description: Analyzes the whole codebase, asserts whether it is aligned with the high level guidelines, identifies transgressions, proposes fixes.

---
Act as a critically-thinking software architect.

1. Read thoroughly the guidelines at backend/development.md
2. Check the list of known breaches and non-breaches at docs/developer/changeSpecs/overallReviewState.md.
3. Inspect the codebase in `backend/src/*` and `backend/packages/*/src` for where it is conflicting with the guidelines. Do not make changes to the codebase itself, only find where there is misalignment. You can spawn subagents for individual submodules and parts of the guide.
4. Write the results to the file docs/developer/changeSpecs/overallReviewResult.md. Format it into sections, such that each section can be taken by a software developer / agent, as a task for fixing. Refer to which element from the guideline the section addresses, and which files and their parts constitute the breach, and possibly hints or options for fixing. Do not list there items which have already been flagged as ignorable by being included in the overallReviewState.md.
5. If you identify anything which you think should be added to overallReviewState.md, to make future reviews easier, do so. And, on the other hand, if you think something from the overallReviewState.md has become obsolete and should be removed from there, do so as well.
4. Commit the changes, do not push.
