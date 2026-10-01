/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Download } from 'lucide-react'
import { fetchJobResultBlob } from '../useJobResult'
import type { ActionContext, OutputAction, OutputItem } from '../types'
import { createLogger } from '@/lib/logger'
import { downloadBlob } from '@/lib/download-blob'
import { queryClient } from '@/lib/queryClient'
import { showToast } from '@/lib/toast'

const log = createLogger('OutputAction.download')

/** Download name from the block's display name, e.g. "map_plot.png". */
export function outputFileName(item: OutputItem, extension: string): string {
  const base = item.blockName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
  return `${base || item.originalBlock}.${extension}`
}

async function runDownload(
  item: OutputItem,
  ctx: ActionContext,
): Promise<void> {
  try {
    // Shared cache — reuses the blob if a viewer or thumbnail already loaded it.
    const { blob } = await fetchJobResultBlob(
      queryClient,
      item.jobId,
      item.taskId,
    )
    downloadBlob(blob, outputFileName(item, ctx.resolvedAdapter.extension))
  } catch (err) {
    log.error('Failed to download output', {
      jobId: item.jobId,
      taskId: item.taskId,
      error: err,
    })
    showToast.error(err instanceof Error ? err.message : String(err))
  }
}

export const downloadAction: OutputAction = {
  id: 'download',
  label: (t) => t('outputs.actions.download'),
  icon: Download,
  variant: 'outline',
  isAvailable: (item) => item.isAvailable,
  run: runDownload,
}
