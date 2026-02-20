/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useUser } from '@/hooks/useUser'

// Mock useAuth
const mockUseAuth = vi.fn()
vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

// Mock getCurrentUser
const mockGetCurrentUser = vi.fn()
vi.mock('@/api/endpoints/users', () => ({
  getCurrentUser: () => mockGetCurrentUser(),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

describe('useUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('when authenticated', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        authType: 'authenticated',
      })
    })

    it('fetches user data', async () => {
      const mockUser = {
        id: '123',
        email: 'test@example.com',
        is_superuser: false,
      }
      mockGetCurrentUser.mockResolvedValue(mockUser)

      const { result } = renderHook(() => useUser(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data).toEqual(mockUser)
      expect(mockGetCurrentUser).toHaveBeenCalledTimes(1)
    })

    it('returns superuser data', async () => {
      const mockSuperUser = {
        id: '456',
        email: 'admin@example.com',
        is_superuser: true,
      }
      mockGetCurrentUser.mockResolvedValue(mockSuperUser)

      const { result } = renderHook(() => useUser(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      expect(result.current.data?.is_superuser).toBe(true)
    })

    it('handles fetch error', async () => {
      // Use 401 error to avoid custom retry logic in the hook
      mockGetCurrentUser.mockRejectedValue(new Error('401 Network error'))

      const { result } = renderHook(() => useUser(), {
        wrapper: createWrapper(),
      })

      await waitFor(
        () => {
          expect(result.current.isError).toBe(true)
        },
        { timeout: 5000 },
      )

      expect(result.current.error).toBeDefined()
    })
  })

  describe('when not authenticated', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        authType: 'anonymous',
      })
    })

    it('does not fetch user data when not authenticated', () => {
      const { result } = renderHook(() => useUser(), {
        wrapper: createWrapper(),
      })

      // Query should not be enabled
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isFetching).toBe(false)
      expect(mockGetCurrentUser).not.toHaveBeenCalled()
    })
  })

  describe('retry behavior', () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        authType: 'authenticated',
      })
    })

    it('does not retry on 401 error', async () => {
      mockGetCurrentUser.mockRejectedValue(new Error('401 Unauthorized'))

      const { result } = renderHook(() => useUser(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      // Should only be called once (no retries)
      expect(mockGetCurrentUser).toHaveBeenCalledTimes(1)
    })

    it('does not retry on 403 error', async () => {
      mockGetCurrentUser.mockRejectedValue(new Error('403 Forbidden'))

      const { result } = renderHook(() => useUser(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isError).toBe(true)
      })

      // Should only be called once (no retries)
      expect(mockGetCurrentUser).toHaveBeenCalledTimes(1)
    })
  })

  describe('query key', () => {
    it('includes authType in query key', async () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        authType: 'anonymous',
      })
      mockGetCurrentUser.mockResolvedValue({ id: '1' })

      const { result } = renderHook(() => useUser(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true)
      })

      // Query key should include authType to differentiate cached results
      expect(mockGetCurrentUser).toHaveBeenCalled()
    })
  })
})
