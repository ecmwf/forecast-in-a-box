/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/**
 * "Build and run your first forecast" — clean /configure canvas to a
 * submitted run on one canonical pipeline (source → select → ensemble
 * statistics → map plot). The only module that knows both engine and page.
 */

import { TOUR, findTourElement, tourActionSelector } from '../anchors'
import type {
  AdvanceWhen,
  ShowMeAction,
  StepBlocker,
  TutorialDefinition,
} from '../engine/types'
import type {
  BlockFactoryCatalogue,
  BlockKind,
  PluginBlockFactoryId,
} from '@/api/types/fable.types'
import {
  BLOCK_KIND_METADATA,
  factoryIdToKey,
  getFactory,
} from '@/api/types/fable.types'
import { useBlockCatalogue } from '@/api/hooks/useFable'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

/** Canonical blocks: the ECMWF base plugin, one of each kind. */
const PLUGIN = { store: 'ecmwf', local: 'ecmwf-base' }
const CANON: Record<BlockKind, PluginBlockFactoryId> = {
  source: { plugin: PLUGIN, factory: 'operationalForecastSource' },
  transform: { plugin: PLUGIN, factory: 'select' },
  product: { plugin: PLUGIN, factory: 'ensembleStatistics' },
  sink: { plugin: PLUGIN, factory: 'mapPlotSink' },
}
const CANON_KEY = Object.fromEntries(
  Object.entries(CANON).map(([kind, id]) => [kind, factoryIdToKey(id)]),
) as Record<BlockKind, string>

/** Titles as the catalogue spells them; fallbacks keep copy readable. */
const FALLBACK_TITLE: Record<BlockKind, string> = {
  source: 'Operational forecast source',
  transform: 'Select',
  product: 'Ensemble Statistics',
  sink: 'Map Plot',
}

/** Values every configure step teaches (and Show me applies). */
const CANON_VALUES: Record<BlockKind, Record<string, string>> = {
  source: { source: 'ecmwf-open-data', forecast: 'ifs-ens' },
  transform: { dimension: 'step', values: '72' },
  product: { param: '2t', statistic: 'mean' },
  sink: {
    param: '2t',
    domain: 'global',
    format: 'png',
    groupby: 'none',
    splitby: 'none',
  },
}

const DAY_MS = 24 * 60 * 60 * 1000
/** Open data keeps only a few days of base times. */
const MAX_BASE_TIME_AGE_MS = 4 * DAY_MS

/** Yesterday 00 UTC (wire form). */
function recentBaseTime(): string {
  const day = new Date(Date.now() - DAY_MS)
  return `${day.toISOString().slice(0, 10)}T00:00:00`
}

/** Past, and still within open-data retention. */
function isRecentBaseTime(value: string): boolean {
  const age = Date.now() - Date.parse(`${value}Z`)
  return age >= 0 && age <= MAX_BASE_TIME_AGE_MS
}

export interface FirstRunLaunch {
  titles: Record<BlockKind, string>
}

/** Last catalogue seen by the launch hook — names stray blocks in hints. */
let catalogueRef: BlockFactoryCatalogue | null = null

export function useFirstRunLaunchContext(): FirstRunLaunch | null {
  const { data: catalogue } = useBlockCatalogue()
  if (catalogue === undefined) return null
  catalogueRef = catalogue
  return { titles: canonicalTitles(catalogue) }
}

function canonicalTitles(
  catalogue: BlockFactoryCatalogue,
): Record<BlockKind, string> {
  const titles = { ...FALLBACK_TITLE }
  for (const kind of Object.keys(CANON) as Array<BlockKind>) {
    const factory = getFactory(catalogue, CANON[kind])
    if (factory !== undefined) titles[kind] = factory.title
  }
  return titles
}

// -------- Builder-store signals --------

const state = () => useFableBuilderStore.getState()

/** Instance id of the canonical block of `kind`, if on the canvas. */
function blockOf(kind: BlockKind): string | null {
  for (const [id, block] of Object.entries(state().fable.blocks)) {
    if (factoryIdToKey(block.factory_id) === CANON_KEY[kind]) return id
  }
  return null
}

/** Validation settled and clean; sinks without expansions have no entry. */
function blockValid(kind: BlockKind): boolean {
  const id = blockOf(kind)
  const validation = state().validationState
  if (id === null || validation === null) return false
  return (
    !(id in validation.blockStates) || !validation.blockStates[id].hasErrors
  )
}

const CANON_KEYS = new Set(Object.values(CANON_KEY))

/** Blocks outside the tour's pipeline: other factories, or duplicates. */
function strayBlocks(): Array<string> {
  const seen = new Set<string>()
  const strays: Array<string> = []
  for (const [id, block] of Object.entries(state().fable.blocks)) {
    const key = factoryIdToKey(block.factory_id)
    if (!CANON_KEYS.has(key) || seen.has(key)) strays.push(id)
    else seen.add(key)
  }
  return strays
}

function blockTitle(id: string): string {
  const { factory_id } = state().fable.blocks[id]
  const factory =
    catalogueRef === null ? undefined : getFactory(catalogueRef, factory_id)
  return factory?.title ?? factory_id.factory
}

const UPSTREAM: Partial<Record<BlockKind, BlockKind>> = {
  transform: 'source',
  product: 'transform',
  sink: 'product',
}

/** The block's (single) input feeds from the canonical upstream block. */
function wired(kind: BlockKind): boolean {
  const upstream = UPSTREAM[kind]
  if (upstream === undefined) return true
  const id = blockOf(kind)
  const upstreamId = blockOf(upstream)
  if (id === null || upstreamId === null) return false
  const [inputName] = Object.keys(state().fable.blocks[id].input_ids)
  return state().fable.blocks[id].input_ids[inputName] === upstreamId
}

/** Rails: first field off the tour's values (the run is the tested one). */
function offScriptField(kind: BlockKind): string | null {
  const id = blockOf(kind)
  if (id === null) return null
  const values = state().fable.blocks[id].configuration_values
  for (const [key, value] of Object.entries(CANON_VALUES[kind])) {
    if (values[key] !== value) return key
  }
  if (kind === 'source' && !isRecentBaseTime(values.base_time)) {
    return 'base_time'
  }
  return null
}

const blockCanonical = (kind: BlockKind) =>
  blockOf(kind) !== null && offScriptField(kind) === null

/** Card hint, by priority: stray block, wiring, off-script field, issues. */
function explainRails(kind: BlockKind): StepBlocker | null {
  const stray = strayBlocks().at(0)
  if (stray !== undefined) {
    return { key: 'rails.stray', values: { block: blockTitle(stray) } }
  }
  if (blockOf(kind) === null) return null
  if (!wired(kind)) {
    const titles =
      catalogueRef === null ? FALLBACK_TITLE : canonicalTitles(catalogueRef)
    return {
      key: 'rails.unwired',
      values: { block: titles[kind], upstream: titles[UPSTREAM[kind] ?? kind] },
    }
  }
  const field = offScriptField(kind)
  if (field !== null) return { key: `rails.${kind}.${field}` }
  const validation = state().validationState
  return validation !== null && !blockValid(kind)
    ? { key: 'rails.invalid' }
    : null
}

/** Structure rails: on script so far, and the block sits in its place. */
const onScript = (kind: BlockKind) =>
  strayBlocks().length === 0 && blockOf(kind) !== null && wired(kind)

const canonicalAndValid = (kind: BlockKind) =>
  signal(
    () => onScript(kind) && blockCanonical(kind) && blockValid(kind),
    () => explainRails(kind),
  )

/** Show me fixes structure first: drop strays, then wire, then `action`. */
const railed =
  (kind: BlockKind, action: () => ShowMeAction) => (): ShowMeAction => {
    const strays = strayBlocks()
    if (strays.length > 0) {
      return {
        apply: () => {
          for (const id of strays) state().removeBlock(id)
          return true
        },
      }
    }
    const id = blockOf(kind)
    const upstream = UPSTREAM[kind]
    if (id !== null && upstream !== undefined && !wired(kind)) {
      return {
        apply: () => {
          const upstreamId = blockOf(upstream)
          if (upstreamId === null) return false
          const [inputName] = Object.keys(state().fable.blocks[id].input_ids)
          state().connectBlocks(id, inputName, upstreamId)
          return true
        },
      }
    }
    return action()
  }

function signal(
  check: () => boolean,
  explain?: () => StepBlocker | null,
): AdvanceWhen {
  return {
    kind: 'signal',
    subscribe: (onChange) => useFableBuilderStore.subscribe(onChange),
    check,
    explain,
  }
}

const CANVAS_EMPTY = signal(
  () => Object.keys(state().fable.blocks).length === 0,
)

// -------- Show me actions --------

const factoryRow = (kind: BlockKind) =>
  `[data-factory-key=${JSON.stringify(CANON_KEY[kind])}]${tourActionSelector('add-block')}`

const kindMatch = (kind: BlockKind) => `[data-block-kind="${kind}"]`

/** Press the + handle on the canonical `from` block, then the menu row. */
const chainFrom = (from: BlockKind, add: BlockKind) => ({
  within: TOUR.configure.addDownstream,
  withinMatch: kindMatch(from),
  then: { within: TOUR.configure.addMenu, selector: factoryRow(add) },
})

/** Fill the canonical values into the block of `kind`. */
const fill = (kind: BlockKind) => ({
  apply: () => {
    const id = blockOf(kind)
    if (id === null) return false
    const values =
      kind === 'source'
        ? { ...CANON_VALUES.source, base_time: recentBaseTime() }
        : CANON_VALUES[kind]
    state().updateBlockConfigBatch(id, values)
    return true
  },
})

/** Combined add-and-fill step: add first, fill once the block exists. */
const addThenFill = (from: BlockKind, kind: BlockKind) => () =>
  blockOf(kind) === null ? chainFrom(from, kind) : fill(kind)

/** Its second phase re-anchors to the config panel with `fill` copy. */
const fillVariant = (kind: BlockKind) => ({
  whenPresent: TOUR.configure.block,
  whenPresentMatch: kindMatch(kind),
  key: 'fill',
  anchor: TOUR.configure.configPanel,
})

/** Kind tags in copy (`<sourceKind>` …) take the palette colours. */
const kindMarkup = (kind: BlockKind) => (
  <span className={`font-medium ${BLOCK_KIND_METADATA[kind].color}`} />
)

export const firstRunDefinition: TutorialDefinition<FirstRunLaunch> = {
  id: 'configure-first-run',
  route: '/configure',
  i18nKey: 'firstRun',
  copyValues: (launch) => ({
    sourceBlock: launch.titles.source,
    transformBlock: launch.titles.transform,
    productBlock: launch.titles.product,
    outputBlock: launch.titles.sink,
  }),
  markup: {
    sourceKind: kindMarkup('source'),
    transformKind: kindMarkup('transform'),
    productKind: kindMarkup('product'),
    outputKind: kindMarkup('sink'),
  },
  steps: [
    {
      id: 'orient',
      anchor: TOUR.configure.canvas,
      side: 'top',
      advance: { kind: 'next-click' },
      variant: { whenPresent: TOUR.configure.block, key: 'midSession' },
    },
    {
      // Repeatable by construction: the tour builds from nothing.
      id: 'fresh',
      anchor: TOUR.configure.newConfig,
      side: 'bottom',
      advance: CANVAS_EMPTY,
      showMe: { within: TOUR.configure.newConfig },
    },
    {
      id: 'palette',
      anchor: TOUR.configure.palette,
      side: 'right',
      advance: { kind: 'next-click' },
      expandVia: TOUR.configure.expandPalette,
    },
    {
      id: 'plugins',
      anchor: TOUR.configure.palette,
      side: 'right',
      advance: { kind: 'next-click' },
      expandVia: TOUR.configure.expandPalette,
    },
    {
      id: 'addSource',
      anchor: TOUR.configure.palette,
      side: 'right',
      advance: signal(
        () => onScript('source'),
        () => explainRails('source'),
      ),
      expandVia: TOUR.configure.expandPalette,
      showMe: railed('source', () => ({
        within: TOUR.configure.palette,
        selector: factoryRow('source'),
      })),
    },
    {
      id: 'validation',
      anchor: TOUR.configure.validation,
      side: 'bottom',
      advance: { kind: 'next-click' },
    },
    {
      id: 'configureSource',
      anchor: TOUR.configure.configPanel,
      side: 'left',
      advance: canonicalAndValid('source'),
      expandVia: TOUR.configure.expandConfig,
      showMe: railed('source', () => fill('source')),
    },
    {
      id: 'addTransform',
      anchor: TOUR.configure.addDownstream,
      anchorMatch: kindMatch('source'),
      side: 'right',
      advance: signal(
        () => onScript('transform'),
        () => explainRails('transform'),
      ),
      showMe: railed('transform', () => chainFrom('source', 'transform')),
      yieldTo: TOUR.configure.addMenu,
    },
    {
      id: 'configureTransform',
      anchor: TOUR.configure.configPanel,
      side: 'left',
      advance: canonicalAndValid('transform'),
      expandVia: TOUR.configure.expandConfig,
      showMe: railed('transform', () => fill('transform')),
    },
    {
      id: 'product',
      anchor: TOUR.configure.addDownstream,
      anchorMatch: kindMatch('transform'),
      side: 'right',
      advance: canonicalAndValid('product'),
      showMe: railed('product', addThenFill('transform', 'product')),
      yieldTo: TOUR.configure.addMenu,
      variant: fillVariant('product'),
    },
    {
      id: 'output',
      anchor: TOUR.configure.addDownstream,
      anchorMatch: kindMatch('product'),
      side: 'right',
      advance: signal(
        () =>
          onScript('sink') &&
          blockCanonical('sink') &&
          blockValid('sink') &&
          state().validationState?.isValid === true,
        () => explainRails('sink'),
      ),
      showMe: railed('sink', addThenFill('product', 'sink')),
      yieldTo: TOUR.configure.addMenu,
      variant: fillVariant('sink'),
    },
    {
      // Terminal: the submit navigates to the run page and completes the tour.
      id: 'run',
      anchor: TOUR.configure.runOnce,
      side: 'bottom',
      advance: {
        kind: 'route',
        match: (pathname) => pathname.startsWith('/execute/'),
      },
      showMe: () =>
        findTourElement(TOUR.configure.runOnce, ':not([disabled])') === null
          ? { apply: () => false }
          : { within: TOUR.configure.runOnce },
    },
  ],
}
