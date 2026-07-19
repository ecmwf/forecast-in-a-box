/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Copy } from 'lucide-react'
import { fetchJobResultBlob } from '../useJobResult'
import type { ActionContext, OutputAction, OutputItem } from '../types'
import i18n from '@/lib/i18n'
import { copyToClipboard } from '@/lib/clipboard'
import { createLogger } from '@/lib/logger'
import { queryClient } from '@/lib/queryClient'
import { showToast } from '@/lib/toast'

const log = createLogger('OutputAction.copyImage')

function runCopyImage(item: OutputItem, ctx: ActionContext): Promise<void> {
  // No await before the copy call — the item must be built inside the
  // gesture (Safari). Shared cache reuses an already-loaded blob.
  const blob = fetchJobResultBlob(queryClient, item.jobId, item.taskId).then(
    (result) => result.blob,
  )
  // SVG: copy source as text. ClipboardItem(`image/svg+xml`) is rejected by
  // most browsers (Chrome restricts clipboard MIMEs to a small allowlist),
  // and SVG-as-text is what users actually want for editors and notebooks.
  const isSvg = ctx.resolvedAdapter.id === 'image-vector'
  const copied = isSvg
    ? copyToClipboard('text/plain', blob.then((b) => b.text()))
    : // Wire blobs can carry opaque types, so key off the item's MIME.
      copyToClipboard(
        item.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png',
        blob,
      )
  return copied
    .then(() => {
      showToast.success(
        i18n.t(
          isSvg
            ? 'executions:outputs.copy.svgSuccess'
            : 'executions:outputs.copy.imageSuccess',
        ),
      )
    })
    .catch((err: unknown) => {
      log.error('Failed to copy image', {
        taskId: item.taskId,
        mime: item.mimeType,
        error: err,
      })
      showToast.error(i18n.t('executions:outputs.copy.error'))
    })
}

export const copyImageAction: OutputAction = {
  id: 'copy-image',
  label: (t) => t('outputs.actions.copyImage'),
  icon: Copy,
  variant: 'outline',
  isAvailable: (item) => item.isAvailable,
  run: runCopyImage,
}
