# Frontend Development

The frontend is a React application built with Vite and TanStack Router. Its routes are files in `src/routes`. The production build is served by the backend, so after a frontend change you rebuild it before checking the change through the backend.

Run these commands from the `frontend/` directory, unless stated otherwise.

## Setup

Use the Node version pinned in `.node-version`.

```bash
npm ci
npx playwright install chromium
```

All Vitest suites, unit tests included, run in Chromium through Playwright, so the browser install is needed before any test command.

## Common commands

| Command                    | Use it to                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run dev`              | Run the Vite dev server on port 3000 against a running backend.                                      |
| `npm run dev:mock`         | Run the dev server with MSW mocks, without a backend.                                                |
| `npm run build`            | Type-check and build the production bundle into `dist/`.                                             |
| `npm run test:unit`        | Run the unit tests (hooks, stores, utilities, API client, components).                               |
| `npm run test:integration` | Run integration tests with MSW-mocked API responses.                                                 |
| `npm run test:run`         | Run the Vitest suites once.                                                                          |
| `npm run test:e2e`         | Run the Playwright end-to-end tests against MSW mocks, without a backend. Not run in CI.             |
| `npm run test:e2e:stack`   | Run the same end-to-end tests against a running backend on port 8000.                                |
| `npm run check`            | Run Prettier, ESLint with zero warnings, and the TypeScript check.                                   |
| `npm run fix`              | Apply Prettier and ESLint fixes.                                                                     |
| `npm run validate:fix`     | Run `fix`, `check`, the Vitest suites, the end-to-end tests and the build. Run it before committing. |

To build the bundle that the backend serves, use `just fiabfrontend` from the repository root. It builds the bundle and links it into `backend/src/forecastbox/static`.

## Guidelines

Guidance for developing the frontend is available under [`development_guidelines/`](development_guidelines/):

- [TESTING.md](development_guidelines/TESTING.md): integration tests for user flows. Unit tests for hooks, stores, utilities and the API client.
- [UI_DESIGN.md](development_guidelines/UI_DESIGN.md): visual and interaction conventions.
- [GLOBE.md](development_guidelines/GLOBE.md): the 3D globe view. Its GPU tests are skipped in CI, so run `npm run test:globe` locally before pushing globe changes.
- [DEPLOYMENT.md](development_guidelines/DEPLOYMENT.md): Content Security Policy header for a reverse proxy. It has to mirror the policy the build already ships in `index.html`.

Frontend conventions (stack, project structure, i18n, API layer) are in [AGENTS.md](AGENTS.md). Repository-wide rules are in the root [AGENTS.md](../AGENTS.md).
