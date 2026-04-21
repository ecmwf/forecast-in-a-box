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
 * Shows available intrinsic, global, and local glyphs in the config panel.
 * Click a glyph to copy ${key} to clipboard. Link to admin page for management.
 * Local glyphs can be added, edited, and removed inline.
 */

import { useState } from 'react'
import {
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  HelpCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import type { GlyphInfo } from '@/features/fable-builder/hooks/useAllGlyphs'
import { useAllGlyphs } from '@/features/fable-builder/hooks/useAllGlyphs'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { showToast } from '@/lib/toast'
import { P } from '@/components/base/typography'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const EMPTY_GLYPHS: Record<string, string> = {}

export function GlyphReferencePanel() {
  const { t } = useTranslation('glyphs')
  const localGlyphs =
    useFableBuilderStore((state) => state.fable.local_glyphs) ?? EMPTY_GLYPHS
  const { glyphs, isLoading } = useAllGlyphs(localGlyphs)
  const [intrinsicOpen, setIntrinsicOpen] = useState(false)
  const [globalOpen, setGlobalOpen] = useState(true)
  const [localOpen, setLocalOpen] = useState(true)

  if (isLoading) return null

  const intrinsicGlyphs = glyphs.filter((g) => g.type === 'intrinsic')
  const globalGlyphs = glyphs.filter((g) => g.type === 'global')
  const localGlyphList = glyphs.filter((g) => g.type === 'local')

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

      {/* Local section */}
      <LocalGlyphSection
        title={t('panel.local')}
        tooltip={t('panel.localTooltip')}
        open={localOpen}
        onToggle={() => setLocalOpen(!localOpen)}
        glyphs={localGlyphList}
        onCopy={handleCopy}
        exampleLabel={t('panel.example')}
      />

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

function LocalGlyphSection({
  title,
  tooltip,
  open,
  onToggle,
  glyphs,
  onCopy,
  exampleLabel,
}: {
  title: string
  tooltip: string
  open: boolean
  onToggle: () => void
  glyphs: Array<GlyphInfo>
  onCopy: (name: string) => void
  exampleLabel: string
}) {
  const { t } = useTranslation('glyphs')
  const setLocalGlyph = useFableBuilderStore((state) => state.setLocalGlyph)
  const removeLocalGlyph = useFableBuilderStore(
    (state) => state.removeLocalGlyph,
  )
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  function handleStartEdit(glyph: GlyphInfo) {
    setEditingKey(glyph.name)
    setEditValue(glyph.valueExample)
  }

  function handleSaveEdit() {
    if (editingKey && editValue.trim()) {
      setLocalGlyph(editingKey, editValue.trim())
      setEditingKey(null)
      setEditValue('')
    }
  }

  function handleCancelEdit() {
    setEditingKey(null)
    setEditValue('')
  }

  function handleAdd() {
    const key = newKey.trim()
    const value = newValue.trim()
    if (key && value) {
      setLocalGlyph(key, value)
      setNewKey('')
      setNewValue('')
      setIsAdding(false)
    }
  }

  function handleCancelAdd() {
    setNewKey('')
    setNewValue('')
    setIsAdding(false)
  }

  return (
    <div className="border-t border-border/50">
      <div className="flex w-full items-center gap-1.5 px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {title}
        </button>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="text-muted-foreground/60 hover:text-muted-foreground"
              />
            }
          >
            <HelpCircle className="h-3 w-3" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64">
            {tooltip}
          </TooltipContent>
        </Tooltip>
      </div>
      {open && (
        <div className="space-y-0.5 pb-2">
          {glyphs.length > 0
            ? glyphs.map((g) =>
                editingKey === g.name ? (
                  <div
                    key={g.name}
                    className="flex items-center gap-1.5 px-3 py-1"
                  >
                    <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                      {'${' + g.name + '}'}
                    </code>
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit()
                        if (e.key === 'Escape') handleCancelEdit()
                      }}
                      className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <LocalGlyphRow
                    key={g.name}
                    glyph={g}
                    onCopy={onCopy}
                    onEdit={() => handleStartEdit(g)}
                    onDelete={() => removeLocalGlyph(g.name)}
                    exampleLabel={exampleLabel}
                  />
                ),
              )
            : !isAdding && (
                <div className="px-3 pb-1 text-sm text-muted-foreground">
                  {t('panel.noLocal')} {t('panel.addLocalHint')}
                </div>
              )}

          {isAdding ? (
            <div className="flex items-center gap-1.5 px-3 py-1">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={t('panel.localKeyPlaceholder')}
                className="w-20 shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd()
                  if (e.key === 'Escape') handleCancelAdd()
                }}
              />
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={t('panel.localValuePlaceholder')}
                className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd()
                  if (e.key === 'Escape') handleCancelAdd()
                }}
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newKey.trim() || !newValue.trim()}
                className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={handleCancelAdd}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              className="flex w-full items-center gap-1.5 px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('panel.addLocal')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function LocalGlyphRow({
  glyph,
  onCopy,
  onEdit,
  onDelete,
  exampleLabel,
}: {
  glyph: GlyphInfo
  onCopy: (name: string) => void
  onEdit: () => void
  onDelete: () => void
  exampleLabel: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn(
              'group flex w-full items-center gap-2 rounded px-3 py-1 text-left text-sm',
              'transition-colors hover:bg-muted/80',
            )}
          />
        }
      >
        <button
          type="button"
          onClick={() => onCopy(glyph.name)}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
            {'${' + glyph.name + '}'}
          </code>
          <P className="min-w-0 truncate text-sm text-muted-foreground">
            {glyph.valueExample}
          </P>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground">
          <button
            type="button"
            onClick={onEdit}
            className="hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onCopy(glyph.name)}
            className="hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">
        <div className="space-y-1">
          <div className="font-medium">{'${' + glyph.name + '}'}</div>
          <div className="font-mono text-muted-foreground">
            {exampleLabel} {glyph.valueExample}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
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
