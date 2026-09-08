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
 * Map projections the viewer can display: registry, proj4 registration,
 * and the camera math a projection switch needs. Every GetMap follows the
 * View's projection (OL sets CRS/BBOX), so a switch is a View rebuild.
 *
 * Extents are our own: SkinnyWMS advertises unusable polar BoundingBoxes.
 */

import proj4 from 'proj4'
import { register } from 'ol/proj/proj4'
import {
  addProjection,
  fromLonLat,
  getPointResolution,
  transform,
  transformExtent,
} from 'ol/proj'
import Projection from 'ol/proj/Projection'
import {
  containsCoordinate,
  containsExtent,
  getCenter,
  getIntersection,
} from 'ol/extent'
import { isWorldBbox } from './wms-capabilities'
import { DEFAULT_PROJECTION_ID, PROJECTION_IDS } from './projection-ids'
import type { Extent } from 'ol/extent'
import type View from 'ol/View'
import type { ProjectionId } from './projection-ids'
import type { Bbox } from './wms-capabilities'
import type { PolarGraticule } from '@/lib/map/ol-outline'

export type { ProjectionId }

export interface ViewerProjection {
  id: ProjectionId
  /** WMS CRS code (also the OL projection code). */
  code: string
  /** `visualise`-namespace label key. */
  labelKey: `projections.${ProjectionId}`
  /** proj4 definition; absent for OL built-ins. */
  proj4?: string
  /** Navigable extent (View constraint), projection units. */
  extent: Extent
  /** Geographic coverage [W, S, E, N] — graticule + bbox-fit guard. */
  worldExtent: Extent
  /** "Fit to globe" target, projection units. */
  homeExtent: Extent
  /** View zoom floor. */
  minZoom: number
  /** Web-Mercator tile basemaps are usable. */
  mercator: boolean
  /** Show projected metres in the cursor readout (a working grid). */
  gridReadout: boolean
  polar?: 'north' | 'south'
}

// Web Mercator world (asymptotes at ±85.0511°); pans stay within it.
export const WEB_MERCATOR_EXTENT: Extent = [
  ...fromLonLat([-180, -85.0511]),
  ...fromLonLat([180, 85.0511]),
]

// Initial fit: full longitude, north-biased so Scandinavia gets room.
export const INITIAL_VIEW_BBOX_WGS84: Extent = [-180, -55, 180, 85]

// UPS: pole at (2e6, 2e6); ±9e6 m reaches ~19° on the axes, ±6.5e6 ~35°.
const UPS_EXTENT: Extent = [-7e6, -7e6, 11e6, 11e6]
const UPS_HOME: Extent = [-4.5e6, -4.5e6, 8.5e6, 8.5e6]
const upsDef = (south: boolean) =>
  `+proj=stere +lat_0=${south ? -90 : 90} +lat_ts=${south ? -90 : 90} ` +
  '+lon_0=0 +k=0.994 +x_0=2000000 +y_0=2000000 +datum=WGS84 +units=m +no_defs'

export const PROJECTIONS: ReadonlyArray<ViewerProjection> = [
  {
    id: 'merc',
    code: 'EPSG:3857',
    labelKey: 'projections.merc',
    extent: WEB_MERCATOR_EXTENT,
    worldExtent: [-180, -85.0511, 180, 85.0511],
    homeExtent: transformExtent(
      INITIAL_VIEW_BBOX_WGS84,
      'EPSG:4326',
      'EPSG:3857',
    ),
    // Vector basemap paints nothing below z1; sub-z1 can break the extent.
    minZoom: 1,
    mercator: true,
    gridReadout: false,
  },
  {
    id: 'geo',
    code: 'EPSG:4326',
    labelKey: 'projections.geo',
    extent: [-180, -90, 180, 90],
    worldExtent: [-180, -90, 180, 90],
    homeExtent: [-180, -90, 180, 90],
    minZoom: 0,
    mercator: false,
    gridReadout: false,
  },
  {
    id: 'npole',
    code: 'EPSG:32661',
    labelKey: 'projections.npole',
    proj4: upsDef(false),
    extent: UPS_EXTENT,
    worldExtent: [-180, 19, 180, 90],
    homeExtent: UPS_HOME,
    minZoom: 0,
    mercator: false,
    gridReadout: true,
    polar: 'north',
  },
  {
    id: 'spole',
    code: 'EPSG:32761',
    labelKey: 'projections.spole',
    proj4: upsDef(true),
    extent: UPS_EXTENT,
    worldExtent: [-180, -90, 180, -19],
    homeExtent: UPS_HOME,
    minZoom: 0,
    mercator: false,
    gridReadout: true,
    polar: 'south',
  },
  {
    id: 'laea',
    code: 'EPSG:3035',
    labelKey: 'projections.laea',
    proj4:
      '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 ' +
      '+ellps=GRS80 +units=m +no_defs',
    // Navigable: Europe [-40, 20, 50, 85]; home [-25, 34, 45, 72] (metres).
    // worldExtent far wider: OL's Graticule labels its edges — keep them off-screen.
    extent: [-746657, -295914, 8483505, 7021792],
    worldExtent: [-90, -10, 100, 90],
    homeExtent: [1172449, 1218180, 7469551, 5735170],
    minZoom: 0,
    mercator: false,
    gridReadout: true,
  },
]

const BY_ID = new Map(PROJECTIONS.map((p) => [p.id, p]))

export function getViewerProjection(
  id?: ProjectionId | null,
): ViewerProjection {
  return BY_ID.get(id ?? DEFAULT_PROJECTION_ID) ?? BY_ID.get('merc')!
}

/** Toolbar order, as ids. */
export const PROJECTION_ORDER: ReadonlyArray<ProjectionId> = PROJECTION_IDS

/** Polar graticule geometry for the Outline basemap; undefined elsewhere. */
export function polarGraticuleFor(
  p: ViewerProjection,
): PolarGraticule | undefined {
  if (!p.polar) return undefined
  return {
    pole: p.polar,
    edgeLatitude: p.polar === 'north' ? p.worldExtent[1] : p.worldExtent[3],
  }
}

/** The registry entry a View displays (Mercator for unknown codes). */
export function viewerProjectionOf(view: View): ViewerProjection {
  const code = view.getProjection().getCode()
  return PROJECTIONS.find((p) => p.code === code) ?? getViewerProjection('merc')
}

let registered = false

/** Register the proj4 codes with OL, northing-first like EPSG (idempotent). */
export function registerViewerProjections(): void {
  if (registered) return
  registered = true
  for (const p of PROJECTIONS) {
    if (!p.proj4) continue
    proj4.defs(p.code, p.proj4)
    addProjection(
      new Projection({
        code: p.code,
        units: 'm',
        axisOrientation: 'neu',
        extent: p.extent,
        worldExtent: p.worldExtent,
      }),
    )
  }
  // Existing codes are kept; this only wires the pairwise transforms.
  register(proj4)
}

/** WMS 1.3.0 BBOX order a server reads: EPSG axis, or always x,y (Magics). */
export type BboxAxisOrder = 'epsg' | 'xy'

const xyTwins = new Map<string, Projection>()

/** Easting-first twin for 'xy' servers (same code → no reprojection). */
export function requestProjection(
  view: View,
  order: BboxAxisOrder,
): Projection | undefined {
  const viewProj = view.getProjection()
  if (order !== 'xy' || !viewProj.getAxisOrientation().startsWith('ne')) {
    return undefined
  }
  // Built-in EPSG:4326 stays lat-first: every server swaps that one.
  if (viewProj.getCode() === 'EPSG:4326') return undefined
  const code = viewProj.getCode()
  let twin = xyTwins.get(code)
  if (!twin) {
    twin = new Projection({
      code,
      units: viewProj.getUnits(),
      axisOrientation: 'enu',
      extent: viewProj.getExtent(),
      worldExtent: viewProj.getWorldExtent(),
    })
    xyTwins.set(code, twin)
  }
  return twin
}

/** Metres per pixel at the view centre (scale hints, band checks). */
export function groundResolution(view: View): number | null {
  const center = view.getCenter()
  const res = view.getResolution()
  if (!center || res === undefined) return null
  const metres = getPointResolution(view.getProjection(), res, center, 'm')
  return Number.isFinite(metres) && metres > 0 ? metres : null
}

/** View resolution that renders `metresPerPx` at the view centre. */
export function viewResolutionFor(view: View, metresPerPx: number): number {
  const center = view.getCenter() ?? getCenter(view.getProjection().getExtent())
  const perUnit = getPointResolution(view.getProjection(), 1, center, 'm')
  return Number.isFinite(perUnit) && perUnit > 0
    ? metresPerPx / perUnit
    : metresPerPx
}

/** Metre band → this projection's resolution units (degrees for 4326). */
export function bandResolution(view: View, metres: number): number {
  if (!Number.isFinite(metres)) return metres
  return metres / (view.getProjection().getMetersPerUnit() ?? 1)
}

/** Same centre (home centre when outside) at the same ground scale. */
export function carryCamera(
  from: View,
  to: View,
  target: ViewerProjection,
): void {
  const center = from.getCenter()
  const res = from.getResolution()
  if (!center || res === undefined) return
  const pFrom = from.getProjection()
  const pTo = to.getProjection()
  let next = transform(center, pFrom, pTo)
  if (
    !next.every(Number.isFinite) ||
    !containsCoordinate(target.extent, next)
  ) {
    next = getCenter(target.homeExtent)
  }
  const groundMpp = getPointResolution(pFrom, res, center, 'm')
  const perUnit = getPointResolution(pTo, 1, next, 'm')
  const wanted =
    Number.isFinite(groundMpp) && Number.isFinite(perUnit) && perUnit > 0
      ? groundMpp / perUnit
      : to.getMaxResolution()
  // Resolution first — the centre constraint depends on it.
  to.setResolution(
    Math.min(Math.max(wanted, to.getMinResolution()), to.getMaxResolution()),
  )
  to.setCenter(next)
}

/** WGS84 bbox as a view extent; null when the projection cannot frame it. */
export function bboxExtentFor(p: ViewerProjection, bbox: Bbox): Extent | null {
  if (p.mercator || p.id === 'geo') {
    return transformExtent(bbox, 'EPSG:4326', p.code)
  }
  if (isWorldBbox(bbox) || !containsExtent(p.worldExtent, bbox)) return null
  const extent = transformExtent(bbox, 'EPSG:4326', p.code, 8)
  return extent.every(Number.isFinite) && containsExtent(p.extent, extent)
    ? extent
    : null
}

/** Fit target for a WGS84 bbox; polar/LAEA reject pole-crossing or global. */
export function homeExtentFor(p: ViewerProjection, bbox: Bbox | null): Extent {
  return (bbox && bboxExtentFor(p, bbox)) ?? p.homeExtent
}

/** Clip extent for a layer: the projection's world, narrowed to its bbox. */
export function layerExtentFor(p: ViewerProjection, bbox?: Bbox): Extent {
  // Dateline-crossing boxes (west > east) are left unclipped.
  if (!bbox || isWorldBbox(bbox) || bbox[0] > bbox[2]) return p.extent
  const extent = bboxExtentFor(p, bbox)
  return extent ? getIntersection(extent, p.extent) : p.extent
}
