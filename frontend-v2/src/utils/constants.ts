/**
 * Application-wide constants
 */

/**
 * API configuration
 */
export const API_CONSTANTS = {
  PREFIX: '/api',
  ENDPOINTS: {
    STATUS: '/v1/status',
  },
  TIMEOUTS: {
    DEFAULT: 30000, // 30 seconds
    LONG: 60000, // 1 minute
  },
} as const

/**
 * Build API endpoint path
 */
export function buildApiPath(endpoint: string): string {
  return `${API_CONSTANTS.PREFIX}${endpoint}`
}

/**
 * Query configuration
 */
export const QUERY_CONSTANTS = {
  REFETCH_INTERVALS: {
    STATUS: 30000, // 30 seconds
    FAST: 10000, // 10 seconds
    SLOW: 60000, // 1 minute
  },
  STALE_TIMES: {
    DEFAULT: 30000, // 30 seconds - matches queryClient default
    SHORT: 10000, // 10 seconds
    MEDIUM: 60000, // 1 minute
    LONG: 300000, // 5 minutes
  },
  CACHE_TIMES: {
    DEFAULT: 300000, // 5 minutes - matches queryClient gcTime
    SHORT: 60000, // 1 minute
    LONG: 600000, // 10 minutes
  },
  RETRY: {
    DEFAULT: 3, // matches queryClient default
    NONE: 0,
    AGGRESSIVE: 5,
  },
} as const

/**
 * UI constants
 */
export const UI_CONSTANTS = {
  ANIMATION_DURATION: {
    FAST: 150,
    NORMAL: 300,
    SLOW: 500,
  },
} as const

/**
 * Application metadata
 */
export const APP_CONSTANTS = {
  NAME: 'Forecast-In-A-Box',
  SHORT_NAME: 'FIAB',
  DESCRIPTION: 'AI-driven weather forecasting solution',
} as const
