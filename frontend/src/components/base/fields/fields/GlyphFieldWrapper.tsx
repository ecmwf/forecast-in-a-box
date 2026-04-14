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
import { Braces } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { GlyphTextInput } from './GlyphTextInput'
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
import {
  containsGlyphs,
  resolveGlyphValue,
} from '@/features/fable-builder/utils/glyph-display'
import { cn } from '@/lib/utils'

export interface GlyphFieldWrapperProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** The specialized widget (must use InputGroupInput or data-slot="input-group-control") */
  children: React.ReactNode
}

type FieldMode = 'concrete' | 'glyph'

export function GlyphFieldWrapper({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  className,
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

  // If no glyphs available, always render concrete mode without the wrapper
  if (!hasGlyphs) {
    return <>{children}</>
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

  // Resolved preview — rendered below the InputGroup
  const resolvedPreview =
    mode === 'glyph' && valueHasGlyphs
      ? resolveGlyphValue(
          value,
          Object.fromEntries(glyphs.map((g) => [g.name, g.valueExample])),
        )
      : null

  return (
    <div>
      <InputGroup
        data-disabled={disabled || undefined}
        className={cn(mode === 'glyph' && 'border-primary/30')}
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

      {resolvedPreview && resolvedPreview !== value && (
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
    </div>
  )
}
