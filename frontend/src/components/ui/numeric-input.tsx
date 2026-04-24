/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import * as React from 'react'
import { Input } from './input'

/**
 * Build the regex + inputMode for a numeric text input.
 *
 * Returned `accepts(raw)` rejects any string that doesn't parse as a partial
 * numeric entry — use it to guard onChange so the controlled value never gets
 * a stray letter. Transitional states (`""`, bare `-`, trailing `.`) are
 * accepted so the user can type progressively.
 */
export function createNumericFilter({
  allowDecimal = false,
  allowNegative = false,
}: { allowDecimal?: boolean; allowNegative?: boolean } = {}): {
  inputMode: 'numeric' | 'decimal'
  accepts: (raw: string) => boolean
} {
  const sign = allowNegative ? '-?' : ''
  const pattern = allowDecimal
    ? new RegExp(`^${sign}\\d*\\.?\\d*$`)
    : new RegExp(`^${sign}\\d*$`)
  return {
    inputMode: allowDecimal ? 'decimal' : 'numeric',
    accepts: (raw: string) => raw === '' || pattern.test(raw),
  }
}

export interface NumericInputProps extends Omit<
  React.ComponentProps<typeof Input>,
  'type' | 'inputMode'
> {
  /** Allow a decimal point. Default: false (integer only). */
  allowDecimal?: boolean
  /** Allow a leading minus sign. Default: false. */
  allowNegative?: boolean
}

/**
 * NumericInput — `Input` variant rendered as `type="text"` with `inputMode`
 * set to `numeric`/`decimal` and keystrokes filtered to digits (plus the
 * sign / decimal point if enabled). Use instead of `type="number"` when the
 * native up/down spinners or arrow-key increment hijack feels clunky.
 *
 * The consumer's `onChange` receives the standard React synthetic event and
 * is only fired when the resulting value parses as a valid partial number —
 * disallowed keystrokes are dropped silently and the controlled value stays
 * put.
 */
export function NumericInput({
  onChange,
  allowDecimal = false,
  allowNegative = false,
  ...props
}: NumericInputProps) {
  const { inputMode, accepts } = React.useMemo(
    () => createNumericFilter({ allowDecimal, allowNegative }),
    [allowDecimal, allowNegative],
  )

  return (
    <Input
      {...props}
      type="text"
      inputMode={inputMode}
      onChange={(e) => {
        if (accepts(e.target.value)) {
          onChange?.(e)
        }
      }}
    />
  )
}
