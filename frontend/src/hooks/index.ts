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
 * Shared hooks exports
 */

export {
  useConfig,
  useLanguage,
  useAuthType,
  useLoginEndpoint,
  useBackendBaseUrl,
  useEnvironment,
  useDebugMode,
  useIsConfigReady,
  useIsConfigLoading,
  useConfigError,
  useConfigSource,
} from './useConfig'

export { useLanguageSync } from './useLanguageSync'
export { useUser } from './useUser'

// Utility hooks
export { useLocalStorage } from './useLocalStorage'
export { useDebounce, useDebouncedCallback } from './useDebounce'
export { useEventSource } from './useEventSource'
