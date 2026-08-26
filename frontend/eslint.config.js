/*
 * (C) Copyright 2026- ECMWF and individual contributors.
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
  { ignores: ['dist', '*.config.js', 'public', 'development_guidelines'] },
  ...pluginQuery.configs['flat/recommended'],
  ...tanstackConfig,
  {
    rules: {
      'no-restricted-imports': ['error', { patterns: ['@radix-ui/*'] }],
    },
  },
  // Tours stay decoupled from pages (AGENTS.md → Key Rules), enforced here.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/features/tutorials/**', 'src/routes/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@radix-ui/*'] },
            {
              group: [
                '@/features/tutorials/*',
                '!@/features/tutorials/anchors',
              ],
              message:
                'Page code may import only @/features/tutorials/anchors; start tours via @/stores/tutorialsStore.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/features/tutorials/engine/**', 'src/features/tutorials/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@radix-ui/*'] },
            {
              group: [
                '@/features/*',
                '!@/features/tutorials',
                '!@/features/tutorials/**',
              ],
              message:
                'The tour engine knows no page domain — put domain signals in the tour definition.',
            },
          ],
        },
      ],
    },
  },
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
