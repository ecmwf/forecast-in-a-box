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
 * Viewer projection ids — the URL vocabulary (`p=`). OpenLayers-free so
 * the route and URL-state modules stay out of the map chunk.
 */

/** OpenLayers projections, in toolbar order. */
export const FLAT_PROJECTION_IDS = [
  'merc',
  'geo',
  'npole',
  'spole',
  'laea',
] as const

/** Not an OL projection: the 3D globe display mode. */
export const GLOBE_PROJECTION_ID = 'globe'

/** Toolbar order. */
export const PROJECTION_IDS = [
  ...FLAT_PROJECTION_IDS,
  GLOBE_PROJECTION_ID,
] as const

export type ProjectionId = (typeof PROJECTION_IDS)[number]
export type FlatProjectionId = (typeof FLAT_PROJECTION_IDS)[number]

export const DEFAULT_PROJECTION_ID: FlatProjectionId = 'merc'

export function isProjectionId(value: unknown): value is ProjectionId {
  return (
    typeof value === 'string' &&
    (PROJECTION_IDS as ReadonlyArray<string>).includes(value)
  )
}

export function isFlatProjectionId(value: unknown): value is FlatProjectionId {
  return (
    typeof value === 'string' &&
    (FLAT_PROJECTION_IDS as ReadonlyArray<string>).includes(value)
  )
}
