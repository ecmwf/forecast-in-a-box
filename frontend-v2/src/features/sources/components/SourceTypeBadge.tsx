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
 * SourceTypeBadge Component
 *
 * Visual badge for source type (model, dataset, connector)
 */

import { Brain, Database, Link } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SourceType } from '@/api/types/sources.types'
import { SOURCE_TYPE_METADATA } from '@/api/types/sources.types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface SourceTypeBadgeProps {
  type: SourceType
  size?: 'sm' | 'default'
  showIcon?: boolean
}

const iconMap = {
  model: Brain,
  dataset: Database,
  connector: Link,
}

export function SourceTypeBadge({
  type,
  size = 'default',
  showIcon = true,
}: SourceTypeBadgeProps) {
  const { t } = useTranslation('sources')
  const metadata = SOURCE_TYPE_METADATA[type]
  const Icon = iconMap[type]

  return (
    <Badge
      variant="outline"
      className={cn(
        metadata.bgColor,
        metadata.color,
        metadata.borderColor,
        size === 'sm' && 'px-1.5 py-0 text-sm',
      )}
    >
      {showIcon && (
        <Icon
          className={cn('mr-1', size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')}
        />
      )}
      {t(`sourceTypes.${type}`)}
    </Badge>
  )
}
