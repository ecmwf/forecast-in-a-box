---
name: adapt-pr-comments
description: Analyzes the changes made in the current branch to the codebase in `backend/`, determines how those changes impact the `frontend/` codebase, and writes minimalistic fixes to resolve compatibility issues.
description: Fetches unresolved comments from the specified PR and applies the fixes.
argument-hint: <PR-number>
---

# Context Discovery
When the user invokes this skill, they will supply a PR number which you should use when calling github API.

# Adapt PR comments
The recent changes you did were pushed to the repo, under the pull request #<PR-number>, and reviewed by the user.

1. Fetch all currently unresolved comments from the repository. If you fail to fetch any, report it and wait for next input.

2. **If** you have successfully fetched the comments, think critically about them -- some of the comments may be posed as questions, some may not be informed.
If even a single comments raises a doubts on your side -- the comment is not clear, the user perhaps didnt realize there is a side-effect, the comment suggest an approach you tried and decided not to pursue, do not make any code changes, but instead describe your thoughts, and wait for next input.

3. **If**, on the other hand, everything will seem clear and spot on, proceed with applying relevant fixes to the codebase.
Once `just val` passes, make a commit, dont push, describe your changes in brief to the user, then wait for next input.
