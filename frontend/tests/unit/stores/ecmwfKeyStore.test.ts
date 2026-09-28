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
import { STORAGE_KEYS } from '@/lib/storage-keys'
import { useEcmwfKeyStore } from '@/stores/ecmwfKeyStore'

describe('ecmwfKeyStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useEcmwfKeyStore.setState({ key: null, dialogOpen: false })
  })

  it('persists the key but not the dialog state', () => {
    const { setKey, openDialog } = useEcmwfKeyStore.getState()
    setKey('abc123')
    openDialog()
    const raw = localStorage.getItem(STORAGE_KEYS.stores.ecmwfKey)
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw!) as { state: Record<string, unknown> }
    expect(persisted.state).toEqual({ key: 'abc123' })
  })

  it('clears the key', () => {
    const { setKey, clearKey } = useEcmwfKeyStore.getState()
    setKey('abc123')
    clearKey()
    expect(useEcmwfKeyStore.getState().key).toBeNull()
  })
})
