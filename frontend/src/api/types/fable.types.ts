/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Cloud, Cog, Download, Shuffle } from 'lucide-react'
import { z } from 'zod'
import i18n from 'i18next'
import { EnvironmentSpecificationSchema } from './job.types'
import { QubeNodeSchema } from './artifacts.types'
import {
  PluginCompositeIdSchema,
  parsePluginKey,
  toPluginDisplayId,
} from './plugins.types'
import type { QubeNode } from './artifacts.types'
import type { LucideIcon } from 'lucide-react'
import type { PluginCompositeId } from './plugins.types'

export type PluginId = string
export type BlockFactoryId = string
export type BlockInstanceId = string

/**
 * Plugin block factory ID - identifies a block factory within a plugin
 *
 * Backend format: { plugin: { store: "ecmwf", local: "toy1" }, factory: "block_name" }
 */
export const PluginBlockFactoryIdSchema = z.object({
  plugin: PluginCompositeIdSchema,
  factory: z.string(),
})

export type PluginBlockFactoryId = z.infer<typeof PluginBlockFactoryIdSchema>

/**
 * Expansion item from PUT /blueprint/expand.
 *
 * Backend now includes per-option restrictions in addition to plugin+factory.
 */
export const BlockExpansionSchema = z.object({
  plugin: PluginCompositeIdSchema,
  factory: z.string(),
  restrictions: z.record(z.string(), z.string()).optional().default({}),
})

export type BlockExpansion = z.infer<typeof BlockExpansionSchema>

export const BlockConfigurationOptionSchema = z.object({
  title: z.string(),
  description: z.string(),
  value_type: z.string(),
  default_value: z.string().nullable().optional(),
})

export type BlockConfigurationOption = z.infer<
  typeof BlockConfigurationOptionSchema
>

export const BlockKindSchema = z.enum([
  'source',
  'transform',
  'product',
  'sink',
])

export type BlockKind = z.infer<typeof BlockKindSchema>

export const BlockFactorySchema = z.object({
  kind: BlockKindSchema,
  title: z.string(),
  description: z.string(),
  configuration_options: z.record(z.string(), BlockConfigurationOptionSchema),
  inputs: z.array(z.string()),
})

export type BlockFactory = z.infer<typeof BlockFactorySchema>

export const PluginCatalogueSchema = z.object({
  factories: z.record(z.string(), BlockFactorySchema),
})

export type PluginCatalogue = z.infer<typeof PluginCatalogueSchema>

/**
 * Block factory catalogue - dict of plugins keyed by plugin ID
 *
 * Backend returns keys in Python repr format: "store='ecmwf' local='toy1'"
 * We normalize to display format: "ecmwf/toy1"
 */
export const BlockFactoryCatalogueSchema = z.record(
  z.string(),
  PluginCatalogueSchema,
)

export type BlockFactoryCatalogue = z.infer<typeof BlockFactoryCatalogueSchema>

export const BlockInstanceSchema = z.object({
  factory_id: PluginBlockFactoryIdSchema,
  configuration_values: z.record(z.string(), z.string()),
  input_ids: z.record(z.string(), z.string()),
})

export type BlockInstance = z.infer<typeof BlockInstanceSchema>

export const FableBuilderV1Schema = z.object({
  blocks: z.record(z.string(), BlockInstanceSchema),
  environment: EnvironmentSpecificationSchema.nullable().optional(),
  local_glyphs: z.record(z.string(), z.string()).optional(),
})

export type FableBuilderV1 = z.infer<typeof FableBuilderV1Schema>

/**
 * Intrinsic glyph item from GET /api/v1/blueprint/glyphs/list?glyph_type=intrinsic
 */
export const IntrinsicGlyphItemSchema = z.object({
  glyph_type: z.literal('intrinsic'),
  name: z.string(),
  display_name: z.string(),
  valueExample: z.string(),
  created_by: z.string(),
})

export type IntrinsicGlyphItem = z.infer<typeof IntrinsicGlyphItemSchema>

/**
 * Global glyph item from GET /api/v1/blueprint/glyphs/list?glyph_type=global
 */
export const GlobalGlyphItemSchema = z.object({
  glyph_type: z.literal('global'),
  global_glyph_id: z.string(),
  key: z.string(),
  value: z.string(),
  public: z.boolean(),
  overriddable: z.boolean().nullable(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type GlobalGlyphItem = z.infer<typeof GlobalGlyphItemSchema>

/** Discriminated union of glyph list items */
export const GlyphListItemSchema = z.discriminatedUnion('glyph_type', [
  IntrinsicGlyphItemSchema,
  GlobalGlyphItemSchema,
])

export type GlyphListItem = z.infer<typeof GlyphListItemSchema>

/** Paginated response from GET /api/v1/blueprint/glyphs/list */
export const GlyphListResponseSchema = z.object({
  glyphs: z.array(GlyphListItemSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
})

export type GlyphListResponse = z.infer<typeof GlyphListResponseSchema>

/**
 * POST /blueprint/glyphs/global/post — outbound request.
 *
 * `overriddable` must be omitted (or null) when `public=false` and set to a
 * concrete boolean when `public=true`. Non-admins may not submit `public=true`;
 * the server returns 403 in that case.
 */
export interface GlobalGlyphPostRequest {
  key: string
  value: string
  public?: boolean
  overriddable?: boolean | null
}

/** Response from global glyph endpoints */
export const GlobalGlyphResponseSchema = z.object({
  glyph_type: z.literal('global'),
  global_glyph_id: z.string(),
  key: z.string(),
  value: z.string(),
  public: z.boolean(),
  overriddable: z.boolean().nullable(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type GlobalGlyphResponse = z.infer<typeof GlobalGlyphResponseSchema>

/** Single entry from GET /blueprint/glyphs/functions — a Jinja filter or global. */
export const GlyphFunctionDetailSchema = z.object({
  name: z.string(),
  description: z.string(),
  kind: z.enum(['filter', 'global']),
})

export type GlyphFunctionDetail = z.infer<typeof GlyphFunctionDetailSchema>

/** Response from GET /blueprint/glyphs/functions */
export const GlyphFunctionsResponseSchema = z.object({
  functions: z.array(GlyphFunctionDetailSchema),
})

export type GlyphFunctionsResponse = z.infer<
  typeof GlyphFunctionsResponseSchema
>

export const FableValidationExpansionSchema = z.object({
  global_errors: z.array(z.string()),
  block_errors: z.record(z.string(), z.array(z.string())),
  possible_sources: z.array(PluginBlockFactoryIdSchema),
  possible_expansions: z.record(z.string(), z.array(BlockExpansionSchema)),
  configuration_restrictions: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional()
    .default({}),
  resolved_configuration_options: z
    .record(z.string(), z.record(z.string(), z.string()))
    .optional()
    .default({}),
  missing_glyphs: z
    .record(z.string(), z.record(z.string(), z.array(z.string())))
    .optional()
    .default({}),
  /** Per-block output qube (qubed node tree) for the graph qube lens. */
  block_output_qubes: z
    .record(z.string(), QubeNodeSchema)
    .optional()
    .default({}),
})

export type FableValidationExpansion = z.infer<
  typeof FableValidationExpansionSchema
>

export const FableUpsertResponseSchema = z.object({
  blueprint_id: z.string(),
  version: z.number(),
})

export type FableUpsertResponse = z.infer<typeof FableUpsertResponseSchema>

export interface FableUpsertRequest {
  builder: FableBuilderV1
  display_name: string | null
  display_description: string | null
  tags: Array<string>
  parent_id?: string
}

/** Reserved tag (backend #494): value holds the version-mismatch detail
 * (e.g. `"!3 != 4"`). Stripped from user tags, surfaced as a warning. */
export const CORE_VERSION_MISMATCH_KEY = 'CoreVersionMismatch'

/** Backend tag: `value` is null for plain labels, set for informational ones. */
const TagObjectSchema = z.object({
  key: z.string(),
  value: z.string().nullish(),
})

export interface PartitionedTags {
  /** User-facing tag keys (reserved keys removed). */
  tags: Array<string>
  /** `CoreVersionMismatch` detail, or null when versions agree. */
  coreVersionMismatch: string | null
}

/** Split backend tags into plain keys (kept as `string[]` for existing
 * save/search/group/display) and the extracted mismatch detail. */
export function partitionBlueprintTags(
  raw: ReadonlyArray<{ key: string; value?: string | null }>,
): PartitionedTags {
  let coreVersionMismatch: string | null = null
  const tags: Array<string> = []
  for (const tag of raw) {
    if (tag.key === CORE_VERSION_MISMATCH_KEY) {
      coreVersionMismatch = tag.value ?? null
    } else {
      tags.push(tag.key)
    }
  }
  return { tags, coreVersionMismatch }
}

/** routes/blueprint.py: BlueprintListItem */
export const BlueprintListItemSchema = z
  .object({
    blueprint_id: z.string(),
    version: z.number(),
    display_name: z.string().nullable(),
    display_description: z.string().nullable(),
    tags: z.array(TagObjectSchema).nullable(),
    source: z.string().nullable(),
    created_by: z.string().nullable(),
  })
  .transform(({ tags, ...rest }) => ({
    ...rest,
    ...partitionBlueprintTags(tags ?? []),
  }))

export type BlueprintListItem = z.infer<typeof BlueprintListItemSchema>

/** routes/blueprint.py: BlueprintListResponse */
export const BlueprintListResponseSchema = z.object({
  blueprints: z.array(BlueprintListItemSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
})

export type BlueprintListResponse = z.infer<typeof BlueprintListResponseSchema>

/** POST /blueprint/update — outbound only */
export interface BlueprintUpdateRequest {
  blueprint_id: string
  version: number
  builder: FableBuilderV1
  display_name?: string | null
  display_description?: string | null
  tags?: Array<string>
  parent_id?: string | null
}

/** POST /blueprint/delete — outbound only */
export interface BlueprintDeleteRequest {
  blueprint_id: string
  version: number
}

export const FableRetrieveResponseSchema = z
  .object({
    blueprint_id: z.string(),
    version: z.number(),
    builder: FableBuilderV1Schema,
    display_name: z.string().nullable(),
    display_description: z.string().nullable(),
    tags: z.array(TagObjectSchema),
    parent_id: z.string().nullable().optional(),
  })
  .transform(({ tags, ...rest }) => ({
    ...rest,
    ...partitionBlueprintTags(tags),
  }))

export type FableRetrieveResponse = z.infer<typeof FableRetrieveResponseSchema>

export interface BlockWithFactory {
  instanceId: BlockInstanceId
  instance: BlockInstance
  factory: BlockFactory
}

export interface BlockValidationState {
  errors: Array<string>
  hasErrors: boolean
  possibleExpansions: Array<PluginBlockFactoryId>
  /** Per-child-factory config restrictions. Outer key
   * `factoryIdToKey(childId)`; inner maps option id → FableType (e.g.
   * `mapPlotSink → { param: "list[enumClosed[…]]" }`). */
  possibleExpansionRestrictions: Record<string, Record<string, string>>
  /** Config restrictions for this block's own fields. */
  configurationRestrictions: Record<string, string>
  /** Unknown glyph names per option, from /blueprint/expand. */
  missingGlyphs: Record<string, Array<string>>
}

export interface FableValidationState {
  isValid: boolean
  globalErrors: Array<string>
  blockStates: Record<BlockInstanceId, BlockValidationState>
  possibleSources: Array<PluginBlockFactoryId>
  /**
   * Backend-resolved configuration values, keyed by BlockInstanceId then
   * configuration key. Only contains entries whose original value contained
   * glyph references (${...}). Sourced from /blueprint/expand — the frontend
   * never resolves glyphs client-side.
   */
  resolvedConfigurationOptions: Record<BlockInstanceId, Record<string, string>>
  /**
   * Per-block output qube (qubed node tree), keyed by BlockInstanceId.
   * The qube flowing out of a block — i.e. on every edge leaving it. Used by
   * the graph qube lens; empty when the backend doesn't provide it.
   */
  blockOutputQubes: Record<BlockInstanceId, QubeNode>
}

export interface BlockKindMetadata {
  kind: BlockKind
  label: string
  description: string
  color: string
  bgColor: string
  borderColor: string
  topBarColor: string
  handleColor: string
  icon: string
}

export const BLOCK_KIND_ORDER: Array<BlockKind> = [
  'source',
  'transform',
  'product',
  'sink',
]

// `label`/`description` are getters so they resolve through i18next on access
// (at render), keeping this module free of the i18n initialisation side-effect.
export const BLOCK_KIND_METADATA: Record<BlockKind, BlockKindMetadata> = {
  source: {
    kind: 'source',
    get label() {
      return i18n.t('configure:blockKind.source.label')
    },
    get description() {
      return i18n.t('configure:blockKind.source.description')
    },
    color: 'text-blue-500',
    bgColor: 'bg-blue-50 dark:bg-blue-950',
    borderColor: 'border-blue-200 dark:border-blue-800',
    topBarColor: 'bg-blue-500',
    handleColor: 'border-blue-500',
    icon: 'Cloud',
  },
  transform: {
    kind: 'transform',
    get label() {
      return i18n.t('configure:blockKind.transform.label')
    },
    get description() {
      return i18n.t('configure:blockKind.transform.description')
    },
    color: 'text-amber-500',
    bgColor: 'bg-amber-50 dark:bg-amber-950',
    borderColor: 'border-amber-200 dark:border-amber-800',
    topBarColor: 'bg-amber-500',
    handleColor: 'border-amber-500',
    icon: 'Shuffle',
  },
  product: {
    kind: 'product',
    get label() {
      return i18n.t('configure:blockKind.product.label')
    },
    get description() {
      return i18n.t('configure:blockKind.product.description')
    },
    color: 'text-purple-500',
    bgColor: 'bg-purple-50 dark:bg-purple-950',
    borderColor: 'border-purple-200 dark:border-purple-800',
    topBarColor: 'bg-purple-500',
    handleColor: 'border-purple-500',
    icon: 'Cog',
  },
  sink: {
    kind: 'sink',
    get label() {
      return i18n.t('configure:blockKind.sink.label')
    },
    get description() {
      return i18n.t('configure:blockKind.sink.description')
    },
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    topBarColor: 'bg-emerald-500',
    handleColor: 'border-emerald-500',
    icon: 'Download',
  },
}

const BLOCK_KIND_ICONS: Record<BlockKind, LucideIcon> = {
  source: Cloud,
  transform: Shuffle,
  product: Cog,
  sink: Download,
}

export function getBlockKindIcon(kind: BlockKind): LucideIcon {
  return BLOCK_KIND_ICONS[kind]
}

export function createEmptyFable(): FableBuilderV1 {
  return {
    blocks: {},
    local_glyphs: {},
  }
}

export function generateBlockInstanceId(): BlockInstanceId {
  return `block_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * Convert PluginCompositeId to a display string for catalogue keys
 */
export function pluginIdToDisplayKey(plugin: PluginCompositeId): string {
  return toPluginDisplayId(plugin)
}

/**
 * Parse a display plugin ID string (e.g., "ecmwf/toy1") to PluginCompositeId
 */
export function parseDisplayPluginId(displayId: string): PluginCompositeId {
  const slashIndex = displayId.indexOf('/')
  if (slashIndex === -1) {
    return { store: '', local: displayId }
  }
  return {
    store: displayId.substring(0, slashIndex),
    local: displayId.substring(slashIndex + 1),
  }
}

/**
 * Get a factory from the nested catalogue by PluginBlockFactoryId
 *
 * The catalogue uses normalized display format keys (e.g., "ecmwf/toy1")
 */
export function getFactory(
  catalogue: BlockFactoryCatalogue,
  factoryId: PluginBlockFactoryId,
): BlockFactory | undefined {
  const pluginKey = pluginIdToDisplayKey(factoryId.plugin)
  const pluginCatalogue = catalogue[pluginKey] as PluginCatalogue | undefined
  return pluginCatalogue?.factories[factoryId.factory]
}

/**
 * Convert PluginBlockFactoryId to a string key for use in maps/comparisons
 */
export function factoryIdToKey(id: PluginBlockFactoryId): string {
  return `${pluginIdToDisplayKey(id.plugin)}:${id.factory}`
}

/**
 * Normalize catalogue keys from backend format to display format
 *
 * Backend sends keys in Python repr format: "store='ecmwf' local='toy1'"
 * We normalize to display format: "ecmwf/toy1"
 */
export function normalizeCatalogueKeys(
  rawCatalogue: Record<string, PluginCatalogue>,
): BlockFactoryCatalogue {
  const normalized: BlockFactoryCatalogue = {}

  for (const [key, value] of Object.entries(rawCatalogue)) {
    // Check if key is in Python repr format
    if (key.includes("store='") && key.includes("local='")) {
      const parsed = parsePluginKey(key)
      const normalizedKey = toPluginDisplayId(parsed)
      normalized[normalizedKey] = value
    } else {
      // Key is already in normalized format
      normalized[key] = value
    }
  }

  return normalized
}

/**
 * Flatten the nested catalogue into a flat map for iteration
 */
export function flattenCatalogue(catalogue: BlockFactoryCatalogue): Array<{
  pluginId: PluginId
  factoryId: BlockFactoryId
  factory: BlockFactory
}> {
  const result: Array<{
    pluginId: PluginId
    factoryId: BlockFactoryId
    factory: BlockFactory
  }> = []
  for (const [pluginId, pluginCatalogue] of Object.entries(catalogue)) {
    for (const [factoryId, factory] of Object.entries(
      pluginCatalogue.factories,
    )) {
      result.push({ pluginId, factoryId, factory })
    }
  }
  return result
}

/**
 * Group flattened catalogue entries by kind
 */
export function groupCatalogueByKind(catalogue: BlockFactoryCatalogue): Record<
  BlockKind,
  Array<{
    pluginId: PluginId
    factoryId: BlockFactoryId
    factory: BlockFactory
  }>
> {
  const result: Record<
    BlockKind,
    Array<{
      pluginId: PluginId
      factoryId: BlockFactoryId
      factory: BlockFactory
    }>
  > = {
    source: [],
    transform: [],
    product: [],
    sink: [],
  }
  for (const entry of flattenCatalogue(catalogue)) {
    result[entry.factory.kind].push(entry)
  }
  return result
}

export function createBlockInstance(
  factoryId: PluginBlockFactoryId,
  factory: BlockFactory,
): BlockInstance {
  const configurationValues: Record<string, string> = {}
  for (const [key, option] of Object.entries(factory.configuration_options)) {
    configurationValues[key] = option.default_value ?? ''
  }

  const inputIds: Record<string, string> = {}
  for (const inputName of factory.inputs) {
    inputIds[inputName] = ''
  }

  return {
    factory_id: factoryId,
    configuration_values: configurationValues,
    input_ids: inputIds,
  }
}

export function fableHasBlocks(fable: FableBuilderV1): boolean {
  return Object.keys(fable.blocks).length > 0
}

export function getBlocksByKind(
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
  kind: BlockKind,
): Array<{ instanceId: BlockInstanceId; instance: BlockInstance }> {
  return Object.entries(fable.blocks)
    .filter(([_, instance]) => {
      const factory = getFactory(catalogue, instance.factory_id)
      return factory?.kind === kind
    })
    .map(([instanceId, instance]) => ({ instanceId, instance }))
}

export function toValidationState(
  expansion: FableValidationExpansion,
  fable?: FableBuilderV1,
  catalogue?: BlockFactoryCatalogue,
): FableValidationState {
  const blockStates: Record<BlockInstanceId, BlockValidationState> = {}
  const configurationRestrictionsByBlock = expansion.configuration_restrictions
  const missingRequiredByBlock =
    fable && catalogue ? getMissingRequiredConfigErrors(fable, catalogue) : {}
  const allBlockIds = new Set<string>([
    ...Object.keys(expansion.block_errors),
    ...Object.keys(expansion.possible_expansions),
    ...Object.keys(configurationRestrictionsByBlock),
    ...Object.keys(missingRequiredByBlock),
    ...Object.keys(expansion.missing_glyphs),
  ])

  for (const blockId of allBlockIds) {
    const backendErrors = expansion.block_errors[blockId] ?? []
    const missingErrors = missingRequiredByBlock[blockId] ?? []
    const errors = [...backendErrors, ...missingErrors]
    const missingGlyphs = expansion.missing_glyphs[blockId] ?? {}
    const possibleExpansions = expansion.possible_expansions[blockId] ?? []
    const hasMissingGlyphs = Object.values(missingGlyphs).some(
      (names) => names.length > 0,
    )
    blockStates[blockId] = {
      errors,
      hasErrors: errors.length > 0 || hasMissingGlyphs,
      possibleExpansions: toPluginFactoryIds(possibleExpansions),
      possibleExpansionRestrictions:
        toExpansionRestrictionMap(possibleExpansions),
      configurationRestrictions:
        configurationRestrictionsByBlock[blockId] ?? {},
      missingGlyphs,
    }
  }

  const hasAnyErrors =
    expansion.global_errors.length > 0 ||
    Object.values(blockStates).some((state) => state.hasErrors)

  return {
    isValid: !hasAnyErrors,
    globalErrors: expansion.global_errors,
    blockStates,
    possibleSources: expansion.possible_sources,
    resolvedConfigurationOptions: expansion.resolved_configuration_options,
    blockOutputQubes: expansion.block_output_qubes,
  }
}

function toPluginFactoryIds(
  expansions: ReadonlyArray<BlockExpansion>,
): Array<PluginBlockFactoryId> {
  return expansions.map((expansion) => ({
    plugin: expansion.plugin,
    factory: expansion.factory,
  }))
}

function toExpansionRestrictionMap(
  expansions: ReadonlyArray<BlockExpansion>,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {}
  for (const expansion of expansions) {
    result[factoryIdToKey(expansion)] = expansion.restrictions
  }
  return result
}

function isOptionalValueType(valueType: string): boolean {
  return /^optional\[(.+)\]$/i.test(valueType.trim())
}

function getRecordItem<T>(
  record: Record<string, T>,
  key: string,
): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

export function getBlockConfigurationRestrictions(
  fable: FableBuilderV1,
  validationState: FableValidationState | null,
  blockId: BlockInstanceId,
): Record<string, string> {
  const block = getRecordItem(fable.blocks, blockId)
  if (!block || !validationState) return {}

  const blockFactoryKey = factoryIdToKey(block.factory_id)
  const restrictions: Record<string, string> = {}
  for (const sourceId of Object.values(block.input_ids)) {
    const sourceState = getRecordItem(validationState.blockStates, sourceId)
    const sourceRestrictions = sourceState
      ? getRecordItem(
          sourceState.possibleExpansionRestrictions,
          blockFactoryKey,
        )
      : undefined

    Object.assign(restrictions, sourceRestrictions)
  }
  const blockState = getRecordItem(validationState.blockStates, blockId)
  Object.assign(restrictions, blockState?.configurationRestrictions)
  return restrictions
}

function toPythonStringSet(items: ReadonlyArray<string>): string {
  return `{${items.map((item) => `'${item}'`).join(', ')}}`
}

function getMissingRequiredConfigErrors(
  fable: FableBuilderV1,
  catalogue: BlockFactoryCatalogue,
): Record<BlockInstanceId, Array<string>> {
  const missingByBlock: Record<BlockInstanceId, Array<string>> = {}

  for (const [blockId, block] of Object.entries(fable.blocks)) {
    const factory = getFactory(catalogue, block.factory_id)
    if (!factory) continue

    const missingKeys = Object.entries(factory.configuration_options)
      .filter(([configKey, option]) => {
        if (isOptionalValueType(option.value_type)) return false
        if (
          !Object.prototype.hasOwnProperty.call(
            block.configuration_values,
            configKey,
          )
        ) {
          return true
        }
        return block.configuration_values[configKey].trim() === ''
      })
      .map(([configKey]) => configKey)
      .sort()

    if (missingKeys.length > 0) {
      missingByBlock[blockId] = [
        `Block contains missing config: ${toPythonStringSet(missingKeys)}`,
      ]
    }
  }

  return missingByBlock
}
