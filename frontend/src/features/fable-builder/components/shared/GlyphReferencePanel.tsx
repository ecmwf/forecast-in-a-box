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
 * GlyphReferencePanel Component
 *
 * Shows available intrinsic and global glyphs in the config panel.
 * Click a glyph to copy ${key} to clipboard. Link to admin page for management.
 */

import { useState } from 'react'
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  HelpCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { GlyphInfo } from '@/features/fable-builder/hooks/useAllGlyphs'
import { useAllGlyphs } from '@/features/fable-builder/hooks/useAllGlyphs'
import { showToast } from '@/lib/toast'
import { P } from '@/components/base/typography'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function GlyphReferencePanel() {
  const { t } = useTranslation('glyphs')
  const { glyphs, isLoading } = useAllGlyphs()
  const [intrinsicOpen, setIntrinsicOpen] = useState(false)
  const [globalOpen, setGlobalOpen] = useState(true)

  if (isLoading) return null

  const intrinsicGlyphs = glyphs.filter((g) => g.type === 'intrinsic')
  const globalGlyphs = glyphs.filter((g) => g.type === 'global')

  function handleCopy(name: string) {
    const ref = '${' + name + '}'
    navigator.clipboard.writeText(ref)
    showToast.success(t('panel.copied'), ref)
  }

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between p-3 pb-0">
        <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Braces className="h-3.5 w-3.5" />
          {t('panel.title')}
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="text-muted-foreground/60 hover:text-muted-foreground"
                />
              }
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-80 whitespace-pre-line"
            >
              {t('panel.help')}
            </TooltipContent>
          </Tooltip>
        </div>
        <Link
          to="/admin/glyphs"
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t('panel.manage')}
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* Global section */}
      <GlyphSection
        title={t('panel.global')}
        open={globalOpen}
        onToggle={() => setGlobalOpen(!globalOpen)}
      >
        {globalGlyphs.length > 0 ? (
          globalGlyphs.map((g) => (
            <GlyphRow
              key={g.name}
              glyph={g}
              onCopy={handleCopy}
              exampleLabel={t('panel.example')}
            />
          ))
        ) : (
          <div className="px-3 pb-2 text-sm text-muted-foreground">
            {t('panel.noGlobal')}{' '}
            <Link to="/admin/glyphs" className="text-primary hover:underline">
              {t('panel.createOne')}
            </Link>
          </div>
        )}
      </GlyphSection>

      {/* Intrinsic section */}
      <GlyphSection
        title={t('panel.intrinsic')}
        open={intrinsicOpen}
        onToggle={() => setIntrinsicOpen(!intrinsicOpen)}
      >
        {intrinsicGlyphs.map((g) => (
          <GlyphRow
            key={g.name}
            glyph={g}
            onCopy={handleCopy}
            exampleLabel={t('panel.example')}
          />
        ))}
      </GlyphSection>
    </div>
  )
}

function GlyphSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-border/50">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        {title}
      </button>
      {open && <div className="space-y-0.5 pb-2">{children}</div>}
    </div>
  )
}

function GlyphRow({
  glyph,
  onCopy,
  exampleLabel,
}: {
  glyph: GlyphInfo
  onCopy: (name: string) => void
  exampleLabel: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => onCopy(glyph.name)}
            className={cn(
              'group flex w-full items-center gap-2 rounded px-3 py-1 text-left text-sm',
              'transition-colors hover:bg-muted/80',
            )}
          />
        }
      >
        <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
          {'${' + glyph.name + '}'}
        </code>
        <P className="min-w-0 truncate text-sm text-muted-foreground">
          {glyph.type === 'intrinsic' ? glyph.displayName : glyph.valueExample}
        </P>
        <Copy className="ml-auto h-3 w-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
      </TooltipTrigger>
      <TooltipContent side="left">
        <div className="space-y-1">
          <div className="font-medium">{glyph.displayName}</div>
          <div className="font-mono text-muted-foreground">
            {exampleLabel} {glyph.valueExample}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
