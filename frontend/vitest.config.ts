/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { defineConfig, mergeConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig({ mode: 'test', command: 'serve' }),
  defineConfig({
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        '@testing-library/react',
        'sonner',
        'lz-string',
        'date-fns',
        '@date-fns/tz',
        '@tanstack/charts',
        '@tanstack/charts/motion',
        '@tanstack/charts/scales/band',
        '@tanstack/charts/scales/linear',
        '@tanstack/charts/tooltip',
        '@tanstack/react-charts/tooltip',
      ],
    },
    test: {
      globals: true,
      include: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'tests/**/*.{test,spec}.{ts,tsx}',
      ],
      exclude: ['tests/e2e/**', 'node_modules/**'],
      setupFiles: ['./tests/setup.ts'],
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
        headless: true,
        // Desktop layout (vitest default 414 < lg auto-collapse); height
        // ≥896 keeps unstyled dialogs above the fold; tests may override.
        viewport: { width: 1280, height: 900 },
      },
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/**/*.d.ts',
          'src/routes/routeTree.gen.ts',
          'src/vite-env.d.ts',
          'src/components/ui/**',
        ],
        thresholds: {
          lines: 66,
          functions: 61,
          branches: 54,
          statements: 66,
        },
      },
    },
  }),
)
