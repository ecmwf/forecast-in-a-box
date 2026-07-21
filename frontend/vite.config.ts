/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { defineConfig, loadEnv } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'

import { tanstackRouter } from '@tanstack/router-plugin/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      tanstackRouter({
        target: 'react',
        // Prod-only: in dev the tsr-split route chunks fail to fetch on HMR/
        // re-optimization (Vite 8), so bundle routes eagerly instead.
        autoCodeSplitting: !isDev,
      }),
      viteReact(),
      tailwindcss(),
      // The WMS lens runs on a dynamic loopback port; CSP must let the page
      // reach it in all builds, not just dev. External WMS comparison
      // sources are user-entered arbitrary hosts: allowed wholesale in dev,
      // opt-in per deployment via FIAB_CSP_EXTRA_HOSTS (space-separated
      // source expressions, e.g. "https://eccharts.ecmwf.int") in prod.
      {
        name: 'csp-loopback-hosts',
        transformIndexHtml(html) {
          const hosts = [
            'http://localhost:*',
            'http://127.0.0.1:*',
            ...(isDev ? ['https:', 'http:'] : []),
            ...(env.FIAB_CSP_EXTRA_HOSTS ? [env.FIAB_CSP_EXTRA_HOSTS] : []),
          ]
          return html.replaceAll(
            '<!--CSP_LOOPBACK_HOSTS-->',
            hosts.join(' ').trim(),
          )
        },
      },
      ...(mode === 'analyze'
        ? [
            visualizer({
              open: true,
              filename: 'dist/stats.html',
              gzipSize: true,
            }),
          ]
        : []),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 500,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'vendor', test: /node_modules[\\/]react(-dom)?[\\/]/ },
              {
                name: 'router',
                test: /node_modules[\\/]@tanstack[\\/]react-router[\\/]/,
              },
              {
                name: 'query',
                test: /node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
              },
              // Heavy shared libs — carve into dedicated chunks so they are
              // not duplicated into / bundled with individual route chunks.
              {
                name: 'charts',
                test: /node_modules[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/,
              },
              {
                name: 'flow',
                test: /node_modules[\\/](@xyflow[\\/]react|@dagrejs[\\/][^\\/]+)[\\/]/,
              },
              {
                name: 'three',
                test: /node_modules[\\/]three[\\/]/,
              },
              {
                name: 'datefns',
                test: /node_modules[\\/]date-fns[\\/]/,
              },
              // i18n namespace JSON — split out so translation strings load
              // as their own chunk instead of inflating the main bundle.
              {
                name: 'locales',
                test: /[\\/]src[\\/]locales[\\/]/,
              },
            ],
          },
        },
      },
    },
    server: {
      // Only include proxy configuration during development
      ...(isDev && {
        proxy: {
          '/api': {
            target: env.VITE_API_BASE || 'http://localhost:8000',
            changeOrigin: true,
            secure: false,
            cookieDomainRewrite: 'localhost',
            // Rewrite Location headers in redirect responses to use the proxy host
            // This fixes issues with backend 303 redirects containing absolute URLs to port 8000
            autoRewrite: true,
            // Handle redirect responses to rewrite Location header
            configure: (proxy) => {
              proxy.on('proxyRes', (proxyRes, _req, _res) => {
                // Rewrite Location header for redirect responses (3xx)
                const location = proxyRes.headers['location']
                if (
                  location &&
                  proxyRes.statusCode &&
                  proxyRes.statusCode >= 300 &&
                  proxyRes.statusCode < 400
                ) {
                  // Replace backend URL with proxy URL
                  proxyRes.headers['location'] = location.replace(
                    /^http:\/\/localhost:8000/,
                    `http://localhost:${env.VITE_PORT || 3000}`,
                  )
                }
              })
            },
          },
        },
      }),
    },
  }
})
