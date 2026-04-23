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
 * OutputCard Component
 *
 * Mime-type-aware output card with PNG preview and lightbox.
 */

import { useCallback, useEffect, useState } from 'react'
import { Binary, Download, FileDown, Globe, Map, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import { getJobResult } from '@/api/endpoints/job'
import { useJobContentType } from '@/api/hooks/useJobs'
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'
import { createLogger } from '@/lib/logger'
import { showToast } from '@/lib/toast'

const log = createLogger('OutputCard')

interface OutputCardProps {
  jobId: string
  taskId: string
  productName: string
}

interface MimeMeta {
  icon: LucideIcon
  label: string
  ext: string
}

const MIME_META: Record<string, MimeMeta> = {
  'image/png': { icon: Map, label: 'PNG Image', ext: 'png' },
  'application/grib': { icon: FileDown, label: 'GRIB', ext: 'grib' },
  'application/netcdf': { icon: Globe, label: 'NetCDF', ext: 'nc' },
  'application/numpy': { icon: Binary, label: 'NumPy', ext: 'npy' },
  'application/pickle': { icon: Binary, label: 'Pickle (bytes)', ext: 'pkl' },
}

const UNKNOWN_META: MimeMeta = {
  icon: FileDown,
  label: 'Unknown',
  ext: 'bin',
}

// PNG file signature (first 8 bytes).
const PNG_MAGIC = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

function getMimeMeta(contentType: string | null): MimeMeta {
  if (!contentType) return UNKNOWN_META
  // Without `noUncheckedIndexedAccess` the record lookup is typed as
  // `MimeMeta` (not `MimeMeta | undefined`), but at runtime it can be
  // missing — the cast keeps the fallback reachable.
  const known = MIME_META[contentType] as MimeMeta | undefined
  if (known) return known
  return { ...UNKNOWN_META, label: contentType }
}

export function OutputCard({ jobId, taskId, productName }: OutputCardProps) {
  const { t } = useTranslation('executions')
  // Probe the MIME type with a HEAD request so we can render the correct
  // icon / inline preview without forcing a full download of every output.
  const { data: contentType = null } = useJobContentType(jobId, taskId)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  // Promoted MIME when a PNG magic sniff succeeds on an application/pickle
  // blob. See the effect below — remove alongside that block once the
  // backend emits correct Content-Type for image sinks.
  const [sniffedContentType, setSniffedContentType] = useState<string | null>(
    null,
  )

  const effectiveContentType = sniffedContentType ?? contentType
  const {
    icon: Icon,
    label: contentTypeLabel,
    ext: fileExt,
  } = getMimeMeta(effectiveContentType)
  const isPng = effectiveContentType === 'image/png'
  // WORKAROUND: cascade's encode_result (backend/src/forecastbox/domain/run/
  // cascade.py) labels any raw-bytes result as `application/pickle`, including
  // the PNG bytes from sink_image. We sniff the PNG magic bytes to render
  // inline anyway. Drop this branch (and the sniffedContentType state) once
  // the backend emits Content-Type: image/png for image sinks.
  const shouldFetchForPreview =
    isPng ||
    (contentType === 'application/pickle' && sniffedContentType === null)

  useEffect(() => {
    if (!shouldFetchForPreview) return

    let revoked = false
    setIsLoading(true)

    getJobResult(jobId, taskId)
      .then(async ({ blob }) => {
        if (revoked) return

        // For pickle-labeled blobs, promote to image/png only if the magic
        // matches; otherwise fall through to the non-preview rendering.
        if (contentType === 'application/pickle') {
          const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
          // Re-check revoked since we just awaited — the component may have
          // unmounted while the arraybuffer was being read.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (revoked) return
          const isPngBlob =
            head.length === PNG_MAGIC.length &&
            PNG_MAGIC.every((byte, i) => byte === head[i])
          if (!isPngBlob) return
          setSniffedContentType('image/png')
        }

        const url = URL.createObjectURL(blob)
        setThumbnailUrl(url)
      })
      .catch((err) => {
        log.error('Failed to fetch thumbnail', { jobId, taskId, error: err })
        showToast.error(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!revoked) setIsLoading(false)
      })

    return () => {
      revoked = true
      setThumbnailUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
    }
  }, [jobId, taskId, shouldFetchForPreview, contentType])

  const handleDownload = useCallback(async () => {
    try {
      const { blob } = await getJobResult(jobId, taskId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${productName}.${fileExt}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      log.error('Failed to download output', { jobId, taskId, error: err })
      showToast.error(err instanceof Error ? err.message : String(err))
    }
  }, [jobId, taskId, productName, fileExt])

  const handleView = () => setLightboxOpen(true)

  useEffect(() => {
    if (!lightboxOpen) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setLightboxOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [lightboxOpen])

  return (
    <>
      <div className="w-full space-y-2 rounded-lg border bg-card p-3">
        {thumbnailUrl ? (
          <div
            role="button"
            tabIndex={0}
            className="aspect-video cursor-pointer overflow-hidden rounded bg-muted"
            onClick={handleView}
            onKeyDown={(e) => e.key === 'Enter' && handleView()}
          >
            <img
              src={thumbnailUrl}
              alt={productName}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded bg-muted">
            {isLoading ? (
              <div className="h-8 w-8 animate-pulse rounded bg-muted-foreground/20" />
            ) : (
              <Icon className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
        )}

        <div className="space-y-0.5">
          <P className="truncate font-medium">{productName}</P>
          <P className="text-muted-foreground">{contentTypeLabel}</P>
        </div>

        <div className="flex gap-1.5">
          {thumbnailUrl && (
            <Button size="sm" variant="outline" onClick={handleView}>
              {t('outputs.view')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {lightboxOpen && thumbnailUrl && (
        <div
          role="button"
          tabIndex={0}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightboxOpen(false)}
          onKeyDown={(e) => e.key === 'Enter' && setLightboxOpen(false)}
        >
          <div
            role="presentation"
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={thumbnailUrl}
              alt={productName}
              className="h-[85vh] w-[85vw] rounded-lg object-contain [image-rendering:pixelated]"
            />
            <div className="absolute top-2 right-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={handleDownload}>
                <Download className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLightboxOpen(false)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
