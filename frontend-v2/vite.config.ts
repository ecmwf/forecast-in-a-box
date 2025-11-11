import { URL, fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // Only include proxy configuration during development
      ...(isDev && {
        proxy: {
          '/api': {
            target: env.VITE_API_BASE || 'http://127.0.0.1:8000',
            changeOrigin: true,
            secure: false,
          },
        },
      }),
    },
  }
})
