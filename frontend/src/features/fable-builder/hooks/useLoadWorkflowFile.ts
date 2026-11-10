/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { shelveBenchIfDirty } from '@/features/fable-builder/stores/workbenchShelfStore'
import {
  WorkflowFileError,
  readWorkflowFile,
  workflowNameFromFile,
} from '@/features/fable-builder/utils/workflow-file'
import { showToast } from '@/lib/toast'

function toastFileError(t: TFunction<'configure'>, error: unknown): void {
  const code = error instanceof WorkflowFileError ? error.code : 'parse'
  const detail = error instanceof Error ? error.message : String(error)
  const [title, description] = {
    tooLarge: [
      t('header.fileTooLargeTitle'),
      t('header.fileTooLargeDescription'),
    ],
    invalid: [
      t('header.invalidConfigTitle'),
      t('header.invalidConfigDescription'),
    ],
    read: [t('header.readFailed'), detail || t('header.readUnknownError')],
    parse: [t('header.parseFailed'), detail],
  }[code]
  showToast.error(title, description)
}

/** Loads a workflow file onto the bench, named after the file, parking unsaved work; resolves false when refused. */
export function useLoadWorkflowFile(): (file: File) => Promise<boolean> {
  const { t } = useTranslation('configure')
  const setFable = useFableBuilderStore((state) => state.setFable)
  return useCallback(
    async (file: File) => {
      let fable: FableBuilderV1
      try {
        fable = await readWorkflowFile(file)
      } catch (error) {
        toastFileError(t, error)
        return false
      }
      const { shelved, evicted } = shelveBenchIfDirty(fable)
      if (evicted) showToast.warning(t('shelf.evicted'))
      setFable(fable, null)
      const name = workflowNameFromFile(file.name)
      // An exported untitled workflow stays untitled; loading is not an edit.
      const untitled = t('page.untitledConfiguration').toLowerCase()
      useFableBuilderStore.setState({
        fableName: name.toLowerCase() === untitled ? '' : name,
      })
      showToast.success(t('header.configLoaded'))
      if (shelved) showToast.info(t('shelf.setAside'))
      return true
    },
    [t, setFable],
  )
}
