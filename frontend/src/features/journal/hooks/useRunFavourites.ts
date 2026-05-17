/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useLocalStorage } from '@/hooks/useLocalStorage'
import { STORAGE_KEYS } from '@/lib/storage-keys'

/** localStorage map of bookmarked run ids. */
type BookmarkStore = Record<string, boolean>

/**
 * localStorage-backed run bookmarks, keyed by run_id — separate from the
 * blueprint preset favourites in useConfigPresets.
 */
export function useRunFavourites() {
  const [bookmarks, setBookmarks] = useLocalStorage<BookmarkStore>(
    STORAGE_KEYS.runs.bookmarks,
    {},
  )

  function toggleBookmark(runId: string) {
    setBookmarks((prev) => {
      const next = { ...prev }
      if (next[runId]) delete next[runId]
      else next[runId] = true
      return next
    })
  }

  /** Whether a run is bookmarked — its id is a key only while bookmarked. */
  function isBookmarked(runId: string): boolean {
    return runId in bookmarks
  }

  return { isBookmarked, toggleBookmark }
}
