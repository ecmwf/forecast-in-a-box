/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface BookmarkToggleProps {
  bookmarked: boolean
  onToggle: () => void
  /** Softer colour, for cards where it must not outshine the title. */
  subtle?: boolean
  className?: string
}

/** The star that bookmarks a workflow or template. */
export function BookmarkToggle({
  bookmarked,
  onToggle,
  subtle = false,
  className,
}: BookmarkToggleProps) {
  const { t } = useTranslation('dashboard')
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      aria-pressed={bookmarked}
      aria-label={t(bookmarked ? 'presets.removeBookmark' : 'presets.bookmark')}
      title={t(bookmarked ? 'presets.removeBookmark' : 'presets.bookmark')}
      className={cn(
        'hit-target-y text-muted-foreground transition-colors',
        subtle ? 'hover:text-amber-500' : 'hover:text-yellow-500',
        bookmarked && (subtle ? 'text-amber-400/80' : 'text-yellow-500'),
        className,
      )}
    >
      <Star
        className={cn(
          'h-5 w-5',
          bookmarked && (subtle ? 'fill-amber-400/50' : 'fill-yellow-500'),
        )}
      />
    </button>
  )
}
