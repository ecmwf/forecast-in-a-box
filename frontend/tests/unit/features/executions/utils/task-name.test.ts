/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import { humaniseTaskName } from '@/features/executions/utils/taskName'

describe('humaniseTaskName', () => {
  it('extracts the function name from a fully-qualified module path', () => {
    const result = humaniseTaskName(
      'fiab_plugin_ecmwf.runtime.plots.map_plot:f1e9c278ad914a948662938a0b5e17b7',
    )
    expect(result.headline).toBe('Map Plot')
    expect(result.modulePath).toBe('fiab_plugin_ecmwf.runtime.plots')
    expect(result.hashChip).toBe('f1e9c278')
  })

  it('humanises bare verbs (e.g. `take:HASH`)', () => {
    const result = humaniseTaskName(
      'take:beb7b7db996e82f7684edc507ef0ec0b006bac7490d32eae1c4769a60ce5f9c',
    )
    expect(result.headline).toBe('Take')
    expect(result.modulePath).toBeUndefined()
    expect(result.hashChip).toBe('beb7b7db')
  })

  it('strips leading underscores from "private" function names', () => {
    const result = humaniseTaskName(
      '_get_initial_conditions_from_config:86063a1b4d70582ef2a667435cda3b4e',
    )
    expect(result.headline).toBe('Get Initial Conditions From Config')
    expect(result.modulePath).toBeUndefined()
    expect(result.hashChip).toBe('86063a1b')
  })

  it('handles ids with no hash suffix', () => {
    const result = humaniseTaskName('take')
    expect(result.headline).toBe('Take')
    expect(result.hashChip).toBeUndefined()
  })

  it('does not treat non-hex trailing segments as hashes', () => {
    // A trailing segment that isn't hex-shaped stays attached to the name —
    // we only strip something that *looks* like a content hash.
    const result = humaniseTaskName('take:not_a_hash')
    expect(result.hashChip).toBeUndefined()
  })
})
