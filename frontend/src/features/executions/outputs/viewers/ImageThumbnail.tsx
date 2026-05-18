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
import { useJobResultBlob } from '../useJobResult'
import type { ThumbnailProps } from '../types'

/** Resolve the MIME the browser should use to render the blob. The wire
 * Content-Type is unreliable (cascade may say `application/pickle` for raw
 * bytes); the adapter knows the truth. */
function browserImageMime(adapterId: string): string {
  if (adapterId === 'image-vector') return 'image/svg+xml'
  return 'image/png'
}

export function ImageThumbnail({ item, adapter }: ThumbnailProps) {
  const [url, setUrl] = useState<string | null>(null)
  // Shared cache — the full viewer for this same output reuses this blob.
  const { data, isError } = useJobResultBlob(
    item.jobId,
    item.taskId,
    item.isAvailable,
  )
  const blob = data?.blob

  useEffect(() => {
    if (!blob) return
    const tagged = new Blob([blob], { type: browserImageMime(adapter.id) })
    const createdUrl = URL.createObjectURL(tagged)
    setUrl(createdUrl)
    return () => URL.revokeObjectURL(createdUrl)
  }, [adapter.id, blob])

  if (isError) {
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
