/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/// <reference types="vite/client" />

/**
 * Type declarations for Vite environment variables
 * These are populated from .env files at build time
 * See: https://vitejs.dev/guide/env-and-mode.html#env-files
 */

interface ImportMetaEnv {
  readonly VITE_BACKEND_BASE_URL: string
  readonly VITE_DEBUG: string
  readonly MODE: string
  readonly BASE_URL: string
  readonly PROD: boolean
  readonly DEV: boolean
  readonly SSR: boolean
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
