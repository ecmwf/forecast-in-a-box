# Testing Guide

Testing patterns and best practices for the Forecast-in-a-Box frontend.

## Testing Philosophy

- **Test behavior, not implementation** - Focus on what code does, not how
- **One behavior per test** - Keep tests focused and debuggable
- **Use factories** - No hardcoded test data
- **Descriptive names** - Test names should describe expected behavior

### Integration-First

Shallow component renders (render + check text visible) provide low confidence for the effort required. They break on refactors without catching bugs.

**Prefer integration tests** that exercise real user flows through multiple components with MSW-mocked API responses. A single integration test covering "user navigates to plugins page, filters by status, installs a plugin" provides more confidence than 10 isolated component render tests.

### What Requires Unit Tests

Code that is **pure logic**, **used in 2+ locations**, or **complex enough to warrant isolated testing**:

- **Hooks**: `src/hooks/` (all 7 hooks)
- **Stores**: `src/stores/` (all 3 stores) + `src/features/fable-builder/stores/`
- **Utilities**: `src/utils/`, `src/lib/`
- **API client**: `src/api/client.ts`
- **API endpoint functions**: `src/api/endpoints/`
- **Type helpers**: Zod schemas, validation utilities
- **Feature-specific utils**: `src/features/fable-builder/utils/`

### What Requires Integration Tests

**Feature flows** involving multiple components, API calls, and state changes:

- Auth flow (login redirect, session restore, logout)
- Dashboard (load data, quick actions, forecast journal)
- Fable builder (block selection, configuration, validation, save)
- Plugins (list, filter, install, uninstall, enable/disable)
- Sources (list, filter, download, enable/disable, registry management)
- Status page (system health, component status)

### What Requires E2E Tests

**Critical user journeys** that must work end-to-end with a real backend:

- Login → Dashboard → Configure forecast → Submit
- Plugin installation and activation
- Source download and configuration

---

## Technology Stack

| Tool                   | Purpose                     |
| ---------------------- | --------------------------- |
| Vitest                 | Test runner (browser mode)  |
| Playwright             | Browser provider for Vitest |
| MSW v2                 | API mocking                 |
| @testing-library/react | Component utilities         |
| vitest-browser-react   | React testing in browser    |

**Why browser mode?** Tests run in real Chromium (not JSDOM) for accurate DOM APIs, CSS, and events.

## Commands

```bash
npm run test            # Watch mode
npm run test:run        # Single run (CI)
npm run test:coverage   # With coverage
npm run test:ui         # Interactive UI
npm run test:e2e        # Playwright E2E - all tests against MSW mocks (fast, no backend needed)
npm run test:e2e:stack  # Playwright E2E - all tests against real backend (port 8000)
```

## Coverage

| Directory         | Current | Target |
| ----------------- | ------- | ------ |
| `src/utils/`      | ~97%    | >80%   |
| `src/lib/`        | ~94%    | >70%   |
| `src/stores/`     | ~87%    | >70%   |
| `src/hooks/`      | ~93%    | >50%   |
| `src/components/` | ~39%    | >50%   |
| `src/features/`   | ~20%    | >50%   |

**Test count:** 40 unit + 16 integration + 7 E2E = 63 test files

### What NOT to Test

Skip `src/components/ui/` (shadcn/ui) - already tested by library maintainers.

**Do test:** Custom components, hooks, stores, utilities, and feature modules.

## Test Structure

```
tests/
├── setup.ts          # Global setup (MSW lifecycle)
├── test-extend.ts    # MSW worker export
├── utils/
│   ├── render.tsx    # Custom render with providers
│   └── factories.ts  # Test data factories
├── unit/             # Unit tests (40 files - pure logic, hooks, stores, utils, components)
├── integration/      # Integration tests (16 files - feature flows with MSW)
└── e2e/              # Playwright E2E (7 test files, all run against both mock and real backend)
    └── *.spec.ts           # Works with both playwright.config.ts (MSW) and playwright.config.stack.ts (real)
```

**Path alias:** `@tests/*` → `tests/*`

```typescript
import { worker } from '@tests/test-extend'
import { getMockConfig } from '@tests/utils/factories'
import { renderWithProviders } from '@tests/utils/render'
```

## Core Patterns

### Pure Functions

```typescript
import { describe, it, expect } from 'vitest'
import { formatBytes } from '@/utils/formatters'

describe('formatBytes', () => {
  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB')
  })
})
```

### Custom Hooks

```typescript
import { renderHook, act } from '@testing-library/react'
import { vi, beforeEach, afterEach } from 'vitest'
import { useDebounce } from '@/hooks/useDebounce'

describe('useDebounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('delays value update', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 500),
      { initialProps: { value: 'initial' } },
    )

    rerender({ value: 'updated' })
    expect(result.current).toBe('initial')

    act(() => vi.advanceTimersByTime(500))
    expect(result.current).toBe('updated')
  })
})
```

### Zustand Stores

```typescript
import { act } from '@testing-library/react'
import { useConfigStore } from '@/stores/configStore'
import { getMockConfig } from '@tests/utils/factories'

describe('useConfigStore', () => {
  beforeEach(() => {
    act(() => useConfigStore.getState().resetConfig())
  })

  it('sets config', () => {
    act(() => {
      useConfigStore.getState().setConfig(getMockConfig(), 'api')
    })
    expect(useConfigStore.getState().isLoaded).toBe(true)
  })
})
```

### Components

```typescript
import { renderWithProviders } from '@tests/utils/render'
import { StatusBadge } from '@/components/common/StatusBadge'

describe('StatusBadge', () => {
  it('renders success variant', async () => {
    const { getByText } = renderWithProviders(
      <StatusBadge status="success">Active</StatusBadge>
    )
    await expect.element(getByText('Active')).toBeVisible()
  })
})
```

## Factories

Use factory functions for consistent test data:

```typescript
import { getMockConfig, getMockUser } from '@tests/utils/factories'

// With defaults
const config = getMockConfig()

// With overrides
const germanConfig = getMockConfig({ language_iso639_1: 'de' })
const adminUser = getMockUser({ is_superuser: true })
```

## MSW Mocking

MSW is configured globally in `tests/setup.ts`. Override handlers per-test:

```typescript
import { worker } from '@tests/test-extend'
import { http, HttpResponse } from 'msw'

it('handles API error', async () => {
  worker.use(
    http.get('/api/v1/config', () => {
      return HttpResponse.json({ error: 'Server error' }, { status: 500 })
    }),
  )
  // Handler resets automatically after test
})
```

## Mocking Patterns

### Module Mocking

```typescript
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))
```

### Timer Mocking

```typescript
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

it('debounces callback', () => {
  const callback = vi.fn()
  // trigger debounced callback...
  expect(callback).not.toHaveBeenCalled()
  vi.advanceTimersByTime(500)
  expect(callback).toHaveBeenCalledTimes(1)
})
```

### Spy Functions

```typescript
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())
```

## Accessibility Testing

The project requires WCAG AA compliance. Use axe-core:

```bash
npm install -D vitest-axe
```

```typescript
import { axe, toHaveNoViolations } from 'vitest-axe'
import { renderWithProviders } from '@tests/utils/render'

expect.extend(toHaveNoViolations)

it('has no accessibility violations', async () => {
  const { container } = renderWithProviders(<MyComponent />)
  expect(await axe(container)).toHaveNoViolations()
})
```

**Add accessibility tests for:**

- All `src/components/common/` components
- All page-level components in `src/features/`
- Any interactive component (buttons, forms, modals)

## Anti-Patterns

```typescript
// ❌ Testing mocks instead of behavior
expect(mockFetch).toHaveBeenCalled()

// ✅ Testing actual behavior
expect(screen.getByText('John Doe')).toBeVisible()

// ❌ Testing implementation details
expect(component.state.isOpen).toBe(true)

// ✅ Testing user-visible behavior
expect(screen.getByRole('dialog')).toBeVisible()

// ❌ Duplicated test data
const user = { id: '1', name: 'John' }

// ✅ Use factories
const user = getMockUser({ username: 'John' })

// ❌ Swallowing errors
try {
  await riskyOp()
} catch (e) {
  /* ignored */
}

// ✅ Expect errors explicitly
await expect(riskyOp()).rejects.toThrow('Expected error')
```

## Checklist

- [ ] Use factory functions for test data
- [ ] Test behavior, not implementation
- [ ] Descriptive test names
- [ ] `describe` blocks for organization
- [ ] Clear mocks in `beforeEach`
- [ ] One behavior per test
- [ ] `await expect.element()` for async assertions
- [ ] Fake timers for time-dependent tests
- [ ] Reset store state in `beforeEach`

## Debugging

**Vitest UI:** `npm run test:ui` - Interactive test explorer

**Browser DevTools:** Tests run in real browser - use `debugger` and `console.log()`

**Screenshots:** Failure screenshots saved to `__screenshots__/` directories alongside test files
