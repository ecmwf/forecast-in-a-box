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
 * SourcesPageHeader Component
 *
 * Header section with title and subtitle
 */

import { useTranslation } from 'react-i18next'
import { H1, P } from '@/components/base/typography'

export function SourcesPageHeader() {
  const { t } = useTranslation('sources')

  return (
    <div className="flex flex-col gap-2">
      <H1>{t('title')}</H1>
      <P className="text-base text-muted-foreground">{t('subtitle')}</P>
    </div>
  )
}
