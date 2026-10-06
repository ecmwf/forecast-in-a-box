/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Parts of a backend param display string, "2 metre temperature [K] (2t)". */
export interface ParamDisplay {
  name: string
  units?: string
  short?: string
}

const DISPLAY_PATTERN = /^(.*?) \[(.*)\] \(([^()]+)\)$/

export function parseParamDisplay(display: string): ParamDisplay {
  const match = DISPLAY_PATTERN.exec(display)
  return match
    ? { name: match[1], units: match[2], short: match[3] }
    : { name: display }
}

const SUPERSCRIPT: Record<string, string> = {
  '-': '\u207B',
  '0': '\u2070',
  '1': '\u00B9',
  '2': '\u00B2',
  '3': '\u00B3',
  '4': '\u2074',
  '5': '\u2075',
  '6': '\u2076',
  '7': '\u2077',
  '8': '\u2078',
  '9': '\u2079',
}

/** ecCodes units with superscript exponents: "m s**-1" reads as m s^-1. */
export function formatUnits(units: string): string {
  return units.replace(/\*\*(-?\d+)/g, (_, exponent: string) =>
    [...exponent].map((c) => SUPERSCRIPT[c]).join(''),
  )
}

/** The backend display string with readable units. */
export function formatParamDisplay(display: string): string {
  const { name, units, short } = parseParamDisplay(display)
  return short === undefined
    ? display
    : `${name} [${formatUnits(units ?? '')}] (${short})`
}

export type ParamLabelVariant = 'compact' | 'full'

/** Shortname (`compact`) or full label; the raw id when unresolved. */
export function paramLabel(
  id: string,
  labels: ReadonlyMap<string, string>,
  variant: ParamLabelVariant,
): string {
  const display = labels.get(id)
  if (display === undefined) return id
  return variant === 'compact'
    ? (parseParamDisplay(display).short ?? display)
    : formatParamDisplay(display)
}

/** Labels each list item: "167,151" → "2t, msl". */
export function paramListLabel(
  value: string,
  labels: ReadonlyMap<string, string>,
  variant: ParamLabelVariant,
): string {
  return listItems(value)
    .map((item) => paramLabel(item, labels, variant))
    .join(', ')
}

/** Items of a comma-separated list value ("167, 151" → ["167", "151"]). */
export function listItems(value: string): Array<string> {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
