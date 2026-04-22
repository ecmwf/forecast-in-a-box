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
import { buildAutocompleteInsertion } from '@/features/fable-builder/utils/build-autocomplete-insertion'

describe('buildAutocompleteInsertion', () => {
  describe('variable picks (intrinsic / global / local)', () => {
    it('inserts name, auto-closes `}`, and lands cursor BEFORE the brace for chaining', () => {
      const result = buildAutocompleteInsertion(
        { name: 'startDatetime', source: 'intrinsic' },
        '', // nothing after replaceEnd → no `}` yet
      )
      expect(result).toEqual({
        text: 'startDatetime}',
        // Cursor between `e` and `}` so the user can immediately type ` | sub_days`.
        cursorOffset: 'startDatetime'.length,
      })
    })

    it('does not append `}` when one already follows; cursor still after name', () => {
      const result = buildAutocompleteInsertion(
        { name: 'myVar', source: 'global' },
        '} suffix',
      )
      expect(result).toEqual({
        text: 'myVar',
        cursorOffset: 'myVar'.length,
      })
    })

    it('handles local-source variables identically to globals', () => {
      const result = buildAutocompleteInsertion(
        { name: 'localKey', source: 'local' },
        '',
      )
      expect(result.text).toBe('localKey}')
      expect(result.cursorOffset).toBe('localKey'.length)
    })
  })

  describe('helper picks with arguments (filter or global)', () => {
    it('opens parens and lands cursor inside for an arg-taking filter', () => {
      const result = buildAutocompleteInsertion(
        {
          name: 'add_days',
          source: 'filter',
          description: 'Add n days to a datetime: ${dt | add_days(n)}',
        },
        '',
      )
      expect(result.text).toBe('add_days()')
      // Cursor should land between the parens.
      expect(result.cursorOffset).toBe('add_days('.length)
    })

    it('opens parens for an arg-taking global helper', () => {
      const result = buildAutocompleteInsertion(
        {
          name: 'timedelta',
          source: 'helperGlobal',
          description:
            'Python timedelta constructor, for inline arithmetic: ${dt + timedelta(days=1)}',
        },
        '',
      )
      expect(result.text).toBe('timedelta()')
      expect(result.cursorOffset).toBe('timedelta('.length)
    })

    it('does NOT auto-close `}` for arg-taking helpers (user still needs to finish)', () => {
      const result = buildAutocompleteInsertion(
        {
          name: 'sub_days',
          source: 'filter',
          description: 'Subtract n days from a datetime: ${dt | sub_days(n)}',
        },
        '',
      )
      expect(result.text).not.toContain('}')
    })
  })

  describe('helper picks without arguments', () => {
    it('treats a no-arg filter like a variable (auto-close `}`, cursor before brace)', () => {
      const result = buildAutocompleteInsertion(
        {
          name: 'floor_day',
          source: 'filter',
          description: 'Truncate a datetime to midnight: ${dt | floor_day}',
        },
        '',
      )
      expect(result.text).toBe('floor_day}')
      // Cursor between `y` and `}` so chaining a second filter is one keystroke.
      expect(result.cursorOffset).toBe('floor_day'.length)
    })

    it('does not auto-close `}` when one already exists, even for a no-arg filter', () => {
      const result = buildAutocompleteInsertion(
        {
          name: 'floor_hour',
          source: 'filter',
          description:
            'Truncate a datetime to the start of the hour: ${dt | floor_hour}',
        },
        '} more',
      )
      expect(result.text).toBe('floor_hour')
      expect(result.cursorOffset).toBe('floor_hour'.length)
    })
  })

  describe('robustness', () => {
    it('treats a missing description as no-args', () => {
      const result = buildAutocompleteInsertion(
        { name: 'mystery', source: 'filter' },
        '',
      )
      expect(result.text).toBe('mystery}')
    })

    it('does not confuse a different name appearing with parens in the description', () => {
      // Description mentions `other(` but not `target(` — should treat as no-args.
      const result = buildAutocompleteInsertion(
        {
          name: 'target',
          source: 'filter',
          description: 'See also other(args) for a similar effect.',
        },
        '',
      )
      expect(result.text).toBe('target}')
    })
  })
})
