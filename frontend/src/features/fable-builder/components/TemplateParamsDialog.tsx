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
 * TemplateParamsDialog Component
 *
 * Collects a template's parameters when forking: required glyphs (seeded
 * from plugin examples) plus the template's own defaults, collapsed.
 * Values validate live against /blueprint/expand on a candidate builder.
 * Parameters with example metadata render as labeled typed fields;
 * the rest stay plain text.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  TriangleAlert,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import type {
  ParameterUsage,
  TemplateParameters,
} from '@/features/fable-builder/utils/template-parameters'
import type {
  BlockFactoryCatalogue,
  FableBuilderV1,
} from '@/api/types/fable.types'
import type { TemplateExampleValues } from '@/api/types/plugins.types'
import { getFactory } from '@/api/types/fable.types'
import {
  fableKeys,
  useCreateGlobalGlyph,
  useFableValidation,
} from '@/api/hooks/useFable'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { hasUnterminatedGlyph } from '@/features/fable-builder/utils/glyph-display'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FieldRenderer } from '@/components/base/fields/FieldRenderer'
import { ResolvedPreview } from '@/components/base/fields/fields/GlyphFieldWrapper'
import { useDebounce } from '@/hooks/useDebounce'
import { cn } from '@/lib/utils'

interface TemplateParamsDialogProps {
  open: boolean
  params: TemplateParameters
  /** The forked template builder the values are validated against */
  baseFable: FableBuilderV1
  /** The plugin's example data: glyph suggestions + block config overlays */
  examples: TemplateExampleValues | undefined
  /** Apply the collected glyph values and continue into the builder */
  onApply: (values: Record<string, string>) => void
  /** Continue with the plugin's examples applied silently */
  onSkip: () => void
  /** Dialog copy overrides (defaults: template-fork wording) */
  title?: string
  description?: string
  /** Resolves block/option display titles for the usage-context lines */
  catalogue?: BlockFactoryCatalogue
  /** Per-parameter local/global scope; global values are created on Apply. */
  scopeSelectable?: boolean
}

export function TemplateParamsDialog({
  open,
  params,
  baseFable,
  examples,
  onApply,
  onSkip,
  title,
  description,
  catalogue,
  scopeSelectable = false,
}: TemplateParamsDialogProps) {
  const { t } = useTranslation(['configure', 'glyphs'])
  const [values, setValues] = useState<Record<string, string>>({})
  const [scopes, setScopes] = useState<Record<string, 'local' | 'global'>>({})
  const [showPrefilled, setShowPrefilled] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const createGlobal = useCreateGlobalGlyph()
  const queryClient = useQueryClient()

  // Re-seed the form whenever the dialog opens for a template
  useEffect(() => {
    if (!open) return
    const seeded: Record<string, string> = {}
    for (const name of params.required) {
      seeded[name] = examples?.example_glyphs[name]?.example_value ?? ''
    }
    for (const [name, value] of Object.entries(params.prefilled)) {
      seeded[name] = value
    }
    setValues(seeded)
    setScopes({})
    setApplyError(null)
    setShowPrefilled(false)
  }, [open, params, examples])

  // Candidate builder: fork + example block values + the dialog's glyphs —
  // the same overlay Apply performs, validated before the user commits.
  const debouncedValues = useDebounce(values, 300)
  const candidateFable = useMemo<FableBuilderV1>(() => {
    const blocks = Object.fromEntries(
      Object.entries(baseFable.blocks).map(([blockId, block]) => [
        blockId,
        examples?.example_values[blockId]
          ? {
              ...block,
              configuration_values: {
                ...block.configuration_values,
                ...Object.fromEntries(
                  Object.entries(examples.example_values[blockId]).map(
                    ([optId, inp]) => [optId, inp.example_value],
                  ),
                ),
              },
            }
          : block,
      ]),
    )
    const glyphs = Object.fromEntries(
      Object.entries(debouncedValues).filter(([, value]) => value !== ''),
    )
    return {
      ...baseFable,
      blocks,
      local_glyphs: { ...baseFable.local_glyphs, ...glyphs },
    }
  }, [baseFable, examples, debouncedValues])

  const valuesTyping = Object.values(values).some(hasUnterminatedGlyph)
  const { data: expansion, isFetching: isValidating } = useFableValidation(
    candidateFable,
    open && !valuesTyping,
  )

  const errorCount = expansion
    ? expansion.global_errors.length +
      Object.values(expansion.block_errors).reduce(
        (total, errors) => total + errors.length,
        0,
      )
    : 0

  /** Backend-resolved value at the parameter's first usage site */
  function resolvedPreview(name: string): string | null {
    // `in` guards, not `?.`: index access is typed non-nullable here
    // (noUncheckedIndexedAccess off), so `?.`/`??` would read as unnecessary.
    if (!expansion || !(name in params.usage)) return null
    const site = params.usage[name][0]
    const resolved = expansion.resolved_configuration_options
    if (!(site.blockId in resolved)) return null
    const options = resolved[site.blockId]
    return site.optionId in options ? options[site.optionId] : null
  }

  /** True when the backend still reports this glyph as missing */
  function isMissing(name: string): boolean {
    if (!expansion) return false
    return Object.values(expansion.missing_glyphs).some((options) =>
      Object.values(options).some((names) => names.includes(name)),
    )
  }

  const setValue = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }))

  /** Create global-scoped values, then hand the rest to onApply as locals. */
  async function handleApply() {
    const globalEntries = Object.entries(values).filter(
      ([name, value]) => scopes[name] === 'global' && value.trim() !== '',
    )
    const localValues = Object.fromEntries(
      Object.entries(values).filter(([name]) => scopes[name] !== 'global'),
    )
    if (globalEntries.length === 0) {
      onApply(values)
      return
    }
    setApplying(true)
    setApplyError(null)
    try {
      await Promise.all(
        globalEntries.map(([name, value]) =>
          createGlobal.mutateAsync({
            key: name,
            value: value.trim(),
            public: false,
            overriddable: null,
          }),
        ),
      )
      // Globals don't change the fable, so revalidate explicitly.
      await queryClient.invalidateQueries({
        queryKey: [...fableKeys.all, 'validation'],
      })
      onApply(localValues)
    } catch (err) {
      setApplyError(
        err instanceof Error
          ? err.message
          : t('glyphs:field.defineVariable.globalCreateFailed'),
      )
    } finally {
      setApplying(false)
    }
  }

  /** "Block → Option" with display titles when the catalogue knows them */
  function usageLabel(site: ParameterUsage): string {
    const block =
      site.blockId in baseFable.blocks
        ? baseFable.blocks[site.blockId]
        : undefined
    if (!block) return site.optionId
    const factory = catalogue
      ? getFactory(catalogue, block.factory_id)
      : undefined
    let optionTitle = site.optionId
    if (factory && site.optionId in factory.configuration_options) {
      const optionMeta = factory.configuration_options[site.optionId]
      if (optionMeta.title) optionTitle = optionMeta.title
    }
    return t('template.dialog.usedIn', {
      block: factory?.title ?? block.factory_id.factory,
      option: optionTitle,
    })
  }

  const renderField = (name: string) => {
    const preview = resolvedPreview(name)
    const missing = isMissing(name)
    const meta = examples?.example_glyphs[name]
    const usageSites = name in params.usage ? params.usage[name] : []
    const scope = scopes[name] === 'global' ? 'global' : 'local'
    return (
      <div key={name} className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label
            htmlFor={`template-param-${name}`}
            className={meta?.display_name ? 'text-sm' : 'font-mono text-xs'}
            // tooltip keeps the raw glyph name reachable
            title={meta?.display_name ? name : undefined}
          >
            {meta?.display_name ?? name}
          </Label>
          {scopeSelectable && params.required.includes(name) && (
            <ToggleGroup
              variant="outline"
              size="sm"
              value={[scope]}
              onValueChange={(next) => {
                const first = next[0]
                if (first === 'local' || first === 'global') {
                  setScopes((current) => ({ ...current, [name]: first }))
                }
              }}
            >
              <ToggleGroupItem
                value="local"
                className="h-6 px-2 text-xs"
                title={t('glyphs:field.defineVariable.scopeLocalHint')}
              >
                {t('glyphs:field.defineVariable.scopeLocal')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="global"
                className="h-6 px-2 text-xs"
                title={t('glyphs:field.defineVariable.scopeGlobalHint')}
              >
                {t('glyphs:field.defineVariable.scopeGlobal')}
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
        {meta?.display_description && (
          <p className="text-xs text-muted-foreground">
            {meta.display_description}
          </p>
        )}
        {usageSites.length > 0 && (
          <p
            className="truncate text-xs text-muted-foreground"
            title={usageSites.map(usageLabel).join('\n')}
          >
            {usageLabel(usageSites[0])}
            {usageSites.length > 1 &&
              ` ${t('template.dialog.usedInMore', { count: usageSites.length - 1 })}`}
          </p>
        )}
        {meta?.type_hint ? (
          <FieldRenderer
            id={`template-param-${name}`}
            configKey={name}
            valueType={meta.type_hint}
            value={values[name] ?? ''}
            onChange={(value) => setValue(name, value)}
            inputClassName={cn(missing && 'border-amber-400')}
          />
        ) : (
          <Input
            id={`template-param-${name}`}
            value={values[name] ?? ''}
            onChange={(e) => setValue(name, e.target.value)}
            aria-invalid={missing || undefined}
            className={cn(missing && 'border-amber-400')}
          />
        )}
        {missing ? (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {t('template.dialog.missingValue')}
          </p>
        ) : (
          preview !== null &&
          preview !== (values[name] ?? '') && (
            <ResolvedPreview preview={preview} />
          )
        )}
      </div>
    )
  }

  const prefilledNames = Object.keys(params.prefilled)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onSkip()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? t('template.dialog.title')}</DialogTitle>
          <DialogDescription>
            {description ?? t('template.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        {/* min-w-0: keeps nowrap preview lines from widening the dialog grid */}
        <div className="flex min-w-0 flex-col gap-4">
          {params.required.length > 0 && (
            <div className="flex flex-col gap-3">
              {params.required.map(renderField)}
            </div>
          )}

          {prefilledNames.length > 0 && (
            <Collapsible open={showPrefilled} onOpenChange={setShowPrefilled}>
              <CollapsibleTrigger className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ChevronRight
                  className={cn(
                    'h-4 w-4 transition-transform',
                    showPrefilled && 'rotate-90',
                  )}
                />
                {t('template.dialog.prefilled', {
                  count: prefilledNames.length,
                })}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 flex flex-col gap-3">
                {prefilledNames.map(renderField)}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Live validation status of the candidate configuration */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isValidating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('template.dialog.validating')}
              </>
            ) : expansion && errorCount === 0 ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                {t('template.dialog.valid')}
              </>
            ) : expansion ? (
              <>
                <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
                {t('template.dialog.issues', { count: errorCount })}
              </>
            ) : null}
          </div>
        </div>

        {applyError && (
          <p className="text-xs text-destructive" role="alert">
            {applyError}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onSkip} disabled={applying}>
            {t('template.dialog.skip')}
          </Button>
          <Button onClick={() => void handleApply()} disabled={applying}>
            {t('template.dialog.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
