/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export const Logo = ({ className }: { className?: string }) => {
  const { t } = useTranslation('common')
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <img
        src="/logos/fiab.png"
        alt={t('logoAlt')}
        className="-my-8 h-12 w-auto"
      />
    </div>
  )
}
