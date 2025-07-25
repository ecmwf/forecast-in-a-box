
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

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
    allowedHosts: true,
    watch: {
      usePolling: true
    },
  },
});
