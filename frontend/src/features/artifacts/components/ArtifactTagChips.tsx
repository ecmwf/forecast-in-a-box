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
 * ArtifactTagChips
 *
 * Store-catalog tags (key → optional detail) as outline chips; long details
 * move to the tooltip. Renders nothing when there are no tags.
 */

import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'

export interface ArtifactTagChipsProps {
  tags: Record<string, string | null>
  /** Show at most this many chips, collapsing the rest into a "+N" chip. */
  max?: number
  className?: string
}

export function ArtifactTagChips({
  tags,
  max,
  className,
}: ArtifactTagChipsProps) {
  const { t } = useTranslation('artifacts')
  const entries = Object.entries(tags)
  if (entries.length === 0) return null

  const visible = max !== undefined ? entries.slice(0, max) : entries
  const hidden = max !== undefined ? entries.slice(max) : []

  return (
    <>
      {visible.map(([key, value]) => (
        <Badge
          key={key}
          variant="outline"
          className={className}
          title={value && value.length > 24 ? `${key}: ${value}` : undefined}
        >
          {value && value.length <= 24 ? `${key}: ${value}` : key}
        </Badge>
      ))}
      {hidden.length > 0 && (
        <Badge
          variant="outline"
          className={className}
          title={hidden
            .map(([key, value]) => (value ? `${key}: ${value}` : key))
            .join('\n')}
        >
          {t('tags.overflow', { count: hidden.length })}
        </Badge>
      )}
    </>
  )
}
