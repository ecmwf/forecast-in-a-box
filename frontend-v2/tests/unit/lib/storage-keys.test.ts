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
  STORAGE_KEYS,
  STORE_VERSIONS,
  clearAllFiabStorage,
} from '@/lib/storage-keys'

describe('STORAGE_KEYS', () => {
  describe('auth keys', () => {
    it('has logout flag key with correct prefix', () => {
      expect(STORAGE_KEYS.auth.logoutFlag).toBe('fiab.auth.logout-flag')
    })

    it('has anonymous ID key with correct prefix', () => {
      expect(STORAGE_KEYS.auth.anonymousId).toBe('fiab.auth.anonymous-id')
    })

    it('has redirect URL key with correct prefix', () => {
      expect(STORAGE_KEYS.auth.redirectUrl).toBe('fiab.auth.redirect-url')
    })
  })

  describe('store keys', () => {
    it('has UI store key with correct prefix', () => {
      expect(STORAGE_KEYS.stores.ui).toBe('fiab.store.ui')
    })

    it('has config store key with correct prefix', () => {
      expect(STORAGE_KEYS.stores.config).toBe('fiab.store.config')
    })

    it('has fable builder store key with correct prefix', () => {
      expect(STORAGE_KEYS.stores.fableBuilder).toBe('fiab.store.fable-builder')
    })
  })

  describe('all keys use fiab prefix', () => {
    it('all auth keys start with fiab.', () => {
      Object.values(STORAGE_KEYS.auth).forEach((key) => {
        expect(key).toMatch(/^fiab\./)
      })
    })

    it('all store keys start with fiab.', () => {
      Object.values(STORAGE_KEYS.stores).forEach((key) => {
        expect(key).toMatch(/^fiab\./)
      })
    })
  })
})

describe('STORE_VERSIONS', () => {
  it('has UI store version', () => {
    expect(STORE_VERSIONS.ui).toBe(4)
  })

  it('has config store version', () => {
    expect(STORE_VERSIONS.config).toBe(1)
  })

  it('has fable builder store version', () => {
    expect(STORE_VERSIONS.fableBuilder).toBe(2)
  })
})

describe('clearAllFiabStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('removes all keys with fiab. prefix', () => {
    localStorage.setItem('fiab.test.one', 'value1')
    localStorage.setItem('fiab.test.two', 'value2')
    localStorage.setItem('fiab.auth.token', 'secret')

    clearAllFiabStorage()

    expect(localStorage.getItem('fiab.test.one')).toBeNull()
    expect(localStorage.getItem('fiab.test.two')).toBeNull()
    expect(localStorage.getItem('fiab.auth.token')).toBeNull()
  })

  it('preserves keys without fiab. prefix', () => {
    localStorage.setItem('other-app-key', 'preserve-me')
    localStorage.setItem('another-key', 'also-preserve')
    localStorage.setItem('fiab.should-remove', 'remove-me')

    clearAllFiabStorage()

    expect(localStorage.getItem('other-app-key')).toBe('preserve-me')
    expect(localStorage.getItem('another-key')).toBe('also-preserve')
    expect(localStorage.getItem('fiab.should-remove')).toBeNull()
  })

  it('handles empty localStorage', () => {
    expect(() => clearAllFiabStorage()).not.toThrow()
  })

  it('handles localStorage with no fiab keys', () => {
    localStorage.setItem('some-key', 'value')

    clearAllFiabStorage()

    expect(localStorage.getItem('some-key')).toBe('value')
  })
})
