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
 * Smart-insert payload builder for autocomplete picks.
 *
 * Decides what to drop into the input when the user picks a candidate from
 * `GlyphAutocomplete`, and where to land the cursor afterwards. Lives as a
 * pure function so it can be unit-tested without rendering.
 */

import type { AutocompleteSource } from '@/features/fable-builder/components/shared/GlyphAutocomplete'

export interface AutocompleteInsertion {
  /** Replacement text to splice in for the parser's [replaceStart, replaceEnd) range. */
  text: string
  /** Cursor position after insertion, expressed as an offset from `replaceStart`. */
  cursorOffset: number
}

interface CandidateInfo {
  name: string
  source: AutocompleteSource
  /** Backend description for helpers; used to detect whether the helper takes arguments. */
  description?: string
}

const isHelperSource = (source: AutocompleteSource): boolean =>
  source === 'filter' || source === 'helperGlobal'

/**
 * The backend doesn't ship signatures, but every helper that takes arguments
 * mentions `name(` somewhere in its description (e.g. `${dt | add_days(n)}`).
 * Helpers without arguments (`floor_day`, `floor_hour`) reference themselves
 * without parentheses. This heuristic stays good as long as backend authors
 * keep that convention.
 */
function helperTakesArgs(name: string, description: string): boolean {
  return description.includes(`${name}(`)
}

export function buildAutocompleteInsertion(
  candidate: CandidateInfo,
  textAfterReplaceEnd: string,
): AutocompleteInsertion {
  const isHelperWithArgs =
    isHelperSource(candidate.source) &&
    helperTakesArgs(candidate.name, candidate.description ?? '')

  if (isHelperWithArgs) {
    // Insert `name()` and drop the cursor between the parens so the user can
    // start typing arguments straight away. Don't auto-close `}` here — they
    // still need to finish the call.
    return {
      text: `${candidate.name}()`,
      cursorOffset: candidate.name.length + 1,
    }
  }

  // Variable, or a parameterless helper. Replace with the bare name and add
  // a closing `}` only if the surrounding substitution wasn't already closed.
  // Cursor always lands right after the name (i.e. *before* the `}`) so the
  // user can keep typing `| filter` to chain filters; pressing Right-arrow
  // skips past the brace when they're done.
  const needsClosingBrace = !textAfterReplaceEnd.includes('}')
  return {
    text: candidate.name + (needsClosingBrace ? '}' : ''),
    cursorOffset: candidate.name.length,
  }
}
