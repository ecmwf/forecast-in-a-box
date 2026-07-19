/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Add a GRIB directory on the FIAB host as a source (lens started on
 *  activation). */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useComparisonStore } from '../../stores/comparisonStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { P } from '@/components/base/typography'
import { showToast } from '@/lib/toast'

export function HostPathForm() {
  const { t } = useTranslation('visualise')
  const [path, setPath] = useState('')
  const addEntry = useComparisonStore((s) => s.addEntry)

  const submit = () => {
    const trimmed = path.trim()
    if (!trimmed) return
    const label = trimmed.replace(/\/$/, '').split('/').pop() || trimmed
    const result = addEntry({ kind: 'path', path: trimmed, label })
    if (result === 'added') {
      showToast.success(t('toast.added', { name: label }))
      setPath('')
    } else if (result === 'full') {
      showToast.error(t('toast.full', { max: 8 }))
    }
  }

  return (
    <div className="space-y-1.5">
      <P className="text-sm font-medium">{t('picker.hostPath.title')}</P>
      <P className="text-xs text-muted-foreground">
        {t('picker.hostPath.description')}
      </P>
      <div className="flex gap-2">
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder={t('picker.hostPath.placeholder')}
          className="h-8 font-mono text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={submit}
          disabled={!path.trim()}
          className="h-8 shrink-0"
        >
          {t('picker.add')}
        </Button>
      </div>
    </div>
  )
}
