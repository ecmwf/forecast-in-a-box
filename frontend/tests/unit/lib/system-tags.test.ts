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
 * system-tags Unit Tests
 *
 * Covers the internal blueprint markers that keep one-off runs out of the
 * saved-presets list.
 */

import { describe, expect, it } from 'vitest'
import {
  ONEOFF_TAG,
  SYSTEM_TAG_PREFIX,
  isOneoffBlueprint,
  stripSystemTags,
  withOneoffTag,
} from '@/lib/system-tags'

describe('system-tags', () => {
  it('ONEOFF_TAG carries the system prefix', () => {
    expect(ONEOFF_TAG.startsWith(SYSTEM_TAG_PREFIX)).toBe(true)
  })

  describe('stripSystemTags', () => {
    it('returns an empty array for null or undefined', () => {
      expect(stripSystemTags(null)).toEqual([])
      expect(stripSystemTags(undefined)).toEqual([])
    })

    it('drops system markers and keeps user tags in order', () => {
      expect(stripSystemTags(['europe', ONEOFF_TAG, 'prod'])).toEqual([
        'europe',
        'prod',
      ])
    })

    it('leaves a clean tag list unchanged', () => {
      expect(stripSystemTags(['a', 'b'])).toEqual(['a', 'b'])
    })
  })

  describe('isOneoffBlueprint', () => {
    it('is true when the one-off marker is present', () => {
      expect(isOneoffBlueprint(['x', ONEOFF_TAG])).toBe(true)
    })

    it('is false for user tags, empty lists, and null', () => {
      expect(isOneoffBlueprint(['x'])).toBe(false)
      expect(isOneoffBlueprint([])).toBe(false)
      expect(isOneoffBlueprint(null)).toBe(false)
      expect(isOneoffBlueprint(undefined)).toBe(false)
    })
  })

  describe('withOneoffTag', () => {
    it('appends the marker, preserving user tags', () => {
      expect(withOneoffTag(['a'])).toEqual(['a', ONEOFF_TAG])
    })

    it('handles null and undefined', () => {
      expect(withOneoffTag(null)).toEqual([ONEOFF_TAG])
      expect(withOneoffTag(undefined)).toEqual([ONEOFF_TAG])
    })

    it('is idempotent', () => {
      expect(withOneoffTag([ONEOFF_TAG])).toEqual([ONEOFF_TAG])
      expect(withOneoffTag(withOneoffTag(['a']))).toEqual(['a', ONEOFF_TAG])
    })

    it('does not mutate its input', () => {
      const input = ['a']
      withOneoffTag(input)
      expect(input).toEqual(['a'])
    })
  })
})
