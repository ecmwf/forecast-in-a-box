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
 * GlyphFieldWrapper — Dual-mode container for any field type.
 *
 * Uses InputGroup to integrate the glyph toggle button directly into the field.
 * In "concrete" mode the specialized widget (date picker, dropdown, etc.) is
 * shown; in "glyph" mode a GlyphTextInput replaces it. The toggle button sits
 * at the inline-start of the InputGroup.
 *
 * The "resolves to" preview is rendered below the InputGroup, outside of it,
 * so it doesn't affect the field height.
 *
 * Auto-detects glyph values on mount. The toggle only appears when glyphs are
 * available in context.
 */

import { useEffect, useState } from 'react'
import { AlertCircle, Braces } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlyphTextInput } from './GlyphTextInput'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from '@/components/ui/input-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useGlyphContext } from '@/features/fable-builder/context/GlyphContext'
import { useResolvedConfig } from '@/features/fable-builder/context/ResolvedConfigContext'
import { useFieldErrors } from '@/features/fable-builder/context/FieldErrorsContext'
import { containsGlyphs } from '@/features/fable-builder/utils/glyph-display'
import {
  applyFloorDay,
  canApplyFloorDay,
  previewHasTimeComponent,
} from '@/features/fable-builder/utils/date-preview-nudge'
import { cn } from '@/lib/utils'

export interface GlyphFieldWrapperProps {
  id: string
  /** Configuration key under which the backend publishes the resolved value */
  configKey: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /**
   * When false, glyph mode is unavailable and the wrapper renders children
   * directly with no toggle or InputGroup chrome. Used for field types
   * where free-form glyph expressions don't make sense (e.g. enum dropdowns,
   * whose values are constrained to a backend-declared set).
   */
  allowGlyphMode?: boolean
  /**
   * When true, the backend expects a calendar-date-only value
   * (`YYYY-MM-DD`). If a glyph expression resolves to a datetime with a
   * time component, the wrapper surfaces a nudge below the preview and
   * offers a one-click `| floor_day` fix where applicable.
   */
  isDateOnly?: boolean
  /** The specialized widget (must use InputGroupInput or data-slot="input-group-control") */
  children: React.ReactNode
}

type FieldMode = 'concrete' | 'glyph'

export function GlyphFieldWrapper({
  id,
  configKey,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  allowGlyphMode = true,
  isDateOnly = false,
  children,
}: GlyphFieldWrapperProps) {
  const { t } = useTranslation('glyphs')
  const glyphs = useGlyphContext()
  const hasGlyphs = glyphs.length > 0

  const [mode, setMode] = useState<FieldMode>(() =>
    containsGlyphs(value) ? 'glyph' : 'concrete',
  )
  const [autoTrigger, setAutoTrigger] = useState(false)

  // Auto-switch to glyph mode if value changes externally to contain glyphs
  useEffect(() => {
    if (containsGlyphs(value) && mode === 'concrete') {
      setMode('glyph')
    }
  }, [value, mode])

  // All hooks must be called before any conditional early return to satisfy
  // Rules of Hooks — hasGlyphs / allowGlyphMode can toggle at runtime
  // (glyphs load async), so the hook count must stay constant across renders.
  const resolvedConfig = useResolvedConfig()
  const fieldErrors = useFieldErrors()?.[configKey] ?? null
  const hasFieldError = fieldErrors !== null && fieldErrors.length > 0
  const errorMessage = hasFieldError
    ? fieldErrors.length > 1
      ? `${fieldErrors[0]} (+${fieldErrors.length - 1} more)`
      : fieldErrors[0]
    : null

  // No glyphs / glyph mode disabled → render children directly, only adding
  // an error ring + absolute-positioned error text when the field is invalid.
  if (!hasGlyphs || !allowGlyphMode) {
    if (!hasFieldError) return <>{children}</>
    return (
      <div className="relative">
        <div className="rounded-md ring-1 ring-destructive">{children}</div>
        <p className="pointer-events-none absolute top-full left-0 mt-0.5 truncate text-xs text-destructive">
          {errorMessage}
        </p>
      </div>
    )
  }

  const valueHasGlyphs = containsGlyphs(value)
  const canSwitchToConcrete = mode === 'glyph' && !valueHasGlyphs

  function handleToggle() {
    if (mode === 'concrete') {
      setAutoTrigger(!value)
      setMode('glyph')
    } else if (canSwitchToConcrete) {
      setAutoTrigger(false)
      setMode('concrete')
    }
  }

  const toggleTooltip =
    mode === 'concrete'
      ? t('field.switchToGlyph')
      : valueHasGlyphs
        ? t('field.cannotSwitchBack')
        : t('field.switchToConcrete')

  // Resolved preview — backend is the sole source of truth. If the backend
  // hasn't returned a resolved value for this config key (validation in-flight,
  // block in error state, etc.) we simply don't render a preview. Also
  // suppressed when a field-level error is active — the error takes priority
  // for the below-field slot.
  const resolvedPreview =
    mode === 'glyph' && valueHasGlyphs && !hasFieldError
      ? (resolvedConfig?.[configKey] ?? null)
      : null

  const showPreview = resolvedPreview !== null && resolvedPreview !== value

  // Nudge when a date-typed field gets a datetime-resolving expression.
  const dateNudgeVisible =
    isDateOnly &&
    resolvedPreview !== null &&
    previewHasTimeComponent(resolvedPreview)
  const dateNudgeFixAvailable = dateNudgeVisible && canApplyFloorDay(value)

  function handleApplyFloorDay() {
    const next = applyFloorDay(value)
    if (next !== value) onChange(next)
  }

  return (
    <div className="relative">
      <InputGroup
        data-disabled={disabled || undefined}
        className={cn(
          mode === 'glyph' && 'border-primary/30',
          hasFieldError && 'border-destructive',
        )}
      >
        {mode === 'glyph' ? (
          <GlyphTextInput
            id={id}
            value={value}
            onChange={onChange}
            placeholder={placeholder ?? t('field.glyphPlaceholder')}
            disabled={disabled}
            className={className}
            grouped
            autoTrigger={autoTrigger}
            onBlurEmpty={() => {
              setAutoTrigger(false)
              setMode('concrete')
            }}
          />
        ) : (
          children
        )}
        <InputGroupAddon align="inline-start">
          <Tooltip>
            <TooltipTrigger
              render={
                <InputGroupButton
                  data-testid="glyph-toggle"
                  size="icon-xs"
                  variant={mode === 'glyph' ? 'default' : 'ghost'}
                  onClick={handleToggle}
                  disabled={disabled || (mode === 'glyph' && valueHasGlyphs)}
                  aria-label={toggleTooltip}
                  className={cn(
                    mode === 'glyph'
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'text-muted-foreground/60 hover:text-muted-foreground',
                  )}
                />
              }
            >
              <Braces className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent side="right">{toggleTooltip}</TooltipContent>
          </Tooltip>
          <div className="h-5 w-px bg-border" />
        </InputGroupAddon>
      </InputGroup>

      {errorMessage && (
        <p className="pointer-events-none absolute top-full left-0 mt-0.5 truncate text-xs text-destructive">
          {errorMessage}
        </p>
      )}

      {/* In-flow so visual order reads Input → Preview → Nudge. Validation
          is debounced 300 ms, so these appear/disappear at pause boundaries,
          not per keystroke — an honest layout reaction, not flicker. */}
      {showPreview && (
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="mt-1 truncate text-sm text-muted-foreground italic" />
            }
          >
            {t('panel.resolvesTo')}{' '}
            <span className="font-mono">{resolvedPreview}</span>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-w-96 font-mono break-all"
          >
            {resolvedPreview}
          </TooltipContent>
        </Tooltip>
      )}

      {dateNudgeVisible && (
        <div className="mt-1 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t('field.datePreview.hasTime')}
          </span>
          {dateNudgeFixAvailable && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 border-amber-500/60 px-2 text-xs text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                    onClick={handleApplyFloorDay}
                  />
                }
              >
                {t('field.datePreview.floorDayAction')}
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-64">
                {t('field.datePreview.floorDayTooltip')}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  )
}
