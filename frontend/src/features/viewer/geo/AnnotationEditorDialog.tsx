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
 * Annotation editor: live pin preview, editable badge label (sticky —
 * never auto-renumbered), curated color palette, and the note text.
 * ⌘/Ctrl+Enter saves.
 */

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ANNOTATION_COLORS, ANNOTATION_LABEL_MAX } from './annotations'
import type { AnnotationColor } from './annotations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface AnnotationDraft {
  /** Existing annotation id, or null when creating a new one. */
  id: string | null
  text: string
  label: string
  color: AnnotationColor
}

export interface AnnotationPatch {
  text: string
  label: string
  color: AnnotationColor
}

export function AnnotationEditorDialog({
  draft,
  location = null,
  onSave,
  onDelete,
  onClose,
}: {
  draft: AnnotationDraft | null
  /** Pin position ("52.500°, 13.400°") shown under the title. */
  location?: string | null
  onSave: (patch: AnnotationPatch) => void
  onDelete: () => void
  onClose: () => void
}) {
  const { t } = useTranslation('visualise')
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const [color, setColor] = useState<AnnotationColor>('slate')

  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    if (draft) {
      setText(draft.text)
      setLabel(draft.label)
      setColor(draft.color)
      setPaletteOpen(false)
    }
  }, [draft])

  const canSave = text.trim() !== '' && label.trim() !== ''
  const save = () => {
    if (canSave) onSave({ text: text.trim(), label: label.trim(), color })
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {/* Live pin preview — follows the label and color fields. */}
            <span
              aria-hidden="true"
              className="flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-xs font-bold text-white shadow-sm"
              style={{ backgroundColor: ANNOTATION_COLORS[color] }}
            >
              {label.trim() || '·'}
            </span>
            <div className="min-w-0">
              <DialogTitle>
                {t(
                  draft?.id === null
                    ? 'annotations.editorNew'
                    : 'annotations.editorEdit',
                )}
              </DialogTitle>
              {location !== null && (
                <p className="font-mono text-xs text-muted-foreground">
                  {location}
                </p>
              )}
            </div>
          </div>
        </DialogHeader>
        <div className="flex items-end gap-4">
          <label className="w-24 space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('annotations.labelField')}
            </span>
            <Input
              value={label}
              maxLength={ANNOTATION_LABEL_MAX}
              onChange={(e) => setLabel(e.target.value)}
              className="h-8 font-mono"
            />
          </label>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              {t('annotations.colorField')}
            </span>
            {/* Collapsed by default — the palette is opt-in noise. */}
            {paletteOpen ? (
              <div
                role="radiogroup"
                aria-label={t('annotations.colorField')}
                className="flex h-8 flex-wrap items-center gap-2"
              >
                {(Object.keys(ANNOTATION_COLORS) as Array<AnnotationColor>).map(
                  (key) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={color === key}
                      aria-label={t(`annotations.colors.${key}`)}
                      title={t(`annotations.colors.${key}`)}
                      onClick={() => {
                        setColor(key)
                        setPaletteOpen(false)
                      }}
                      className={cn(
                        'h-6 w-6 rounded-full transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none',
                        color === key &&
                          'scale-110 ring-2 ring-ring ring-offset-2',
                      )}
                      style={{ backgroundColor: ANNOTATION_COLORS[key] }}
                    />
                  ),
                )}
              </div>
            ) : (
              <button
                type="button"
                aria-expanded={false}
                aria-label={t('annotations.colorField')}
                title={t('annotations.colorField')}
                onClick={() => setPaletteOpen(true)}
                className="flex h-8 items-center gap-1 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span
                  className="h-6 w-6 rounded-full"
                  style={{ backgroundColor: ANNOTATION_COLORS[color] }}
                />
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          autoFocus
          placeholder={t('annotations.placeholder')}
          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
          }}
        />
        <DialogFooter className="gap-2">
          {draft?.id !== null && (
            <Button
              variant="outline"
              className="mr-auto text-destructive"
              onClick={onDelete}
            >
              {t('annotations.delete')}
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {t('annotations.cancel')}
          </Button>
          <Button disabled={!canSave} onClick={save}>
            {t('annotations.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
