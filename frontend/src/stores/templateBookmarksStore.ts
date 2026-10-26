/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Bookmarked plugin templates, oldest first; this browser only. */

import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import { STORAGE_KEYS, STORE_VERSIONS } from '@/lib/storage-keys'

/** Identifies a template across re-ingests: blueprint ids are not stable. */
export function templateBookmarkKey(template: {
  pluginId: string | null
  displayName: string | null
}): string | null {
  return template.pluginId && template.displayName
    ? `${template.pluginId}::${template.displayName}`
    : null
}

interface TemplateBookmarksState {
  keys: Array<string>
  toggle: (key: string) => void
}

export const useTemplateBookmarksStore = create<TemplateBookmarksState>()(
  devtools(
    persist(
      (set) => ({
        keys: [],
        toggle: (key) =>
          set(
            (state) => ({
              keys: state.keys.includes(key)
                ? state.keys.filter((k) => k !== key)
                : [...state.keys, key],
            }),
            undefined,
            'toggle',
          ),
      }),
      {
        name: STORAGE_KEYS.stores.templateBookmarks,
        version: STORE_VERSIONS.templateBookmarks,
        partialize: (state) => ({ keys: state.keys }),
      },
    ),
    { name: 'TemplateBookmarksStore' },
  ),
)
