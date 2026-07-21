---
name: fiab-meeting
description: Triage a Forecast-in-a-Box team meeting transcript against the GitHub board — propose new high-level issues, status changes, and PR links, then apply them only after the user approves the full plan.
---

# Triage a meeting transcript into board changes

You are triaging a **Forecast-in-a-Box** team meeting against its GitHub board. From a meeting transcript (pasted by the user, or a path to a file you should read) you will propose (1) new issues to create, (2) status changes to existing issues, and (3) links to open PRs — then, **only after the user approves the full plan**, push the changes.

## Fixed context (do not ask the user for these)

- **Repo:** `ecmwf/forecast-in-a-box` (public github.com)
- **Org Project:** #27 "Forecast-In-A-Box"
  - project id: `PVT_kwDOAGErQ84BAfGj`
  - **Status** field id: `PVTSSF_lADOAGErQ84BAfGjzgzRrjg`, options:
    - Todo = `f75ad846`
    - In Progress = `47fc9ee4`
    - Under Review = `b63c7cb1`
    - Done = `98236657`
- **Issue types** (org-level, set with `gh issue create --type <name>`): `Feature`, `Bug`, `Task`. This skill creates **`Feature`** (default) or **`Bug`** (exception) only — never `Task` (see content rules).
- **Milestones:** `2026 Rain`, `2026 Cloudburst`, `2027 Cyclone`, `Prototype v3`

> If any project/field/option id below is rejected by the API, re-fetch it once with:
> `gh api graphql -f query='{organization(login:"ecmwf"){projectV2(number:27){id field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}}}}'`
> and continue with the fresh ids.

## People (name → GitHub handle)

When the transcript refers to a team member, link them with their `@handle` (in issue bodies, comments, and the summary). Known handles:

- Harrison → `@HCookie`
- Vojta → `@tmi`
- Corentin → `@corentincarton`
- Jenny → `@jinmannwong`
- Laila → `@ldaniel2016`
- Håvard / Havard → `@havardf`
- Vegard → `@vegardb`
- Frank → `@liefra`

For any name NOT in this list, do **not** guess a handle — use the plain name and flag it in the summary so the user can supply the handle.

## Agent-generated footer

**Everything you write to GitHub — every new issue body, every comment (on issues or PRs) — must end with this footer**, on its own line, so the content is clearly flagged as agent-generated:

```
---
*🤖 Agent-generated from a meeting transcript — review before acting.*
```

Keep it to exactly this one line; do not expand it.

## Step 0 — Preflight

- Transcript: the user provides it as pasted text or a file path (read the file). If none was provided, ask the user to paste it or give a path, then stop until provided.
- Verify auth once: `gh auth status`. It must show `github.com` logged in **with the `project` scope** (needed to change board status). If the scope is missing, stop and tell the user to run `gh auth refresh -s project` — do not attempt board changes.

## Step 1 — Load current board state

Run these read-only queries and hold the results as the ground truth you triage against:

- Open issues:
  `gh issue list --repo ecmwf/forecast-in-a-box --state open -L 200 --json number,title,labels,milestone,body`
- Open PRs:
  `gh pr list --repo ecmwf/forecast-in-a-box --state open -L 100 --json number,title,headRefName,body,url`
- Current board status per item (page through if needed via `pageInfo`):
  ```
  gh api graphql -f query='
  { organization(login:"ecmwf"){ projectV2(number:27){ items(first:100){
      nodes{ id
        content{ ... on Issue{number} ... on PullRequest{number} }
        fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue{name} } }
      pageInfo{ hasNextPage endCursor } } } } }'
  ```
  (For pagination add `items(first:100, after:"<endCursor>")`.) This gives you, per issue/PR, its project **item id** and current **Status** — you need the item id to change status.

## Step 2 — Triage the transcript

Read the transcript and produce three lists. **Match by meaning** against the board state from Step 1.

**A. New issues to create.** Only for concrete follow-ups that are NOT already covered by an existing open issue. Before proposing a new issue, check the open-issue list for an overlap — if one exists, prefer a status change / comment on it over a duplicate, and say so.

**B. Status changes.** Map what the transcript says about existing issues to the Status field:
  - work explicitly started / being worked on now → **In Progress**
  - work finished, merged, or "done" → **Done**
  - waiting on review, PR opened → **Under Review**
  - re-opened / pushed back to backlog → **Todo**
  Only propose a change when the transcript gives a clear signal, and only when it differs from the current status.

**C. PR links.** For each open PR from Step 1, if the transcript discusses the work it implements, link it to the relevant issue: propose (a) an issue comment `Related PR: <pr-url>`, and (b) setting that issue to **Under Review** (or **Done** if the transcript says it merged). Do not edit PR bodies unless the user explicitly asks.

**D. Comments.** When the meeting produced something worth recording on an existing issue — a decision, a scope change, a blocker, the reason a status changed, or a related PR — propose a **short** comment. 1–2 sentences, transcript facts only (no embellishment). One comment per issue: fold multiple points (e.g. a decision + the related PR) into a single comment. Do **not** comment just to restate a status change with no added information.

### Content rules for new issues (important)
- **Stick to the facts in the transcript. Do NOT invent or embellish.** No fabricated acceptance criteria, no "proposed design", no motivation the transcript didn't state.
- Title: imperative, specific, from what was actually said.
- Body: short and to the point — a factual sentence or two of what was discussed; a brief verbatim quote from the transcript is fine. If the transcript said little, the body is short. Do not pad.
- Type: this skill triages **high-level** work, so **use `Feature` by default**. Use `Bug` only for a genuine defect — it should be the exception. **Do not use `Task`** (low-level dev tasks will be tracked separately later). If something reads as a low-level task rather than a feature or bug, flag it in the summary rather than creating it.
- Labels: **always add `agent-created`** (for auditing — the label already exists in the repo). Additionally add a component label (`backend`, `frontend`, `plugin`, `core`, …) **only if the transcript clearly indicates it**; otherwise just `agent-created`. Never guess assignees.

## Step 3 — Present the plan and get ONE approval

Present the user a single, skimmable summary with three sections:

1. **New issues** — numbered; for each: type, title, the exact body, any labels/milestone, and (if relevant) "overlaps #NNN".
2. **Status changes** — table: issue → current status → proposed status → the transcript signal (short quote/paraphrase).
3. **Comments & PR links** — table: issue → the exact (short) comment text → any status change / PR linked.

Then ask the user to approve. They will reply with **approve** (do everything), **skip <items>** / **edit <item>: …** (adjust), or **cancel**. **Do not push anything until the user approves.**

## Step 4 — Execute (only after approval)

For the approved items:

- **Create issue:**
  `gh issue create --repo ecmwf/forecast-in-a-box --type <Type> --title "…" --body "…" --label agent-created [--label <component>]`
  (the `--body` must end with the agent-generated footer, and @-mention people via the handle map)
  Then add it to the board and set Status = Todo (unless the user said otherwise):
  ```
  nid=$(gh api repos/ecmwf/forecast-in-a-box/issues/<new-number> --jq .node_id)
  item=$(gh api graphql -f query='mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}' -f p=PVT_kwDOAGErQ84BAfGj -f c="$nid" --jq '.data.addProjectV2ItemById.item.id')
  gh api graphql -f query='mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}' -f p=PVT_kwDOAGErQ84BAfGj -f i="$item" -f f=PVTSSF_lADOAGErQ84BAfGjzgzRrjg -f o=f75ad846
  ```
- **Change status of an existing issue:** reuse its **item id** from Step 1 (or `addProjectV2ItemById`, which is idempotent) and call the same `updateProjectV2ItemFieldValue` mutation with the target option id (Todo `f75ad846` / In Progress `47fc9ee4` / Under Review `b63c7cb1` / Done `98236657`).
- **Comment on an issue:** `gh issue comment <issue> --repo ecmwf/forecast-in-a-box --body "<short factual note; include \"Related PR: <pr-url>\" if applicable>"` — one comment per issue, short and to the point, ending with the agent-generated footer.

## Step 5 — Report

Give the user a final recap: issues created (with URLs), status changes applied (issue → new status), PR links added, and anything you skipped or were unsure about.

## Hard rules
- Never create, comment, or change a status the user hasn't approved.
- Never fabricate content for issues — transcript facts only.
- Prefer updating/commenting an existing issue over creating a near-duplicate.
- Every issue body and every comment ends with the agent-generated footer.
- Link people via the handle map; never guess an unknown or unconfirmed handle — use the plain name and flag it.
