/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * System Status Integration Tests
 *
 * Tests status-related components and their interactions:
 * - WelcomeCard status section renders with healthy data
 * - WelcomeCard status section renders with partial outage data
 * - Footer StatusIndicator renders with correct traffic light
 * - Error state when status API fails
 * - StatusDetailsPopover shows component-level details
 * - Status store updates from API data
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { renderWithRouter } from '@tests/utils/render'
import { worker } from '@tests/test-extend'
import { act } from '@testing-library/react'
import {
  mockStatusAllDown,
  mockStatusAllUp,
  mockStatusPartialOutage,
} from '../../../../mocks/data/status.data'
import type { AuthContextValue } from '@/features/auth/AuthContext'
import { AuthContext } from '@/features/auth/AuthContext'
import { API_ENDPOINTS } from '@/api/endpoints'
import { WelcomeCard } from '@/features/dashboard'
import { Footer } from '@/components/layout/Footer'
import { StatusDetailsPopover } from '@/components/common/StatusDetailsPopover'
import { useStatusStore } from '@/features/status/stores/statusStore'

// Mock useMedia to simulate desktop layout
vi.mock('@/hooks/useMedia', () => ({
  useMedia: () => true,
}))

/**
 * Anonymous auth context for wrapping status components
 */
const anonymousAuth: AuthContextValue = {
  isLoading: false,
  isAuthenticated: true,
  authType: 'anonymous',
  signIn: () => {},
  signOut: () => Promise.resolve(),
}

describe('System Status', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('fiab-anonymous-id', 'test-anon-id')
    act(() => useStatusStore.getState().reset())
  })

  describe('WelcomeCard status display', () => {
    it('renders System Status label with healthy data', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('System Status')).toBeVisible()
    })

    it('shows All OK when all systems are up', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      // Default MSW handler returns mockStatusAllUp (api: up, cascade: up, ecmwf: up, scheduler: off)
      // With scheduler off, all active components are up => green => "All OK"
      await expect.element(screen.getByText('All OK')).toBeVisible()
      await expect.element(screen.getByText('Operational')).toBeVisible()
    })

    it('shows Partial Outage when some services are down', async () => {
      worker.use(
        http.get(API_ENDPOINTS.status, () => {
          return HttpResponse.json(mockStatusPartialOutage)
        }),
      )

      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      // mockStatusPartialOutage has cascade: down => orange => "Partial Outage"
      await expect.element(screen.getByText('Partial Outage')).toBeVisible()
      await expect
        .element(screen.getByText('Some services unavailable'))
        .toBeVisible()
    })

    it('shows System Down when all services are down', async () => {
      worker.use(
        http.get(API_ENDPOINTS.status, () => {
          return HttpResponse.json(mockStatusAllDown)
        }),
      )

      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      // mockStatusAllDown has api: down, cascade: down, ecmwf: down => red => "System Down"
      await expect.element(screen.getByText('System Down')).toBeVisible()
      await expect.element(screen.getByText('Not operational')).toBeVisible()
    })

    it('still renders the card when status API fails', async () => {
      worker.use(
        http.get(API_ENDPOINTS.status, () => {
          return HttpResponse.error()
        }),
      )

      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      // Card heading should still appear even with status error
      const heading = screen.getByRole('heading', { level: 2 })
      await expect.element(heading).toBeVisible()
      // System Status label should still render
      await expect.element(screen.getByText('System Status')).toBeVisible()
    })
  })

  describe('Footer status indicator', () => {
    it('renders footer with status indicator when data is loaded', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Footer />
        </AuthContext.Provider>,
      )

      // Footer should render the ECMWF copyright text
      await expect
        .element(
          screen.getByText(
            /European Centre for Medium-Range Weather Forecasts/,
          ),
        )
        .toBeVisible()
    })

    it('renders footer with All Systems Normal text for healthy status', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Footer />
        </AuthContext.Provider>,
      )

      // StatusIndicator uses getTrafficLightLabel which returns "All Systems Normal" for green
      await expect.element(screen.getByText('All Systems Normal')).toBeVisible()
    })

    it('renders Partial Outage in footer when some services are down', async () => {
      worker.use(
        http.get(API_ENDPOINTS.status, () => {
          return HttpResponse.json(mockStatusPartialOutage)
        }),
      )

      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <Footer />
        </AuthContext.Provider>,
      )

      await expect.element(screen.getByText('Partial Outage')).toBeVisible()
    })
  })

  describe('StatusDetailsPopover', () => {
    it('shows component labels when popover trigger is clicked', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <StatusDetailsPopover>
            <span>Open Status</span>
          </StatusDetailsPopover>
        </AuthContext.Provider>,
      )

      // Click to open the popover
      const trigger = screen.getByText('Open Status')
      await trigger.click()

      // Should show the component labels from StatusDetailsPopover
      await expect.element(screen.getByText('API Server')).toBeVisible()
      await expect.element(screen.getByText('Cascade')).toBeVisible()
      await expect.element(screen.getByText('ECMWF Data')).toBeVisible()
      await expect.element(screen.getByText('Scheduler')).toBeVisible()
    })

    it('shows Online status for healthy components', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <StatusDetailsPopover>
            <span>Open Status</span>
          </StatusDetailsPopover>
        </AuthContext.Provider>,
      )

      const trigger = screen.getByText('Open Status')
      await trigger.click()

      // mockStatusAllUp has api: up, cascade: up, ecmwf: up => "Online" for each
      // scheduler is "off" => "Disabled"
      const onlineElements = screen.getByText('Online')
      await expect.element(onlineElements.first()).toBeVisible()
      await expect.element(screen.getByText('Disabled')).toBeVisible()
    })

    it('shows Offline status for down components with partial outage', async () => {
      worker.use(
        http.get(API_ENDPOINTS.status, () => {
          return HttpResponse.json(mockStatusPartialOutage)
        }),
      )

      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <StatusDetailsPopover>
            <span>Open Status</span>
          </StatusDetailsPopover>
        </AuthContext.Provider>,
      )

      const trigger = screen.getByText('Open Status')
      await trigger.click()

      // mockStatusPartialOutage has cascade: down => should show "Offline"
      await expect.element(screen.getByText('Offline')).toBeVisible()
    })

    it('shows version string in popover', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <StatusDetailsPopover>
            <span>Open Status</span>
          </StatusDetailsPopover>
        </AuthContext.Provider>,
      )

      const trigger = screen.getByText('Open Status')
      await trigger.click()

      // mockStatusAllUp has version: '0.0.1@2025-11-10 17:06:53'
      await expect
        .element(screen.getByText('0.0.1@2025-11-10 17:06:53'))
        .toBeVisible()
    })

    it('shows System Status title in popover header', async () => {
      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <StatusDetailsPopover>
            <span>Open Status</span>
          </StatusDetailsPopover>
        </AuthContext.Provider>,
      )

      const trigger = screen.getByText('Open Status')
      await trigger.click()

      // The popover title uses t('status.title') which is "System Status"
      await expect.element(screen.getByText('System Status')).toBeVisible()
    })
  })

  describe('Status store integration', () => {
    it('updates store when status data is fetched', async () => {
      // Render a component that triggers the useStatus hook
      await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      // Wait for status to be fetched and store to be updated
      await vi.waitFor(() => {
        const storeStatus = useStatusStore.getState().status
        expect(storeStatus).not.toBeNull()
        expect(storeStatus?.api).toBe('up')
        expect(storeStatus?.cascade).toBe('up')
        expect(storeStatus?.ecmwf).toBe('up')
        expect(storeStatus?.scheduler).toBe('off')
      })
    })

    it('updates store with partial outage data', async () => {
      worker.use(
        http.get(API_ENDPOINTS.status, () => {
          return HttpResponse.json(mockStatusPartialOutage)
        }),
      )

      await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      await vi.waitFor(() => {
        const storeStatus = useStatusStore.getState().status
        expect(storeStatus).not.toBeNull()
        expect(storeStatus?.cascade).toBe('down')
      })
    })

    it('sets lastUpdated timestamp when status is fetched', async () => {
      const before = new Date()

      await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      await vi.waitFor(() => {
        const lastUpdated = useStatusStore.getState().lastUpdated
        expect(lastUpdated).not.toBeNull()
        expect(lastUpdated!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      })
    })
  })

  describe('Status API error handling', () => {
    it('returns 500 error gracefully', async () => {
      worker.use(
        http.get(API_ENDPOINTS.status, () => {
          return HttpResponse.json(
            { detail: 'Internal Server Error' },
            { status: 500 },
          )
        }),
      )

      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      // Card should still render even when API returns 500
      const heading = screen.getByRole('heading', { level: 2 })
      await expect.element(heading).toBeVisible()
    })

    it('shows Checking status during loading state', async () => {
      // Use a very slow delay to capture the loading state
      worker.use(
        http.get(API_ENDPOINTS.status, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return HttpResponse.json(mockStatusAllUp)
        }),
      )

      const screen = await renderWithRouter(
        <AuthContext.Provider value={anonymousAuth}>
          <WelcomeCard />
        </AuthContext.Provider>,
      )

      // While loading, the traffic light status is "unknown" => "Checking..."
      await expect.element(screen.getByText('Checking...')).toBeVisible()
    })
  })
})
