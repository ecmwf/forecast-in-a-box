# Frontend Development

The frontend is a React application built with Vite and TanStack Router. Its routes are files in `src/routes`. The production build is served by the backend, so after a frontend change you rebuild it before checking the change through the backend.

Run these commands from the `frontend/` directory, unless stated otherwise.

## Setup

```bash
npm ci
```

## Common commands

| Command | Use it to |
|---|---|
| `npm run dev` | Run the Vite dev server on port 3000 against a running backend. |
| `npm run dev:mock` | Run the dev server with MSW mocks, without a backend. |
| `npm run build` | Type-check and build the production bundle into `dist/`. |
| `npm run test:unit` | Run the unit tests (hooks, stores, utilities, API client). |
| `npm run test:integration` | Run integration tests with MSW-mocked API responses. |
| `npm run test:run` | Run the Vitest suites once. |
| `npm run test:e2e` | Run the Playwright end-to-end tests. These are slow, so run them locally. |
| `npm run check` | Run Prettier, ESLint with zero warnings, and the TypeScript check. |
| `npm run fix` | Apply Prettier and ESLint fixes. |

To build the bundle that the backend serves, use `just fiabfrontend` from the repository root. It builds the bundle and links it into `backend/src/forecastbox/static`.

## Guidelines

Guidance for developing the frontend is available under [`development_guidelines/`](development_guidelines/):

- [TESTING.md](development_guidelines/TESTING.md): integration tests for user flows. Unit tests for hooks, stores, utilities and the API client.
- [UI_DESIGN.md](development_guidelines/UI_DESIGN.md): visual and interaction conventions.
- [GLOBE.md](development_guidelines/GLOBE.md): globe view, requires GPU test configuration (`npm run test:gpu`).
- [DEPLOYMENT.md](development_guidelines/DEPLOYMENT.md): Content Security Policy to set on a reverse proxy. Do not set it with a `<meta>` tag.

Repository-wide rules are included in the root [AGENTS.md](../AGENTS.md).
