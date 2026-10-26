/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  templateBookmarkKey,
  useTemplateBookmarksStore,
} from '@/stores/templateBookmarksStore'

describe('templateBookmarksStore', () => {
  beforeEach(() => useTemplateBookmarksStore.setState({ keys: [] }))

  it('keeps bookmarks in the order they were added', () => {
    const { toggle } = useTemplateBookmarksStore.getState()
    toggle('p::B')
    toggle('p::A')
    expect(useTemplateBookmarksStore.getState().keys).toEqual(['p::B', 'p::A'])
  })

  it('removes a bookmark on a second toggle', () => {
    const { toggle } = useTemplateBookmarksStore.getState()
    toggle('p::A')
    toggle('p::B')
    toggle('p::A')
    expect(useTemplateBookmarksStore.getState().keys).toEqual(['p::B'])
  })

  it('keys a template by plugin and name, or not at all', () => {
    expect(templateBookmarkKey({ pluginId: 'p', displayName: 'A' })).toBe(
      'p::A',
    )
    expect(templateBookmarkKey({ pluginId: null, displayName: 'A' })).toBe(null)
  })
})
