/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

//  @ts-check
import pluginQuery from '@tanstack/eslint-plugin-query'
import { tanstackConfig } from '@tanstack/eslint-config'
import licenseHeader from 'eslint-plugin-license-header'

export default [
  { ignores: ['dist', '*.config.js', 'public'] },
  ...pluginQuery.configs['flat/recommended'],
  ...tanstackConfig,
  {
    files: ['!src/components/ui/**'],
    plugins: {
      'license-header': licenseHeader,
    },
    rules: {
      'license-header/header': [
        'error',
        [
          '/*',
          ' * (C) Copyright ' +
            new Date().getFullYear() +
            '- ECMWF and individual contributors.',
          ' *',
          ' * This software is licensed under the terms of the Apache Licence Version 2.0',
          ' * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.',
          ' * In applying this licence, ECMWF does not waive the privileges and immunities',
          ' * granted to it by virtue of its status as an intergovernmental organisation nor',
          ' * does it submit to any jurisdiction.',
          ' */',
        ],
      ],
    },
  },
]
