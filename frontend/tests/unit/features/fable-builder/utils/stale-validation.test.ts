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
import type {
  BlockInstance,
  BlockValidationState,
  FableBuilderV1,
  FableValidationState,
} from '@/api/types/fable.types'
import {
  dropBlockErrors,
  staleBlockIds,
} from '@/features/fable-builder/utils/stale-validation'

const PLUGIN = { store: 'ecmwf', local: 'ecmwf-base' }

function block(input?: string): BlockInstance {
  return {
    factory_id: { plugin: PLUGIN, factory: 'select' },
    configuration_values: {},
    input_ids: input ? { dataset: input } : {},
  }
}

// source -> select -> sink, plus an unrelated block.
const VALIDATED: FableBuilderV1 = {
  blocks: {
    source: block(),
    select: block('source'),
    sink: block('select'),
    other: block(),
  },
  local_glyphs: {},
}

function blockState(errors: Array<string>): BlockValidationState {
  return {
    errors,
    hasErrors: errors.length > 0,
    possibleExpansions: [],
    possibleExpansionRestrictions: {},
    configurationRestrictions: { values: "list[enumClosed[param]('167')]" },
    missingGlyphs: {},
  }
}

describe('staleBlockIds', () => {
  it('is empty when nothing changed', () => {
    expect(staleBlockIds(VALIDATED, VALIDATED)).toEqual(new Set())
  })

  it('marks an edited block and everything downstream of it', () => {
    const current: FableBuilderV1 = {
      ...VALIDATED,
      blocks: {
        ...VALIDATED.blocks,
        select: {
          ...VALIDATED.blocks.select,
          configuration_values: { values: '167' },
        },
      },
    }
    expect(staleBlockIds(VALIDATED, current)).toEqual(
      new Set(['select', 'sink']),
    )
  })

  it('marks every block when the variables change', () => {
    const current = { ...VALIDATED, local_glyphs: { area: 'global' } }
    expect(staleBlockIds(VALIDATED, current)).toEqual(
      new Set(['source', 'select', 'sink', 'other']),
    )
  })
})

describe('dropBlockErrors', () => {
  it('clears errors of stale blocks only, keeping their restrictions', () => {
    const state = {
      isValid: false,
      globalErrors: [],
      blockStates: {
        select: blockState(["Configuration option 'values' cannot be empty"]),
        other: blockState(['still broken']),
      },
    } as unknown as FableValidationState

    const next = dropBlockErrors(state, new Set(['select']))

    expect(next.blockStates.select.errors).toEqual([])
    expect(next.blockStates.select.hasErrors).toBe(false)
    expect(next.blockStates.select.stale).toBe(true)
    expect(next.blockStates.select.configurationRestrictions).toEqual(
      state.blockStates.select.configurationRestrictions,
    )
    expect(next.blockStates.other).toBe(state.blockStates.other)
  })
})
