# Repository and Organization
* this is a monorepo with multiple packages, which combine together to form a single installable python wheel, which provides the project as described in [readme](./README.md)
* the code directories:
  * frontend/ where javascript code is located,
  * backend/ where code for the python backend is located, and which is the final `forecastbox` package whose wheel includes the frontend
  * backend/packages/fiab-core -- a dependency of the backend, providing a contract for backend plugins
  * backend/packages/fiab-plugin-ecmwf -- one particular plugin for the backend, not an install-time dependency but assumed to be installed at runtime
  * backend/packages/fiab-plugin-test -- a plugin for the backend used purely during integration tests
  * backend/packages/fiab-mcp-server -- an MCP server for the backend
  * cli/ is a command-line interface for the backend,
* additionally, there are scripts/ and install/ directories, which facilitate getting the wheel installed and configured correctly on target hosts
* lastly, docs/ contains documentation -- currently contains all of end-user docs, developer docs, faqs and troubleshootings
* there is pre-commit configured. Ideally do `uv run prek` before every commit. The `prek` itself is declared as a `dev` dependency in the `backend`s venv managed by `uv`

# General
* do not use fancy unicode or emoji characters when creating text/markdown files
* when asked to fetch PR review comments, use the GitHub GraphQL API to fetch only **unresolved** threads:
  ```bash
  gh api graphql -f query='
  {
    repository(owner: "ecmwf", name: "forecast-in-a-box") {
      pullRequest(number: PR_NUMBER) {
        reviewThreads(first: 50) {
          nodes {
            isResolved
            comments(first: 1) {
              nodes { path line originalLine body }
            }
          }
        }
      }
    }
  }' | jq -r '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | "File: \(.comments.nodes[0].path)\nLine: \(.comments.nodes[0].line // .comments.nodes[0].originalLine)\nComment: \(.comments.nodes[0].body)\n---"'
  ```
  This provides the actual inline review comments which `gh pr view` doesn't show properly, and filters out resolved threads

# Backend
* for development related to backend or backend/packages, consult `backend/development.md`

# Frontend
* for development related to frontend, consult `frontend/GUIDELINES.md`
