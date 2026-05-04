/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { ImageOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ThumbnailProps } from '../types'
import { getJobResult } from '@/api/endpoints/job'
import { createLogger } from '@/lib/logger'

const log = createLogger('ImageThumbnail')

/** Resolve the MIME the browser should use to render the blob. The wire
 * Content-Type is unreliable (cascade may say `application/pickle` for raw
 * bytes); the adapter knows the truth. */
function browserImageMime(adapterId: string): string {
  if (adapterId === 'image-vector') return 'image/svg+xml'
  return 'image/png'
}

export function ImageThumbnail({ item, adapter }: ThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    if (!item.isAvailable) return
    let revoked = false
    let createdUrl: string | null = null
    getJobResult(item.jobId, item.taskId)
      .then(({ blob }) => {
        if (revoked) return
        const tagged = new Blob([blob], { type: browserImageMime(adapter.id) })
        createdUrl = URL.createObjectURL(tagged)
        setUrl(createdUrl)
      })
      .catch((err) => {
        log.error('Failed to fetch image thumbnail', {
          taskId: item.taskId,
          error: err,
        })
        if (!revoked) setErrored(true)
      })
    return () => {
      revoked = true
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [adapter.id, item.isAvailable, item.jobId, item.taskId])

  if (errored) {
    return (
      <div className="flex aspect-video items-center justify-center rounded bg-muted">
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="aspect-video overflow-hidden rounded bg-muted">
      {url ? (
        <img
          src={url}
          alt={item.originalBlock}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-muted-foreground/10" />
      )}
    </div>
  )
}
