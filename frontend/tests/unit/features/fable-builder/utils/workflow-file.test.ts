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
import {
  MAX_WORKFLOW_FILE_BYTES,
  WorkflowFileError,
  readWorkflowFile,
  workflowNameFromFile,
} from '@/features/fable-builder/utils/workflow-file'

describe('workflowNameFromFile', () => {
  it.each([
    [
      'anemoi_model_source_·_map_plot_2026-11-10T09-26-19_workflow.json',
      'anemoi model source · map plot',
    ],
    ['uk_cutout_aifs_workflow.json', 'uk cutout aifs'],
    ['malawi_2026-11-09T08-36-56_workflow (1).json', 'malawi'],
    ['spec.JSON', 'spec'],
    ['My spec.json', 'My spec'],
    ['.json', ''],
  ])('%s -> %s', (fileName, name) => {
    expect(workflowNameFromFile(fileName)).toBe(name)
  })
})

const jsonFile = (content: string) =>
  new File([content], 'workflow.json', { type: 'application/json' })

const block = (inputs: Record<string, string> = {}) => ({
  factory_id: { plugin: { store: 'ecmwf', local: 'base' }, factory: 'f' },
  configuration_values: {},
  input_ids: inputs,
})
const workflow = (blocks: Record<string, unknown>) => JSON.stringify({ blocks })

async function errorCode(file: File): Promise<string | undefined> {
  try {
    await readWorkflowFile(file)
  } catch (error) {
    return error instanceof WorkflowFileError ? error.code : 'other'
  }
  return undefined
}

describe('readWorkflowFile', () => {
  it('returns the exported fable', async () => {
    const fable = {
      blocks: {
        source: {
          factory_id: {
            plugin: { store: 'ecmwf', local: 'ecmwf-base' },
            factory: 'anemoiSource',
          },
          configuration_values: { lead_time: '72' },
          input_ids: {},
        },
      },
      environment: null,
      local_glyphs: { area: 'europe' },
    }
    await expect(
      readWorkflowFile(jsonFile(JSON.stringify(fable))),
    ).resolves.toEqual(fable)
  })

  it('refuses files above the size cap before reading', async () => {
    const padding = ' '.repeat(MAX_WORKFLOW_FILE_BYTES)
    expect(await errorCode(jsonFile(`{"blocks":{}}${padding}`))).toBe(
      'tooLarge',
    )
  })

  it('reports text that is not JSON', async () => {
    expect(await errorCode(jsonFile('{ not json'))).toBe('parse')
  })

  it.each([
    ['no blocks', '{"environment":null}'],
    ['null blocks', '{"blocks":null}'],
    ['a block list', '{"blocks":[]}'],
    ['a string', '"blocks"'],
    // Both crashed the builder before blocks were checked one by one.
    ['a block that is not an object', '{"blocks":{"a":42}}'],
    [
      'a block without factory_id',
      '{"blocks":{"a":{"configuration_values":{},"input_ids":{}}}}',
    ],
    [
      'a number as a setting',
      '{"blocks":{"a":{"factory_id":{"plugin":{"store":"s","local":"l"},"factory":"f"},"configuration_values":{"lead_time":72},"input_ids":{}}}}',
    ],
    ['local glyphs that are not text', '{"blocks":{},"local_glyphs":{"a":1}}'],
    // Names a plain object already has would resolve to built-ins.
    ['a built-in block name', workflow({ constructor: block() })],
    [
      '__proto__ as a block name',
      `{"blocks":{"__proto__":${JSON.stringify(block())}}}`,
    ],
    [
      'an input naming a built-in',
      workflow({ a: block({ dataset: 'toString' }) }),
    ],
    [
      'an input naming a missing block',
      workflow({ a: block({ dataset: 'gone' }) }),
    ],
    [
      'a built-in glyph name',
      JSON.stringify({ blocks: {}, local_glyphs: { valueOf: 'x' } }),
    ],
  ])('refuses %s', async (_, content) => {
    expect(await errorCode(jsonFile(content))).toBe('invalid')
  })

  it('accepts inputs naming blocks in the file, or none', async () => {
    const content = workflow({
      source: block(),
      product: block({ dataset: 'source', mask: '' }),
    })
    await expect(readWorkflowFile(jsonFile(content))).resolves.toBeTruthy()
  })

  it('names the input that points nowhere', async () => {
    await expect(
      readWorkflowFile(
        jsonFile(workflow({ a: block({ dataset: 'toString' }) })),
      ),
    ).rejects.toThrow(
      "blocks.a.input_ids.dataset: no block 'toString' in the workflow",
    )
  })

  it('names the first problem', async () => {
    await expect(
      readWorkflowFile(jsonFile('{"blocks":{"a":42}}')),
    ).rejects.toThrow(/^blocks\.a: /)
  })

  it('keeps only the workflow fields', async () => {
    const fable = await readWorkflowFile(
      jsonFile('{"blocks":{},"name":"later","environment":null}'),
    )
    expect(fable).toEqual({ blocks: {}, environment: null })
  })
})
