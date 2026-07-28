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

// Masked rather than <img> so the mark takes currentColor: its native ECMWF
// blue reads almost black against the dark theme.
export const Logo = ({ className }: { className?: string }) => {
  const { t } = useTranslation('common')
  return (
    <span
      role="img"
      aria-label={t('logoAlt')}
      className={cn(
        'block aspect-103/121 h-11 w-auto shrink-0 bg-primary dark:bg-primary-foreground',
        'mask-[url(/logos/fiab-mark.svg)] mask-contain mask-center mask-no-repeat',
        className,
      )}
    />
  )
}
