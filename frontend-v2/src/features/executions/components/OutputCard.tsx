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
import { Button } from '@/components/ui/button'
import { P } from '@/components/base/typography'
import { createLogger } from '@/lib/logger'
import { showToast } from '@/lib/toast'

const log = createLogger('OutputCard')

interface OutputCardProps {
  jobId: string
  taskId: string
  productName: string
  contentType: string | null
}

const MIME_ICONS: Record<string, LucideIcon> = {
  'image/png': Map,
  'application/grib': FileDown,
  'application/netcdf': Globe,
  'application/numpy': Binary,
}

function getMimeIcon(contentType: string | null): LucideIcon {
  if (!contentType) return FileDown
  return MIME_ICONS[contentType] ?? FileDown
}

function getMimeLabel(contentType: string | null): string {
  if (!contentType) return 'Unknown'
  const labels: Record<string, string> = {
    'image/png': 'PNG Image',
    'application/grib': 'GRIB',
    'application/netcdf': 'NetCDF',
    'application/numpy': 'NumPy',
  }
  return labels[contentType] ?? contentType
}

function getFileExtension(contentType: string | null): string {
  if (!contentType) return 'bin'
  const extensions: Record<string, string> = {
    'image/png': 'png',
    'application/grib': 'grib',
    'application/netcdf': 'nc',
    'application/numpy': 'npy',
  }
  return extensions[contentType] ?? 'bin'
}

export function OutputCard({
  jobId,
  taskId,
  productName,
  contentType,
}: OutputCardProps) {
  const { t } = useTranslation('executions')
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const Icon = getMimeIcon(contentType)
  const contentTypeLabel = getMimeLabel(contentType)
  const isPng = contentType === 'image/png'

  useEffect(() => {
    if (!isPng) return

    let revoked = false
    setIsLoading(true)

    getJobResult(jobId, taskId)
      .then(({ blob }) => {
        if (revoked) return
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
  }, [jobId, taskId, isPng])

  const handleDownload = useCallback(async () => {
    try {
      const { blob } = await getJobResult(jobId, taskId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${productName}.${getFileExtension(contentType)}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      log.error('Failed to download output', { jobId, taskId, error: err })
      showToast.error(err instanceof Error ? err.message : String(err))
    }
  }, [jobId, taskId, productName, contentType])

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
            className="aspect-video cursor-pointer overflow-hidden rounded bg-muted"
            onClick={handleView}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={thumbnailUrl}
              alt={productName}
              className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain"
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
