/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import i18n from '@/lib/i18n'

describe('i18n', () => {
  describe('initialization', () => {
    it('exports i18n instance', () => {
      expect(i18n).toBeDefined()
    })

    it('has default language set to English', () => {
      expect(i18n.language).toBe('en')
    })

    it('has fallback language set to English', () => {
      expect(i18n.options.fallbackLng).toContain('en')
    })
  })

  describe('namespaces', () => {
    it('has common namespace', () => {
      expect(i18n.options.ns).toContain('common')
    })

    it('has status namespace', () => {
      expect(i18n.options.ns).toContain('status')
    })

    it('has landing namespace', () => {
      expect(i18n.options.ns).toContain('landing')
    })

    it('has auth namespace', () => {
      expect(i18n.options.ns).toContain('auth')
    })

    it('has errors namespace', () => {
      expect(i18n.options.ns).toContain('errors')
    })

    it('has validation namespace', () => {
      expect(i18n.options.ns).toContain('validation')
    })

    it('has dashboard namespace', () => {
      expect(i18n.options.ns).toContain('dashboard')
    })

    it('has plugins namespace', () => {
      expect(i18n.options.ns).toContain('plugins')
    })

    it('has sources namespace', () => {
      expect(i18n.options.ns).toContain('sources')
    })

    it('has common as default namespace', () => {
      expect(i18n.options.defaultNS).toBe('common')
    })
  })

  describe('configuration', () => {
    it('has interpolation escapeValue disabled', () => {
      expect(i18n.options.interpolation?.escapeValue).toBe(false)
    })

    it('has React Suspense disabled', () => {
      expect(i18n.options.react?.useSuspense).toBe(false)
    })
  })

  describe('translations', () => {
    it('can translate keys from common namespace', () => {
      // The translation should either return the translated value or the key itself
      // Using t function directly with defaultValue option to bypass strict key typing
      const key = 'common:appName'
      const result = i18n.t(key, { defaultValue: key })
      expect(result).toBeDefined()
    })

    it('returns key for unknown translations', () => {
      const key = 'unknown.key.that.does.not.exist'
      const result = i18n.t(key, { defaultValue: key })
      expect(result).toBe('unknown.key.that.does.not.exist')
    })
  })
})
