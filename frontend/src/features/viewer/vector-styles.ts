/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Vector style values shared by the flat maps and the globe. */

/** A text label in a padded box. */
export interface LabelStyle {
  font: string
  color: string
  background: string
  /** Box outline; null = none. */
  border: string | null
  /** CSS px: top, right, bottom, left. */
  padding: readonly [number, number, number, number]
}

export const OVERLAY_COLORS = {
  stroke: 'rgba(22, 163, 74, 0.95)',
  fill: 'rgba(22, 163, 74, 0.08)',
  point: 'rgba(22, 163, 74, 0.9)',
} as const
export const OVERLAY_STROKE_WIDTH = 2
export const OVERLAY_POINT_RADIUS = 5
export const OVERLAY_POINT_STROKE_WIDTH = 1.5

export const OVERLAY_LABEL = {
  font: '11px system-ui, sans-serif',
  color: 'rgba(15, 23, 42, 0.95)',
  background: 'rgba(255, 255, 255, 0.85)',
  border: null,
  padding: [2, 4, 1, 4],
} as const satisfies LabelStyle

export const MEASURE_COLORS = {
  stroke: 'rgba(15, 23, 42, 0.9)',
  fill: 'rgba(30, 41, 59, 0.12)',
} as const
export const MEASURE_STROKE_WIDTH = 2
export const MEASURE_DASH = [6, 6] as const

/** Measurement results and pin notes. */
export const CALLOUT_LABEL = {
  font: '12px system-ui, sans-serif',
  color: 'rgba(15, 23, 42, 0.95)',
  background: 'rgba(255, 255, 255, 0.92)',
  border: 'rgba(0, 0, 0, 0.15)',
  padding: [3, 5, 2, 5],
} as const satisfies LabelStyle

/** Overlay and measurement labels sit this far above their anchor (px). */
export const LABEL_OFFSET_Y = -12

export const PIN_BADGE_FONT = 'bold 11px system-ui, sans-serif'
/** Gap between a pin's disc and its note (px). */
export const PIN_LABEL_GAP = 4
/** On-map note length; the sidebar shows the full text. */
const PIN_LABEL_MAX_CHARS = 36

/** Disc radius, grown for longer badges. */
export function pinRadius(badge: string, highlighted: boolean): number {
  return (highlighted ? 13 : 10) + Math.max(0, badge.length - 2) * 3.5
}

export function pinStrokeWidth(highlighted: boolean): number {
  return highlighted ? 3 : 2
}

export function pinLabelText(text: string): string {
  return text.length > PIN_LABEL_MAX_CHARS
    ? `${text.slice(0, PIN_LABEL_MAX_CHARS)}…`
    : text
}
