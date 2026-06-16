# AGENTS.md

Guidance for AI Assistants working with this frontend codebase.

## Guidelines

Follow these behavioral rules to avoid common LLM coding mistakes.

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

Define success criteria. Loop until verified.

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan with verifiable checks.

### 5. Correctness

It is imperative formatting is correct and tests are passing. Make sure `npm run validate:fix` passes before you commit.

---

## Project Overview

Frontend UI for **Forecast-in-a-Box** (FIAB), a portable ML-based weather forecasting system for ECMWF.

## Technology Stack

| Category  | Technology                                    |
| --------- | --------------------------------------------- |
| Framework | React 19 + TypeScript (strict)                |
| Build     | Vite 8                                        |
| State     | Zustand (client) + TanStack Query v5 (server) |
| Routing   | TanStack Router (file-based)                  |
| Styling   | Tailwind CSS v4 (CSS-based config)            |
| UI        | shadcn/ui (Base-UI only, no Radix)            |
| Forms     | Zod 4                                         |
| i18n      | i18next                                       |
| HTTP      | Native fetch (no axios)                       |
| Testing   | Vitest Browser Mode + Playwright + MSW v2     |
| Linting   | ESLint (TanStack config) + Prettier           |

## Commands

```bash
# Development
npm run dev              # Dev server (real backend)
npm run dev:mock         # Dev server (mocked API)

# Build & Test
npm run build            # Production build
npm run validate         # Fix + test + build (full check)
npm run test             # Vitest watch mode
npm run test:run         # Vitest single run (CI)
npm run test:unit        # Unit tests only
npm run test:integration # Integration tests only
npm run test:coverage    # With coverage report
npm run test:e2e         # Playwright E2E against MSW mocks
npm run test:e2e:stack   # Playwright E2E against real backend (port 8000)
npm run analyze          # Bundle visualization (dist/stats.html)

# Code Quality
npm run check            # Lint + format check (CI)
npm run fix              # Auto-fix lint + format
```

## Project Structure

```
src/
├── api/                 # HTTP client, endpoints, TanStack Query hooks, types
├── components/
│   ├── base/            # Custom base components
│   ├── common/          # Shared components (LoadingSpinner, ErrorBoundary, etc.)
│   ├── layout/          # AppShell, Header, Sidebar, Footer
│   └── ui/              # shadcn/ui components (auto-generated, do not edit)
├── features/            # Feature modules (admin, auth, dashboard, fable-builder, landing, plugins, sources, status)
├── hooks/               # Shared custom hooks
├── lib/                 # Utilities (logger, toast, queryClient, utils)
├── locales/             # i18n translations (en/)
├── providers/           # React context providers
├── routes/              # TanStack Router (file-based, auto-generates routeTree)
├── stores/              # Zustand stores (configStore, uiStore)
├── types/               # Global TypeScript types
└── utils/               # Helper functions

mocks/                   # MSW handlers and test data
tests/                   # Unit, integration, E2E tests
```

## Key Rules

- **No `any`** — use `unknown` with type guards
- **No axios** — use native fetch via `src/api/client.ts`
- **No `console.*`** — use `createLogger()` from `@/lib/logger`
- **No hardcoded user-facing strings** — all display text goes through i18next ([see i18n](#internationalization-i18n))
- **No `tailwind.config.js`** — config is in `src/styles.css`
- **No editing `src/components/ui/`** — these are auto-generated by shadcn/ui (the sole exception: wrapping user-facing text in `t()` for i18n)
- **`text-sm` (14px) is the default minimum for body text.** `text-xs` is a legitimate override for dense or secondary UI — graph-canvas nodes, validation banners, metadata chips/badges — where compactness matters; not for primary reading content.
- **Never swallow errors** — always propagate to users via `showToast` from `@/lib/toast` and log with `createLogger()`. Silent `catch {}` blocks are forbidden.
- **No barrel files (`index.ts`)** — always import directly from the source file (e.g. `@/components/common/LoadingSpinner`, not `@/components/common`)
- **Path aliases:** `@/*` → `./src/*`, `@tests/*` → `./tests/*`

## Dates & timezones

A user-settable **application timezone** lives in `uiStore.timeZone` (default
`UTC`). Forecast date/times are stored and transmitted as **canonical naive UTC**
(`YYYY-MM-DDTHH:MM:SS`) — the forecast pipeline (anemoi, map plots) is UTC
end-to-end. The application timezone is a **presentation layer**; conversion
happens only at the entry/display boundary.

- `src/lib/datetime.ts` is the single source of truth for timezone handling.
  Components use the reactive `useAppTimeZone()`; plain modules (which cannot
  call hooks) use the `getAppTimeZone()` snapshot. `convertNaive()` re-expresses
  a naive datetime string between zones.
- The **backend must run in UTC** (`TZ=UTC`).

## Internationalization (i18n)

**No user-facing string is hardcoded.** All display text — JSX content,
`aria-label` / `placeholder` / `title` / `alt` attributes, toast and error
messages, and even brand names ("Forecast-in-a-Box", "ECMWF") — resolves
through i18next.

- **Library:** `i18next` + `react-i18next`, initialised once in `src/lib/i18n.ts`.
- **Resources:** one JSON file per namespace in `src/locales/en/` — `common`,
  `errors`, `validation`, `status`, `auth`, `landing`, `dashboard`, `plugins`,
  `artifacts`, `executions`, `schedules`, `configure`, `glyphs`, `journal`.
  `en` is currently the only locale; each feature owns its namespace, shared
  text lives in `common` / `errors`.
- **Type safety:** `src/types/i18next.d.ts` derives key types from the JSON
  files, so every `t('ns:key')` is checked by `tsc` — a key with no JSON entry
  is a compile error.

### Using translations

```typescript
// Components — the hook, bound to a default namespace:
const { t } = useTranslation('plugins')
t('detail.title') // key in the bound namespace
t('common:retry') // key in another namespace (prefix with `ns:`)
t('items', { count }) // interpolation / pluralisation

// Plain modules & class components (no hook) — the i18next singleton,
// called only inside functions/getters (never at module top level):
import i18n from 'i18next'
i18n.t('errors:toast.unexpected')
```

- **`@/lib/i18n` vs `i18next`:** `@/lib/i18n` runs `i18n.init()` as an import
  side-effect — import it **only** from entry points (`main.tsx`, `I18nProvider`,
  test render helpers). Everywhere else (types, stores, `api/client`, `lib/`
  utilities) import the `i18next` singleton directly, so the init side-effect
  isn't dragged into modules that tests mock.
- **Interpolation:** JSON `"greeting": "Hello {{name}}"` ↔ `t('greeting', { name })`.
- **Plurals:** JSON `"items_one"` / `"items_other"` ↔ `t('items', { count })`.
- **Embedded JSX** (links, bold): use the `<Trans>` component.
- **Module-scope data** (constant arrays, metadata records) can't call `t()`
  eagerly — store a `labelKey` and resolve with `t(item.labelKey)` at render,
  or expose the text as a getter that calls `i18n.t()` on access.

### Audit

`npx i18next-cli lint` flags hardcoded JSX text. It is a useful first pass but
**catches only a subset** — it misses string-literal attributes, object-literal
labels, and ternaries — so still read changed files end-to-end.

## API Layer

All endpoint paths live in `src/api/endpoints.ts`. Hooks use TanStack Query with Zod validation:

```typescript
import { API_ENDPOINTS } from '@/api/endpoints'
import { apiClient } from '@/api/client'
```

## Error Handling

```typescript
import { createLogger } from '@/lib/logger'
const log = createLogger('MyComponent')
log.error('Failed:', { id, error }) // Always logged
log.debug('Debug info') // Dev only
```

Use `showToast` from `@/lib/toast` for user notifications. Let TanStack Query handle API errors globally.

## Testing

**Vitest Browser Mode** (real Chromium, not JSDOM) + MSW v2 + Playwright for E2E.

| Layer | Location             | Tool             | Files |
| ----- | -------------------- | ---------------- | ----- |
| Unit  | `tests/unit/`        | Vitest           | 42    |
| Integ | `tests/integration/` | Vitest + MSW     | 19    |
| E2E   | `tests/e2e/`         | Playwright + MSW | 8     |

Two Playwright configs: `playwright.config.ts` (MSW-mocked) and `playwright.config.stack.ts` (real backend). All E2E tests must work against both.

See [development_guidelines/TESTING.md](./development_guidelines/TESTING.md) for patterns and strategy.

## Common Tasks

### Add API endpoint

1. Add path to `src/api/endpoints.ts`
2. Add types in `src/api/types/`
3. Add TanStack Query hook in `src/api/hooks/`
4. Add MSW handler in `mocks/handlers/`

### Add route

1. Create file in `src/routes/` — route tree auto-generates

### Add translation

1. Add the key to `src/locales/en/{namespace}.json` (value = the English text).
2. Reference it with `t('namespace:key')` — `tsc` verifies it exists.
3. A brand-new namespace must also be registered in `src/lib/i18n.ts` and
   `src/types/i18next.d.ts`.

See [Internationalization (i18n)](#internationalization-i18n) for the full mechanism.

## Reference Docs

- [development_guidelines/TESTING.md](./development_guidelines/TESTING.md) — Test patterns and strategy
- [development_guidelines/UI_DESIGN.md](./development_guidelines/UI_DESIGN.md) — Design guidelines
