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
import { useCommandStore } from '@/stores/commandStore'

describe('commandStore', () => {
  beforeEach(() => {
    useCommandStore.setState({ isOpen: false })
  })

  describe('initial state', () => {
    it('starts with palette closed', () => {
      expect(useCommandStore.getState().isOpen).toBe(false)
    })
  })

  describe('setOpen', () => {
    it('opens the palette', () => {
      useCommandStore.getState().setOpen(true)
      expect(useCommandStore.getState().isOpen).toBe(true)
    })

    it('closes the palette', () => {
      useCommandStore.getState().setOpen(true)
      useCommandStore.getState().setOpen(false)
      expect(useCommandStore.getState().isOpen).toBe(false)
    })
  })
})
