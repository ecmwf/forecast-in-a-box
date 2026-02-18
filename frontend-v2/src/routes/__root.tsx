/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Outlet, createRootRoute } from '@tanstack/react-router'
import { Suspense, lazy, useEffect } from 'react'
import {
  useBackendBaseUrl,
  useConfig,
  useDebugMode,
  useEnvironment,
} from '@/hooks/useConfig'
import { useLanguageSync } from '@/hooks/useLanguageSync'
import { createLogger } from '@/lib/logger'

const CommandPalette = lazy(() =>
  import('@/components/CommandPalette').then((m) => ({
    default: m.CommandPalette,
  })),
)

const log = createLogger('Root')

export const Route = createRootRoute({
  component: () => {
    const config = useConfig()
    const debugMode = useDebugMode()
    const backendBaseUrl = useBackendBaseUrl()
    const environment = useEnvironment()

    // Sync language between configStore, globalStore, and i18next
    useLanguageSync()

    // Log configuration in debug mode
    useEffect(() => {
      if (debugMode && config) {
        log.debug('Application Configuration', {
          backendBaseUrl,
          environment,
          debugMode,
          language: config.language_iso639_1,
          authType: config.authType,
          loginEndpoint: config.loginEndpoint,
          config,
        })
      }
    }, [config, debugMode, backendBaseUrl, environment])

    return (
      <>
        {/* Header and Footer are rendered by individual layouts */}
        <Outlet />
        {/* Global command palette (⌘K / Ctrl+K) */}
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
        {/* {debugMode && (*/}
        {/*  <TanStackDevtools*/}
        {/*    config={{*/}
        {/*      position: 'bottom-right',*/}
        {/*    }}*/}
        {/*    plugins={[*/}
        {/*      {*/}
        {/*        name: 'Tanstack Router',*/}
        {/*        render: <TanStackRouterDevtoolsPanel />,*/}
        {/*      },*/}
        {/*    ]}*/}
        {/*  />*/}
        {/* )}*/}
      </>
    )
  },
})
