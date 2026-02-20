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
 * TypeScript type definitions for i18next
 * Provides type-safe translation keys
 */

import 'i18next'
import type commonEN from '@/locales/en/common.json'
import type statusEN from '@/locales/en/status.json'
import type landingEN from '@/locales/en/landing.json'
import type authEN from '@/locales/en/auth.json'
import type errorsEN from '@/locales/en/errors.json'
import type validationEN from '@/locales/en/validation.json'
import type dashboardEN from '@/locales/en/dashboard.json'
import type pluginsEN from '@/locales/en/plugins.json'
import type sourcesEN from '@/locales/en/sources.json'
import type executionsEN from '@/locales/en/executions.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof commonEN
      status: typeof statusEN
      landing: typeof landingEN
      auth: typeof authEN
      errors: typeof errorsEN
      validation: typeof validationEN
      dashboard: typeof dashboardEN
      plugins: typeof pluginsEN
      sources: typeof sourcesEN
      executions: typeof executionsEN
    }
  }
}
