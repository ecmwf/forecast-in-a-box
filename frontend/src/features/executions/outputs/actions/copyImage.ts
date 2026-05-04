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
import type { ActionContext, OutputAction, OutputItem } from '../types'
import { getJobResult } from '@/api/endpoints/job'
import { createLogger } from '@/lib/logger'
import { showToast } from '@/lib/toast'

const log = createLogger('OutputAction.copyImage')

async function runCopyImage(
  item: OutputItem,
  ctx: ActionContext,
): Promise<void> {
  try {
    const { blob } = await getJobResult(item.jobId, item.taskId)
    // SVG: copy source as text. ClipboardItem(`image/svg+xml`) is rejected by
    // most browsers (Chrome restricts clipboard MIMEs to a small allowlist),
    // and SVG-as-text is what users actually want for editors and notebooks.
    if (ctx.resolvedAdapter.id === 'image-vector') {
      const text = await blob.text()
      await navigator.clipboard.writeText(text)
      showToast.success('SVG source copied')
      return
    }
    // Raster: tag the blob explicitly as image/png — even if the wire blob's
    // .type is wrong (cascade may say application/pickle for raw bytes), the
    // ClipboardItem trusts the declared key.
    const tagged = new Blob([blob], { type: 'image/png' })
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': tagged }),
    ])
    showToast.success('Image copied')
  } catch (err) {
    log.error('Failed to copy image', {
      taskId: item.taskId,
      mime: item.mimeType,
      error: err,
    })
    showToast.error('Could not copy image')
  }
}

export const copyImageAction: OutputAction = {
  id: 'copy-image',
  label: (t) => t('outputs.actions.copyImage'),
  icon: Copy,
  variant: 'outline',
  isAvailable: (item) => item.isAvailable,
  run: runCopyImage,
}
