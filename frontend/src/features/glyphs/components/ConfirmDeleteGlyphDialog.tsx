/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Confirmation gate for deleting a global variable. */

import { useTranslation } from 'react-i18next'
import type { GlobalGlyphItem } from '@/api/types/fable.types'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDeleteGlyphDialogProps {
  target: GlobalGlyphItem | null
  busy: boolean
  onCancel: () => void
  onConfirm: (glyph: GlobalGlyphItem) => void
}

export function ConfirmDeleteGlyphDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: ConfirmDeleteGlyphDialogProps) {
  const { t } = useTranslation('glyphs')
  const key = target ? '${' + target.key + '}' : ''
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('confirmDelete.title', { key })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('confirmDelete.description', { key })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('confirmDelete.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (target) onConfirm(target)
            }}
          >
            {t('confirmDelete.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
