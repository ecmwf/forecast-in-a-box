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
 * Text editor for one annotation — opened by an armed map click (create)
 * or by clicking an existing pin (edit/delete). A dialog rather than an
 * in-map popover: it works identically on both side-by-side panels and
 * never fights the map for pointer events.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface AnnotationDraft {
  /** Existing annotation id, or null when creating a new one. */
  id: string | null
  text: string
  /** ①②③ number shown in the dialog title. */
  number: number
}

export function AnnotationEditorDialog({
  draft,
  onSave,
  onDelete,
  onClose,
}: {
  draft: AnnotationDraft | null
  onSave: (text: string) => void
  onDelete: () => void
  onClose: () => void
}) {
  const { t } = useTranslation('visualise')
  const [text, setText] = useState('')

  useEffect(() => {
    if (draft) setText(draft.text)
  }, [draft])

  const save = () => {
    if (text.trim()) onSave(text.trim())
    else onClose()
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('annotations.editorTitle', { number: draft?.number ?? 0 })}
          </DialogTitle>
        </DialogHeader>
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
          <Button disabled={!text.trim()} onClick={save}>
            {t('annotations.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
