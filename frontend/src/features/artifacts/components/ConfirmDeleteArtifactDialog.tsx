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
 * ConfirmDeleteArtifactDialog
 *
 * Confirmation gate for deleting a downloaded model's files. Controlled:
 * the routes hold the pending target and mutate on confirm.
 */

import { useTranslation } from 'react-i18next'
import type { CompositeArtifactId } from '@/api/types/artifacts.types'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface DeleteArtifactTarget {
  id: CompositeArtifactId
  name: string
}

export interface ConfirmDeleteArtifactDialogProps {
  target: DeleteArtifactTarget | null
  onCancel: () => void
  onConfirm: (id: CompositeArtifactId) => void
}

export function ConfirmDeleteArtifactDialog({
  target,
  onCancel,
  onConfirm,
}: ConfirmDeleteArtifactDialogProps) {
  const { t } = useTranslation('artifacts')

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('confirmDelete.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('confirmDelete.description', { name: target?.name ?? '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('confirmDelete.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (target) onConfirm(target.id)
            }}
          >
            {t('confirmDelete.confirm')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
