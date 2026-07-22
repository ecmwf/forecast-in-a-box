/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Add an external WMS endpoint as a source after a GetCapabilities probe. */

import { useId, useState } from 'react'
import { Globe, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { probeWmsEndpoint } from '@/features/visualise/wms-probe'
import {
  MAX_COMPARISON_ENTRIES,
  useComparisonStore,
} from '@/features/visualise/stores/comparisonStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { P } from '@/components/base/typography'
import { showToast } from '@/lib/toast'

type WmsFormError =
  | { reason: 'invalid-url' | 'unreachable' | 'parse' | 'timeout' }
  | { reason: 'http'; status: number }
  | null

export function WmsUrlForm() {
  const { t } = useTranslation('visualise')
  const errorId = useId()
  const [url, setUrl] = useState('')
  const [probing, setProbing] = useState(false)
  const [error, setError] = useState<WmsFormError>(null)
  const addEntry = useComparisonStore((s) => s.addEntry)

  const submit = async () => {
    if (probing || !url.trim()) return
    setProbing(true)
    setError(null)
    const result = await probeWmsEndpoint(url)
    setProbing(false)
    if (!result.ok) {
      setError(
        result.reason === 'http'
          ? { reason: 'http', status: result.status }
          : { reason: result.reason },
      )
      return
    }
    const added = addEntry({
      kind: 'wms',
      url: result.baseUrl,
      label: result.label,
    })
    if (added === 'added') {
      showToast.success(t('toast.added', { name: result.label }))
      setUrl('')
    } else if (added === 'full') {
      showToast.error(t('toast.full', { max: MAX_COMPARISON_ENTRIES }))
    }
  }

  const errorText =
    error === null
      ? null
      : error.reason === 'invalid-url'
        ? t('picker.wmsUrl.errorInvalidUrl')
        : error.reason === 'unreachable'
          ? t('picker.wmsUrl.errorUnreachable')
          : error.reason === 'http'
            ? t('picker.wmsUrl.errorHttp', { status: error.status })
            : error.reason === 'timeout'
              ? t('picker.wmsUrl.errorTimeout')
              : t('picker.wmsUrl.errorParse')

  return (
    <div className="space-y-1.5">
      <P className="flex items-center gap-1.5 text-sm font-medium">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        {t('picker.wmsUrl.title')}
      </P>
      <P className="text-xs text-muted-foreground">
        {t('picker.wmsUrl.description')}
      </P>
      <div className="flex gap-2">
        <Input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          type="url"
          name="wms-url"
          spellCheck={false}
          aria-label={t('picker.wmsUrl.title')}
          aria-invalid={errorText !== null || undefined}
          aria-describedby={errorText ? errorId : undefined}
          placeholder={t('picker.wmsUrl.placeholder')}
          className="h-8 font-mono text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => void submit()}
          disabled={!url.trim() || probing}
          className="h-8 shrink-0 gap-1.5"
        >
          {probing && <Loader2 className="h-3 w-3 animate-spin" />}
          {probing ? t('picker.wmsUrl.probing') : t('picker.wmsUrl.connect')}
        </Button>
      </div>
      {errorText && (
        <P id={errorId} className="text-xs text-destructive">
          {errorText}
        </P>
      )}
    </div>
  )
}
