/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'

// Import the generated route tree
import { routeTree } from './routeTree.gen'
import { ConfigLoader } from '@/components/ConfigLoader.tsx'
import { AppProviders } from '@/providers'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'

import './styles.css'

// Initialize global error handlers for uncaught errors
import { setupGlobalErrorHandlers } from '@/lib/globalErrorHandler'

setupGlobalErrorHandlers()

// Create a new router instance
const router = createRouter({
  routeTree,
  context: {},
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Enable API mocking in development
async function enableMocking() {
  if (import.meta.env.VITE_ENABLE_MOCKS !== 'true') {
    return
  }

  const { worker } = await import('../mocks/browser')
  return worker.start({
    onUnhandledRequest: 'bypass',
  })
}

// Render the app
const rootElement = document.getElementById('app')
if (rootElement && !rootElement.innerHTML) {
  enableMocking().then(() => {
    const root = ReactDOM.createRoot(rootElement)
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <ConfigLoader>
            <AppProviders>
              <RouterProvider router={router} />
            </AppProviders>
          </ConfigLoader>
        </ErrorBoundary>
      </StrictMode>,
    )
  })
}
