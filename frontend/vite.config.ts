import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  build: {
    cssCodeSplit: false,
  },
  plugins: [
    react({
      include: ["**/*.tsx", "**/*.css"],
    }),
  ],
  server: {
    allowedHosts: ['fiab.harrisoncook.dev'],
    watch: {
      usePolling: true
    },
  },
});