/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act } from '@testing-library/react'
import { renderWithProviders } from '@tests/utils/render'
import type {
  BlockInstance,
  FableBuilderV1,
  FableValidationState,
} from '@/api/types/fable.types'
import type { QubeNode } from '@/api/types/artifacts.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { EdgeQubeLens } from '@/features/fable-builder/components/graph-mode/EdgeQubeLens'

const PLUGIN = { store: 'ecmwf', local: 'ecmwf-base' }

const enumVals = (values: Array<string | number>) => ({
  type: 'enum',
  dtype: 'str',
  values,
})

/** Build a linear qube (root → one node per dimension, in order). */
function linearQube(dims: Array<[string, Array<string>]>): QubeNode {
  let node: QubeNode | null = null
  for (let i = dims.length - 1; i >= 0; i -= 1) {
    const [key, values] = dims[i]
    node = {
      key,
      values: enumVals(values),
      metadata: {},
      children: node ? [node] : [],
    }
  }
  return {
    key: 'root',
    values: enumVals(['root']),
    metadata: {},
    children: node ? [node] : [],
  }
}

function selectBlock(
  input: string,
  dimension: string,
  values: string,
): BlockInstance {
  return {
    factory_id: { plugin: PLUGIN, factory: 'select' },
    configuration_values: { dimension, values },
    input_ids: { dataset: input },
  }
}

const FABLE: FableBuilderV1 = {
  blocks: {
    src: {
      factory_id: { plugin: PLUGIN, factory: 'operationalForecastSource' },
      configuration_values: {},
      input_ids: {},
    },
    selParam: selectBlock('src', 'param', '2t'),
    selStep: selectBlock('selParam', 'step', '24'),
  },
  local_glyphs: {},
}

/** A validation snapshot carrying only the per-block output qubes the lens reads. */
function validationWith(
  blockOutputQubes: Record<string, QubeNode>,
): FableValidationState {
  return {
    isValid: true,
    globalErrors: [],
    possibleSources: [],
    resolvedConfigurationOptions: {},
    blockOutputQubes,
    blockStates: {},
  }
}

describe('EdgeQubeLens', () => {
  // Browser-mode renders without the app stylesheet; restore the popover's
  // production stacking so its click target isn't swallowed (see CommandPalette).
  beforeAll(() => {
    const style = document.createElement('style')
    style.textContent =
      '[data-slot="popover-content"]{position:fixed;z-index:50}'
    document.head.appendChild(style)
  })

  beforeEach(() => {
    act(() => {
      useFableBuilderStore.getState().setFable(FABLE)
    })
  })

  it('shows the qube dimensionality on the handle', async () => {
    // Edge selParam → selStep carries selParam's 3-D output qube.
    act(() =>
      useFableBuilderStore.getState().setValidationState(
        validationWith({
          selParam: linearQube([
            ['param', ['2t']],
            ['step', ['0', '24']],
            ['number', ['0', '1', '2']],
          ]),
        }),
      ),
    )
    const screen = await renderWithProviders(
      <EdgeQubeLens
        sourceId="selParam"
        targetId="selStep"
        inputName="dataset"
        hovered={false}
      />,
    )
    await expect.element(screen.getByText('3D')).toBeVisible()
  })

  it('renders nothing when the backend sends no qube for the edge', async () => {
    act(() =>
      useFableBuilderStore.getState().setValidationState(validationWith({})),
    )
    const screen = await renderWithProviders(
      <EdgeQubeLens
        sourceId="selParam"
        targetId="selStep"
        inputName="dataset"
        hovered={false}
      />,
    )
    await expect
      .element(
        screen.getByRole('button', { name: 'Inspect the qube on this edge' }),
      )
      .not.toBeInTheDocument()
  })

  it('opens the inspector with stats and a Selection tab on click', async () => {
    act(() =>
      useFableBuilderStore.getState().setValidationState(
        validationWith({
          selParam: linearQube([
            ['param', ['2t']],
            ['step', ['24', '48']],
          ]),
        }),
      ),
    )
    const screen = await renderWithProviders(
      <EdgeQubeLens
        sourceId="selParam"
        targetId="selStep"
        inputName="dataset"
        hovered
      />,
    )
    await screen
      .getByRole('button', { name: 'Inspect the qube on this edge' })
      .click()

    await expect.element(screen.getByText('Qube at this edge')).toBeVisible()
    await expect
      .element(screen.getByText('Select param → Select step'))
      .toBeVisible()
    // The (source-neutral) selection tab is present.
    await expect.element(screen.getByText('Selection')).toBeVisible()
  })

  it('shows the upstream narrowing diff from comparing input and output qubes', async () => {
    act(() =>
      useFableBuilderStore.getState().setValidationState(
        validationWith({
          src: linearQube([
            ['param', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']],
          ]),
          selParam: linearQube([['param', ['a']]]),
        }),
      ),
    )
    const screen = await renderWithProviders(
      <EdgeQubeLens
        sourceId="selParam"
        targetId="selStep"
        inputName="dataset"
        hovered
      />,
    )
    await screen
      .getByRole('button', { name: 'Inspect the qube on this edge' })
      .click()
    // param dropped 8 → 1 between src's output and selParam's output.
    await expect.element(screen.getByText('narrowed 8 → 1')).toBeVisible()
  })

  it('renders nothing without a validation snapshot', async () => {
    act(() => useFableBuilderStore.getState().setValidationState(null))
    const screen = await renderWithProviders(
      <EdgeQubeLens
        sourceId="selParam"
        targetId="selStep"
        inputName="dataset"
        hovered={false}
      />,
    )
    await expect
      .element(
        screen.getByRole('button', { name: 'Inspect the qube on this edge' }),
      )
      .not.toBeInTheDocument()
  })
})
