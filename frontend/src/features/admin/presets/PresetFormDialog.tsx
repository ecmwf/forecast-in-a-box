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
 * PresetFormDialog
 *
 * Full-screen sheet dialog for creating or editing a high-level preset.
 *
 * Sections:
 *   1. Basic Info   — name, description, long_description
 *   2. Metadata     — difficulty (radio), icon (picker), tags
 *   3. Parameters   — dynamic list of PresetParameter entries (add / remove / reorder)
 *   4. Template     — JSON textarea for builder_template
 *   5. Preview      — renders PresetWizardDialog in preview mode
 *
 * On save: calls useCreatePreset or useUpdatePreset depending on whether an
 * existing preset was passed in.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  GripVertical,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import * as LucideIcons from 'lucide-react'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import type {
  HighLevelPreset,
  PresetDifficulty,
  PresetParameter,
} from '@/api/types/preset.types'
import { useCreatePreset, useUpdatePreset } from '@/api/hooks/usePresets'
import { PresetWizardDialog } from '@/features/fable-builder/components/PresetWizardDialog'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { TagInput } from '@/components/common/TagInput'
import { H3, P } from '@/components/base/typography'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Difficulties in display order. */
const DIFFICULTIES: Array<PresetDifficulty> = [
  'beginner',
  'intermediate',
  'advanced',
]

/** Empty builder template used when creating a new preset. */
const EMPTY_BUILDER_TEMPLATE: FableBuilderV1 = {
  blocks: {},
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** PresetParameter extended with a stable unique id for React keys. */
type PresetParameterWithId = PresetParameter & { id: string }

/** Empty parameter entry for the "add parameter" action. */
function emptyParameter(): PresetParameterWithId {
  return {
    id: crypto.randomUUID(),
    glyph_key: '',
    label: '',
    description: '',
    value_type: 'string',
    default_value: '',
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse a JSON string into a FableBuilderV1.
 * Returns null if the string is not valid JSON.
 */
function parseBuilderTemplate(raw: string): FableBuilderV1 | null {
  try {
    return JSON.parse(raw) as FableBuilderV1
  } catch {
    return null
  }
}

/**
 * Build a synthetic HighLevelPreset from the current form state so we can
 * pass it to PresetWizardDialog for preview.
 */
function buildPreviewPreset(
  name: string,
  description: string,
  longDescription: string,
  difficulty: PresetDifficulty,
  tags: Array<string>,
  icon: string,
  parameters: Array<PresetParameterWithId>,
  builderTemplate: FableBuilderV1,
): HighLevelPreset {
  return {
    preset_id: '__preview__',
    version: 0,
    name: name || 'Untitled Preset',
    description: description || '',
    long_description: longDescription || null,
    difficulty,
    tags,
    icon,
    source: 'user',
    plugin_id: null,
    builder_template: builderTemplate,
    parameters: parameters.map(({ id, ...param }) => param),
    is_published: false,
    created_by: null,
    created_at: null,
    updated_at: null,
  }
}

// ---------------------------------------------------------------------------
// Icon picker
// ---------------------------------------------------------------------------

/** Subset of Lucide icon names that are useful for presets. */
const ICON_SUGGESTIONS = [
  'Cloud',
  'CloudRain',
  'CloudSnow',
  'CloudLightning',
  'Sun',
  'Wind',
  'Thermometer',
  'Droplets',
  'Globe',
  'Map',
  'BarChart2',
  'LineChart',
  'Activity',
  'Zap',
  'Layers',
  'Database',
  'Settings',
  'Sliders',
  'FlaskConical',
  'Microscope',
  'Satellite',
  'Radar',
  'Waves',
  'Mountain',
  'Snowflake',
  'Flame',
  'Leaf',
  'TreePine',
  'Compass',
  'Navigation',
]

interface IconPickerProps {
  value: string
  onChange: (name: string) => void
}

function IconPicker({ value, onChange }: IconPickerProps) {
  const { t } = useTranslation('presets')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return ICON_SUGGESTIONS.filter((name) => name.toLowerCase().includes(q))
  }, [search])

  // Resolve the current icon component for preview
  const CurrentIcon = value
    ? ((
        LucideIcons as unknown as Record<
          string,
          React.ComponentType<{ className?: string }> | undefined
        >
      )[value] ?? null)
    : null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* Preview of selected icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-muted">
          {CurrentIcon ? (
            <CurrentIcon className="h-4 w-4" aria-hidden="true" />
          ) : (
            <span className="text-xs text-muted-foreground">?</span>
          )}
        </div>

        {/* Text input for icon name */}
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('form.icon.placeholder')}
          className="flex-1"
        />

        {/* Toggle picker */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={t('form.icon.browse')}
        >
          {open ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
          {t('form.icon.browse')}
        </Button>
      </div>

      {/* Icon grid */}
      {open && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('form.icon.search')}
              className="h-8 pl-8 text-sm"
            />
          </div>

          {/* Grid */}
          <div className="grid grid-cols-8 gap-1 sm:grid-cols-10">
            {filtered.map((name) => {
              const Icon = (
                LucideIcons as unknown as Record<
                  string,
                  React.ComponentType<{ className?: string }> | undefined
                >
              )[name]
              if (!Icon) return null
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => {
                    onChange(name)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-accent hover:text-accent-foreground',
                    value === name
                      ? 'border-ring bg-accent text-accent-foreground'
                      : 'border-transparent',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </button>
              )
            })}
          </div>

          {filtered.length === 0 && (
            <P className="py-2 text-center text-muted-foreground">
              {t('form.icon.noResults')}
            </P>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Parameter row editor
// ---------------------------------------------------------------------------

interface ParameterRowProps {
  index: number
  param: PresetParameterWithId
  total: number
  onChange: (index: number, updated: PresetParameterWithId) => void
  onRemove: (index: number) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
}

function ParameterRow({
  index,
  param,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: ParameterRowProps) {
  const { t } = useTranslation('presets')

  function update(field: keyof PresetParameter, value: string) {
    onChange(index, { ...param, [field]: value })
  }

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      {/* Row header: index + reorder + remove */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-muted-foreground">
            {t('form.parameters.paramLabel', { index: index + 1 })}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => onMoveUp(index)}
            aria-label={t('form.parameters.moveUp')}
            title={t('form.parameters.moveUp')}
          >
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === total - 1}
            onClick={() => onMoveDown(index)}
            aria-label={t('form.parameters.moveDown')}
            title={t('form.parameters.moveDown')}
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onRemove(index)}
            aria-label={t('form.parameters.remove')}
            title={t('form.parameters.remove')}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Fields grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* glyph_key */}
        <div className="space-y-1">
          <Label htmlFor={`param-${index}-glyph-key`} className="text-xs">
            {t('form.parameters.fields.glyphKey')}
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id={`param-${index}-glyph-key`}
            value={param.glyph_key}
            onChange={(e) => update('glyph_key', e.target.value)}
            placeholder={t('form.parameters.fields.glyphKeyPlaceholder')}
            className="h-8 font-mono text-sm"
          />
        </div>

        {/* label */}
        <div className="space-y-1">
          <Label htmlFor={`param-${index}-label`} className="text-xs">
            {t('form.parameters.fields.label')}
            <span className="ml-1 text-destructive" aria-hidden="true">
              *
            </span>
          </Label>
          <Input
            id={`param-${index}-label`}
            value={param.label}
            onChange={(e) => update('label', e.target.value)}
            placeholder={t('form.parameters.fields.labelPlaceholder')}
            className="h-8 text-sm"
          />
        </div>

        {/* value_type */}
        <div className="space-y-1">
          <Label htmlFor={`param-${index}-value-type`} className="text-xs">
            {t('form.parameters.fields.valueType')}
          </Label>
          <Input
            id={`param-${index}-value-type`}
            value={param.value_type}
            onChange={(e) => update('value_type', e.target.value)}
            placeholder={t('form.parameters.fields.valueTypePlaceholder')}
            className="h-8 font-mono text-sm"
          />
        </div>

        {/* default_value */}
        <div className="space-y-1">
          <Label htmlFor={`param-${index}-default`} className="text-xs">
            {t('form.parameters.fields.defaultValue')}
          </Label>
          <Input
            id={`param-${index}-default`}
            value={param.default_value}
            onChange={(e) => update('default_value', e.target.value)}
            placeholder={t('form.parameters.fields.defaultValuePlaceholder')}
            className="h-8 text-sm"
          />
        </div>

        {/* description — full width */}
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`param-${index}-description`} className="text-xs">
            {t('form.parameters.fields.description')}
          </Label>
          <Input
            id={`param-${index}-description`}
            value={param.description}
            onChange={(e) => update('description', e.target.value)}
            placeholder={t('form.parameters.fields.descriptionPlaceholder')}
            className="h-8 text-sm"
          />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Collapsible section wrapper
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string
  description?: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: React.ReactNode
}

function FormSection({
  title,
  description,
  children,
  defaultOpen = true,
  badge,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <H3 className="text-sm font-semibold">{title}</H3>
          {badge}
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <>
          <Separator />
          <div className="p-4">
            {description && (
              <P className="mb-4 text-muted-foreground">{description}</P>
            )}
            {children}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form field wrapper
// ---------------------------------------------------------------------------

interface FieldProps {
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
}

function Field({ id, label, hint, error, required, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && (
          <span className="ml-1 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </Label>
      {children}
      {error ? (
        <P className="text-xs text-destructive">{error}</P>
      ) : hint ? (
        <P className="text-xs text-muted-foreground">{hint}</P>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface FormErrors {
  name?: string
  description?: string
  icon?: string
  builderTemplate?: string
  parameters?: Record<number, Partial<Record<keyof PresetParameter, string>>>
}

function buildFormErrors(
  name: string,
  description: string,
  icon: string,
  builderTemplateRaw: string,
  parameters: Array<PresetParameterWithId>,
  messages: {
    nameRequired: string
    descriptionRequired: string
    iconRequired: string
    templateRequired: string
    templateInvalidJson: string
    paramGlyphKeyRequired: string
    paramLabelRequired: string
  },
): FormErrors {
  const errors: FormErrors = {}

  if (!name.trim()) errors.name = messages.nameRequired
  if (!description.trim()) errors.description = messages.descriptionRequired
  if (!icon.trim()) errors.icon = messages.iconRequired

  if (!builderTemplateRaw.trim()) {
    errors.builderTemplate = messages.templateRequired
  } else if (!parseBuilderTemplate(builderTemplateRaw)) {
    errors.builderTemplate = messages.templateInvalidJson
  }

  const paramErrors: FormErrors['parameters'] = {}
  parameters.forEach((p, i) => {
    const rowErrors: Partial<Record<keyof PresetParameter, string>> = {}
    if (!p.glyph_key.trim())
      rowErrors.glyph_key = messages.paramGlyphKeyRequired
    if (!p.label.trim()) rowErrors.label = messages.paramLabelRequired
    if (Object.keys(rowErrors).length > 0) paramErrors[i] = rowErrors
  })
  if (Object.keys(paramErrors).length > 0) errors.parameters = paramErrors

  return errors
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PresetFormDialogProps {
  /** When provided, the form is in edit mode and pre-populated with this preset. */
  preset?: HighLevelPreset | null
  /** Controls visibility. */
  open: boolean
  /** Called when the dialog should close. */
  onOpenChange: (open: boolean) => void
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PresetFormDialog({
  preset,
  open,
  onOpenChange,
}: PresetFormDialogProps) {
  const { t } = useTranslation('presets')
  const isEditing = !!preset

  // ── API hooks ─────────────────────────────────────────────────────────────
  const createPreset = useCreatePreset()
  const updatePreset = useUpdatePreset()

  const isSaving = createPreset.isPending || updatePreset.isPending

  // ── Form state ────────────────────────────────────────────────────────────
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [longDescription, setLongDescription] = useState('')
  const [difficulty, setDifficulty] = useState<PresetDifficulty>('beginner')
  const [icon, setIcon] = useState('Cloud')
  const [tags, setTags] = useState<Array<string>>([])
  const [parameters, setParameters] = useState<Array<PresetParameterWithId>>([])
  const [builderTemplateRaw, setBuilderTemplateRaw] = useState(
    JSON.stringify(EMPTY_BUILDER_TEMPLATE, null, 2),
  )
  const [isPublished, setIsPublished] = useState(false)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  // ── Sync form when dialog opens / preset changes ──────────────────────────
  useEffect(() => {
    if (!open) return
    if (preset) {
      setName(preset.name)
      setDescription(preset.description)
      setLongDescription(preset.long_description ?? '')
      setDifficulty(preset.difficulty)
      setIcon(preset.icon)
      setTags([...preset.tags])
      setParameters(
        preset.parameters.map((p) => ({ ...p, id: crypto.randomUUID() })),
      )
      setBuilderTemplateRaw(JSON.stringify(preset.builder_template, null, 2))
      setIsPublished(preset.is_published)
    } else {
      setName('')
      setDescription('')
      setLongDescription('')
      setDifficulty('beginner')
      setIcon('Cloud')
      setTags([])
      setParameters([])
      setBuilderTemplateRaw(JSON.stringify(EMPTY_BUILDER_TEMPLATE, null, 2))
      setIsPublished(false)
    }
    setErrors({})
    setSubmitError(null)
  }, [open, preset])

  // ── Parameter helpers ─────────────────────────────────────────────────────
  const handleAddParameter = useCallback(() => {
    setParameters((prev) => [...prev, emptyParameter()])
  }, [])

  const handleChangeParameter = useCallback(
    (index: number, updated: PresetParameterWithId) => {
      setParameters((prev) => prev.map((p, i) => (i === index ? updated : p)))
    },
    [],
  )

  const handleRemoveParameter = useCallback((index: number) => {
    setParameters((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleMoveUp = useCallback((index: number) => {
    if (index === 0) return
    setParameters((prev) => {
      const next = [...prev]
      // Swap index-1 and index — bounds already checked above.
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]] as [
        PresetParameterWithId,
        PresetParameterWithId,
      ]
      return next
    })
  }, [])

  const handleMoveDown = useCallback((index: number) => {
    setParameters((prev) => {
      if (index >= prev.length - 1) return prev
      const next = [...prev]
      // Swap index and index+1 — bounds already checked above.
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]] as [
        PresetParameterWithId,
        PresetParameterWithId,
      ]
      return next
    })
  }, [])

  // ── Preview preset ────────────────────────────────────────────────────────
  const previewPreset = useMemo(() => {
    const template =
      parseBuilderTemplate(builderTemplateRaw) ?? EMPTY_BUILDER_TEMPLATE
    return buildPreviewPreset(
      name,
      description,
      longDescription,
      difficulty,
      tags,
      icon,
      parameters,
      template,
    )
  }, [
    name,
    description,
    longDescription,
    difficulty,
    tags,
    icon,
    parameters,
    builderTemplateRaw,
  ])

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    const validationErrors = buildFormErrors(
      name,
      description,
      icon,
      builderTemplateRaw,
      parameters,
      {
        nameRequired: t('form.validation.nameRequired'),
        descriptionRequired: t('form.validation.descriptionRequired'),
        iconRequired: t('form.validation.iconRequired'),
        templateRequired: t('form.validation.templateRequired'),
        templateInvalidJson: t('form.validation.templateInvalidJson'),
        paramGlyphKeyRequired: t('form.validation.paramGlyphKeyRequired'),
        paramLabelRequired: t('form.validation.paramLabelRequired'),
      },
    )
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors({})

    const template = parseBuilderTemplate(builderTemplateRaw)!
    // Strip the client-side `id` field before sending to backend
    const parametersForBackend = parameters.map(({ id, ...param }) => param)

    try {
      if (isEditing) {
        await updatePreset.mutateAsync({
          preset_id: preset.preset_id,
          version: preset.version,
          name: name.trim(),
          description: description.trim(),
          long_description: longDescription.trim() || null,
          difficulty,
          tags,
          icon: icon.trim(),
          builder_template: template,
          parameters: parametersForBackend,
          is_published: isPublished,
        })
        showToast.success(t('form.toast.updateSuccess'))
      } else {
        await createPreset.mutateAsync({
          name: name.trim(),
          description: description.trim(),
          long_description: longDescription.trim() || null,
          difficulty,
          tags,
          icon: icon.trim(),
          builder_template: template,
          parameters: parametersForBackend,
          is_published: isPublished,
        })
        showToast.success(t('form.toast.createSuccess'))
      }
      onOpenChange(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('form.toast.saveError')
      setSubmitError(message)
    }
  }

  // ── Template JSON formatting ──────────────────────────────────────────────
  function handleFormatTemplate() {
    const parsed = parseBuilderTemplate(builderTemplateRaw)
    if (parsed) {
      setBuilderTemplateRaw(JSON.stringify(parsed, null, 2))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!open) return null

  return (
    <>
      {/* Full-screen overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        aria-hidden="true"
        onClick={() => !isSaving && onOpenChange(false)}
      />

      {/* Dialog panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEditing ? t('form.editTitle') : t('form.createTitle')}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col bg-background shadow-xl"
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">
              {isEditing ? t('form.editTitle') : t('form.createTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isEditing
                ? t('form.editSubtitle', { name })
                : t('form.createSubtitle')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => !isSaving && onOpenChange(false)}
            disabled={isSaving}
            aria-label={t('form.close')}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">
          <form
            id="preset-form"
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-4 p-6"
            noValidate
          >
            {/* Submit error banner */}
            {submitError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            {/* ── Section 1: Basic Info ── */}
            <FormSection
              title={t('form.sections.basicInfo')}
              description={t('form.sections.basicInfoDesc')}
            >
              <div className="space-y-4">
                <Field
                  id="preset-name"
                  label={t('form.fields.name')}
                  hint={t('form.fields.nameHint')}
                  error={errors.name}
                  required
                >
                  <Input
                    id="preset-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('form.fields.namePlaceholder')}
                    aria-invalid={!!errors.name}
                    maxLength={120}
                  />
                </Field>

                <Field
                  id="preset-description"
                  label={t('form.fields.description')}
                  hint={t('form.fields.descriptionHint')}
                  error={errors.description}
                  required
                >
                  <Textarea
                    id="preset-description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t('form.fields.descriptionPlaceholder')}
                    aria-invalid={!!errors.description}
                    rows={2}
                  />
                </Field>

                <Field
                  id="preset-long-description"
                  label={t('form.fields.longDescription')}
                  hint={t('form.fields.longDescriptionHint')}
                >
                  <Textarea
                    id="preset-long-description"
                    value={longDescription}
                    onChange={(e) => setLongDescription(e.target.value)}
                    placeholder={t('form.fields.longDescriptionPlaceholder')}
                    rows={4}
                  />
                </Field>
              </div>
            </FormSection>

            {/* ── Section 2: Metadata ── */}
            <FormSection
              title={t('form.sections.metadata')}
              description={t('form.sections.metadataDesc')}
            >
              <div className="space-y-4">
                {/* Category */}
                {/* Difficulty */}
                <div className="space-y-1.5">
                  <Label>{t('form.fields.difficulty')}</Label>
                  <div
                    role="radiogroup"
                    aria-label={t('form.fields.difficulty')}
                    className="flex flex-wrap gap-2"
                  >
                    {DIFFICULTIES.map((d) => (
                      <label
                        key={d}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                          difficulty === d
                            ? 'border-ring bg-accent text-accent-foreground'
                            : 'border-border hover:bg-muted',
                        )}
                      >
                        <input
                          type="radio"
                          name="difficulty"
                          value={d}
                          checked={difficulty === d}
                          onChange={() => setDifficulty(d)}
                          className="sr-only"
                        />
                        {t(`admin.difficulty.${d}`)}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Icon */}
                <Field
                  id="preset-icon"
                  label={t('form.fields.icon')}
                  hint={t('form.fields.iconHint')}
                  error={errors.icon}
                  required
                >
                  <IconPicker value={icon} onChange={setIcon} />
                </Field>

                {/* Tags */}
                <Field
                  id="preset-tags"
                  label={t('form.fields.tags')}
                  hint={t('form.fields.tagsHint')}
                >
                  <TagInput
                    id="preset-tags"
                    tags={tags}
                    onTagsChange={setTags}
                    placeholder={t('form.fields.tagsPlaceholder')}
                  />
                </Field>

                {/* Published */}
                <div className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="space-y-0.5">
                    <Label htmlFor="preset-published">
                      {t('form.fields.published')}
                    </Label>
                    <P className="text-xs text-muted-foreground">
                      {t('form.fields.publishedHint')}
                    </P>
                  </div>
                  <Switch
                    id="preset-published"
                    checked={isPublished}
                    onCheckedChange={setIsPublished}
                  />
                </div>
              </div>
            </FormSection>

            {/* ── Section 3: Parameters ── */}
            <FormSection
              title={t('form.sections.parameters')}
              description={t('form.sections.parametersDesc')}
              defaultOpen
              badge={
                parameters.length > 0 ? (
                  <Badge variant="secondary" className="ml-1">
                    {parameters.length}
                  </Badge>
                ) : undefined
              }
            >
              <div className="space-y-3">
                {parameters.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border py-8 text-center">
                    <P className="text-muted-foreground">
                      {t('form.parameters.empty')}
                    </P>
                  </div>
                ) : (
                  parameters.map((param, i) => (
                    <ParameterRow
                      key={param.id}
                      index={i}
                      param={param}
                      total={parameters.length}
                      onChange={handleChangeParameter}
                      onRemove={handleRemoveParameter}
                      onMoveUp={handleMoveUp}
                      onMoveDown={handleMoveDown}
                    />
                  ))
                )}

                {/* Validation errors summary for parameters */}
                {errors.parameters && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    <AlertDescription>
                      {t('form.validation.parametersHaveErrors')}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddParameter}
                  className="w-full"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  {t('form.parameters.add')}
                </Button>
              </div>
            </FormSection>

            {/* ── Section 4: Builder Template ── */}
            <FormSection
              title={t('form.sections.template')}
              description={t('form.sections.templateDesc')}
              defaultOpen={false}
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <P className="text-xs text-muted-foreground">
                    {t('form.template.hint')}
                  </P>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleFormatTemplate}
                    disabled={!parseBuilderTemplate(builderTemplateRaw)}
                  >
                    {t('form.template.format')}
                  </Button>
                </div>
                <Textarea
                  id="preset-template"
                  value={builderTemplateRaw}
                  onChange={(e) => setBuilderTemplateRaw(e.target.value)}
                  placeholder={t('form.template.placeholder')}
                  aria-invalid={!!errors.builderTemplate}
                  className="min-h-48 font-mono text-xs"
                  spellCheck={false}
                />
                {errors.builderTemplate && (
                  <P className="text-xs text-destructive">
                    {errors.builderTemplate}
                  </P>
                )}
              </div>
            </FormSection>
          </form>
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-4">
          {/* Preview button — only useful for intermediate/advanced (has params) */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPreviewOpen(true)}
            disabled={
              previewPreset.difficulty === 'beginner' ||
              previewPreset.parameters.length === 0
            }
            title={
              previewPreset.difficulty === 'beginner' ||
              previewPreset.parameters.length === 0
                ? t('form.preview.disabledHint')
                : undefined
            }
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {t('form.preview.button')}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              {t('form.actions.cancel')}
            </Button>
            <Button type="submit" form="preset-form" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2
                    className="mr-1.5 h-4 w-4 animate-spin"
                    aria-hidden="true"
                  />
                  {t('form.actions.saving')}
                </>
              ) : isEditing ? (
                t('form.actions.update')
              ) : (
                t('form.actions.create')
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Preview wizard ── */}
      {previewOpen && (
        <PresetWizardDialog
          preset={previewPreset}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          previewMode
        />
      )}
    </>
  )
}
