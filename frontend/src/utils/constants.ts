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
 * Application-wide constants
 *
 * Note: API endpoint paths are defined in src/api/endpoints.ts
 */

/**
 * API configuration (timeouts only - endpoints are in src/api/endpoints.ts)
 */
export const API_CONSTANTS = {
  TIMEOUTS: {
    DEFAULT: 30000, // 30 seconds
    LONG: 60000, // 1 minute
  },
} as const

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
