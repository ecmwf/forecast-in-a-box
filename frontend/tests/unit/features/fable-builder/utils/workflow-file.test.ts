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
  ])('refuses %s', async (_, content) => {
    expect(await errorCode(jsonFile(content))).toBe('invalid')
  })
})
