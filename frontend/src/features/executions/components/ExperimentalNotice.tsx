/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { FlaskConical } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Banner above experimental run-detail visualisations — flags that the
 * view may change or be removed and isn't a stable API surface yet. */
export function ExperimentalNotice() {
  const { t } = useTranslation('executions')
  return (
    <div className="flex items-center gap-2 truncate rounded-md border border-amber-300/60 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{t('compilation.experimental')}</span>
    </div>
  )
}
