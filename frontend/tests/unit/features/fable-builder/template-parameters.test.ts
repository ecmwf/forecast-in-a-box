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
import type { FableBuilderV1 } from '@/api/types/fable.types'
import {
  deriveTemplateParameters,
  referencedGlyphNames,
} from '@/features/fable-builder/utils/template-parameters'

describe('referencedGlyphNames', () => {
  it('extracts identifiers from ${...} expressions', () => {
    expect(referencedGlyphNames('${greeting} ${name}')).toEqual([
      'greeting',
      'name',
    ])
  })

  it('takes the leading identifier of filter expressions', () => {
    expect(referencedGlyphNames('/data/${dt | add_days(7)}/out')).toEqual([
      'dt',
    ])
  })

  it('returns nothing for plain text', () => {
    expect(referencedGlyphNames('fixed text')).toEqual([])
  })
})

describe('deriveTemplateParameters', () => {
  // Mirrors the plugin-test 'testBasic' template shape
  const templateFable: FableBuilderV1 = {
    blocks: {
      text_fixed: {
        factory_id: {
          plugin: { store: 'local', local: 'plugin-test' },
          factory: 'source_text',
        },
        configuration_values: { text: 'fixed text' },
        input_ids: {},
      },
      text_glyphs: {
        factory_id: {
          plugin: { store: 'local', local: 'plugin-test' },
          factory: 'source_text',
        },
        configuration_values: { text: '${greeting} ${name} on ${runId}' },
        input_ids: {},
      },
    },
    local_glyphs: { greeting: 'hello' },
  }

  it('splits references into required and template-prefilled', () => {
    const params = deriveTemplateParameters(templateFable, new Set(['runId']))
    expect(params.required).toEqual(['name'])
    expect(params.prefilled).toEqual({ greeting: 'hello' })
  })

  it('does not ask for intrinsics or globals', () => {
    const params = deriveTemplateParameters(
      templateFable,
      new Set(['runId', 'name']),
    )
    expect(params.required).toEqual([])
  })

  it('follows references inside the template glyph values', () => {
    const fable: FableBuilderV1 = {
      blocks: {},
      local_glyphs: { path: '/data/${region}' },
    }
    const params = deriveTemplateParameters(fable, new Set())
    expect(params.required).toEqual(['region'])
  })

  it('follows references inside environment variables', () => {
    const fable: FableBuilderV1 = {
      blocks: {},
      environment: {
        hosts: null,
        workers_per_host: null,
        environment_variables: { OUTPUT_DIR: '/out/${experiment}' },
        runtime_artifacts: [],
      },
    }
    const params = deriveTemplateParameters(fable, new Set())
    expect(params.required).toEqual(['experiment'])
  })

  it('records block usage sites for previews', () => {
    const params = deriveTemplateParameters(templateFable, new Set(['runId']))
    expect(params.usage.name).toEqual([
      { blockId: 'text_glyphs', optionId: 'text' },
    ])
  })
})
