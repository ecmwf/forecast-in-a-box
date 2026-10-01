/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { defineConfig } from 'vitest/config'
import base, { GPU_TESTS } from './vitest.config.ts'

/** The default config, narrowed to the real-WebGL tests it skips. */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [GPU_TESTS],
    exclude: ['node_modules/**'],
  },
})
