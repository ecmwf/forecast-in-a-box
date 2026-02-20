/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { URL, fileURLToPath } from 'node:url'
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
        autoCodeSplitting: true,
      }),
      viteReact(),
      tailwindcss(),
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
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@tests': fileURLToPath(new URL('./tests', import.meta.url)),
      },
    },
    build: {
      chunkSizeWarningLimit: 500,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom'],
            router: ['@tanstack/react-router'],
            query: ['@tanstack/react-query'],
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
