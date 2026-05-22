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
import { classifyTask } from '@/features/executions/utils/taskClassify'

describe('classifyTask', () => {
  it('classifies bare take operations as select', () => {
    expect(classifyTask('take:abcdef0123456789')).toBe('select')
  })

  it('classifies anemoi inference runs', () => {
    expect(
      classifyTask(
        'earthkit.workflows.plugins.anemoi.inference.run_as_earthkit_from_config:abc',
      ),
    ).toBe('inference')
  })

  it('classifies initial-condition payloads', () => {
    expect(
      classifyTask(
        'earthkit.workflows.plugins.anemoi.inference._get_initial_conditions_from_config:abc',
      ),
    ).toBe('payload')
  })

  it('classifies empty payload wrappers', () => {
    expect(classifyTask('_empty_payload:abc')).toBe('payload')
  })

  it('classifies map plots', () => {
    expect(classifyTask('fiab_plugin_ecmwf.runtime.plots.map_plot:abc')).toBe(
      'plot',
    )
  })

  it('classifies statistics as transforms', () => {
    expect(
      classifyTask('fiab_plugin_ecmwf.runtime.statistics.ensemble_mean:abc'),
    ).toBe('transform')
  })

  it('falls back to unknown for unrecognised ids', () => {
    expect(classifyTask('something.weird.task:abc')).toBe('unknown')
  })
})
