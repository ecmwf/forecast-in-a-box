/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'
import { Columns2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import type { ForecastRunViewModel } from '@/features/journal/types'
import { buildRunPairComparison } from '@/features/visualise/compare-runs'
import { Button } from '@/components/ui/button'
import { showToast } from '@/lib/toast'

interface CompareSelectionBarProps {
  runs: ReadonlyArray<ForecastRunViewModel>
  selectedIds: ReadonlySet<string>
  onClear: () => void
}

/** Sits under a run list's search header: two ticked runs open in Visualise. */
export function CompareSelectionBar({
  runs,
  selectedIds,
  onClear,
}: CompareSelectionBarProps) {
  const { t } = useTranslation('journal')
  const navigate = useNavigate()
  const [comparing, setComparing] = useState(false)

  async function compare() {
    const picked = runs.filter((run) => selectedIds.has(run.runId))
    if (picked.length !== 2) return
    setComparing(true)
    try {
      const result = await buildRunPairComparison(picked[0], picked[1])
      if (!result.ok) {
        showToast.error(t('compare.noOutput'))
        return
      }
      void navigate({ to: '/visualise', search: result.search })
    } finally {
      setComparing(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-sm text-muted-foreground">
      <span>
        {selectedIds.size > 0
          ? t('compare.selectedCount', { count: selectedIds.size })
          : t('compare.selectTwoHint')}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={selectedIds.size !== 2 || comparing}
        onClick={() => void compare()}
      >
        <Columns2 className="mr-1.5 h-4 w-4" />
        {t('compare.compareSelected')}
      </Button>
      {selectedIds.size > 0 && (
        <Button size="sm" variant="ghost" onClick={onClear}>
          {t('compare.clear')}
        </Button>
      )}
    </div>
  )
}
