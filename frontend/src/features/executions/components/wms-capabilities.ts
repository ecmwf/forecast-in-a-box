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
 * WMS GetCapabilities helpers used by WmsViewer.
 *
 * Parses the WMS 1.3.0 capabilities XML produced by SkinnyWMS into a flat
 * list of leaf layers, extracts the geographic bounding box for auto-fit,
 * and detects FeatureInfo support. Two helpers handle URL rebasing
 * (capabilities embed the lens server's bind address, which we redirect
 * through our known base URL) and ISO 8601 time-interval expansion.
 */

export interface ParsedStyle {
  name: string
  legendUrl?: string
}

export interface ParsedTime {
  /** Raw `<Dimension name="time">` content as advertised. */
  raw: string
}

export interface ParsedLayer {
  name: string
  title: string
  styles: Array<ParsedStyle>
  time?: ParsedTime
}

export interface ParsedCapabilities {
  layers: Array<ParsedLayer>
  /** [minLon, minLat, maxLon, maxLat] in WGS84 (EPSG:4326). */
  bbox: [number, number, number, number]
  supportsGetFeatureInfo: boolean
}

const DEFAULT_BBOX: [number, number, number, number] = [-180, -90, 180, 90]
const XLINK_NS = 'http://www.w3.org/1999/xlink'

/**
 * SkinnyWMS exposes a handful of built-in decoration layers (Magics
 * coastlines / political boundaries / ocean shading / etc.) alongside the
 * actual data parameters. They aren't useful in a forecast inspection
 * context — they just clutter the parameter grid — so we drop them at
 * parse time. Match is case-insensitive on either the layer name or a
 * normalised form of the title (whitespace → underscore).
 */
const DECORATION_LAYER_KEYS = new Set([
  'background',
  'foreground',
  'boundaries',
  'coastlines',
  'continents',
  'countries',
  'graticule',
  'land',
  'lakes',
  'oceans',
  'rivers',
  'us_states',
  'us-states',
])

function isDecorationLayer(layer: ParsedLayer): boolean {
  const nameKey = layer.name.toLowerCase()
  if (DECORATION_LAYER_KEYS.has(nameKey)) return true
  const titleKey = layer.title.toLowerCase().trim().replace(/\s+/g, '_')
  return DECORATION_LAYER_KEYS.has(titleKey)
}

/**
 * Parse a WMS 1.3.0 capabilities XML document. Recursively descends
 * nested `<Layer>` elements and emits only leaves (those with a `<Name>`).
 * The root layer's `EX_GeographicBoundingBox` provides the global bbox;
 * if absent, falls back to the world.
 */
export function parseCapabilities(xml: string): ParsedCapabilities {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('GetCapabilities XML parse failed')
  }

  const supportsGetFeatureInfo = !!doc.querySelector(
    'Capability > Request > GetFeatureInfo',
  )

  const root = doc.querySelector('Capability > Layer')
  const bbox = parseBbox(root) ?? DEFAULT_BBOX

  const collected: Array<ParsedLayer> = []
  if (root) collectLeafLayers(root, collected)
  const layers = collected.filter((l) => !isDecorationLayer(l))

  return { layers, bbox, supportsGetFeatureInfo }
}

function collectLeafLayers(el: Element, out: Array<ParsedLayer>): void {
  const children = directChildren(el, 'Layer')
  if (children.length === 0) {
    const layer = parseLayer(el)
    if (layer) out.push(layer)
    return
  }
  for (const child of children) collectLeafLayers(child, out)
}

function parseLayer(el: Element): ParsedLayer | null {
  const name = textOf(el, 'Name')
  if (!name) return null
  const title = textOf(el, 'Title') ?? name

  const styles: Array<ParsedStyle> = []
  for (const st of directChildren(el, 'Style')) {
    const styleName = textOf(st, 'Name')
    if (!styleName) continue
    const online = st.querySelector('LegendURL > OnlineResource')
    const legendUrl =
      online?.getAttribute('xlink:href') ??
      online?.getAttributeNS(XLINK_NS, 'href') ??
      undefined
    styles.push({ name: styleName, legendUrl: legendUrl || undefined })
  }

  let time: ParsedTime | undefined
  for (const dim of directChildren(el, 'Dimension')) {
    if (dim.getAttribute('name') === 'time') {
      const raw = dim.textContent.trim()
      if (raw) time = { raw }
      break
    }
  }

  return { name, title, styles, time }
}

function parseBbox(
  el: Element | null,
): [number, number, number, number] | null {
  if (!el) return null
  const ex = el.querySelector('EX_GeographicBoundingBox')
  if (!ex) return null
  const minLon = numOf(ex, 'westBoundLongitude')
  const maxLon = numOf(ex, 'eastBoundLongitude')
  const minLat = numOf(ex, 'southBoundLatitude')
  const maxLat = numOf(ex, 'northBoundLatitude')
  if (
    Number.isNaN(minLon) ||
    Number.isNaN(minLat) ||
    Number.isNaN(maxLon) ||
    Number.isNaN(maxLat)
  ) {
    return null
  }
  return [minLon, minLat, maxLon, maxLat]
}

function directChildren(el: Element, tagName: string): Array<Element> {
  return Array.from(el.children).filter((c) => c.tagName === tagName)
}

function textOf(el: Element, tag: string): string | null {
  const child = Array.from(el.children).find((c) => c.tagName === tag)
  if (!child) return null
  return child.textContent.trim() || null
}

function numOf(el: Element, tag: string): number {
  const t = textOf(el, tag)
  return t === null ? Number.NaN : Number(t)
}

/**
 * Expand a WMS time `Dimension` raw value into discrete ISO timestamps.
 * The WMS spec allows mixing literal values and ISO 8601 interval
 * expressions in a single Dimension element, separated by commas — for
 * example a literal initial time followed by a "<start>/<end>/<period>"
 * range covering the rest of the forecast. So we split on commas first,
 * then expand each segment independently.
 *
 * Malformed or unsupported segments fall back to the raw segment as a
 * single step rather than throwing.
 */
export function expandTimeSteps(raw: string): Array<string> {
  const trimmed = raw.trim()
  if (!trimmed) return []
  return trimmed.split(',').flatMap((s) => expandSingleTimeSegment(s.trim()))
}

function expandSingleTimeSegment(seg: string): Array<string> {
  if (!seg) return []
  if (!seg.includes('/')) return [seg]
  const parts = seg.split('/')
  if (parts.length !== 3) return [seg]
  const [startStr, endStr, periodStr] = parts
  const start = Date.parse(startStr)
  const end = Date.parse(endStr)
  if (Number.isNaN(start) || Number.isNaN(end)) return [seg]
  const periodMs = parseIsoPeriodMs(periodStr)
  if (periodMs === null || periodMs <= 0) return [seg]
  const out: Array<string> = []
  for (let t = start; t <= end; t += periodMs) {
    out.push(new Date(t).toISOString())
    // Safety cap — a malformed forecast period shouldn't OOM the tab.
    if (out.length > 10000) break
  }
  return out
}

const PERIOD_RE =
  /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/

function parseIsoPeriodMs(input: string): number | null {
  const m = PERIOD_RE.exec(input)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  if (!y && !mo && !d && !h && !mi && !s) return null
  // Calendar units approximated as fixed durations — adequate for stepping
  // through a forecast that spans at most weeks or a few months.
  let ms = 0
  if (y) ms += parseFloat(y) * 365.25 * 24 * 3600 * 1000
  if (mo) ms += parseFloat(mo) * 30.4375 * 24 * 3600 * 1000
  if (d) ms += parseFloat(d) * 24 * 3600 * 1000
  if (h) ms += parseFloat(h) * 3600 * 1000
  if (mi) ms += parseFloat(mi) * 60 * 1000
  if (s) ms += parseFloat(s) * 1000
  return ms
}

/**
 * Layer entry within a group. `level` is non-null for pressure-level
 * layers detected via title or name suffix; null otherwise.
 */
export interface LayerLevelEntry {
  level: number | null
  layer: ParsedLayer
}

/**
 * A logical parameter that may have one or more pressure-level variants.
 * Single-instance entries are still surfaced as a one-element group so the
 * UI can render them uniformly.
 */
export interface LayerGroup {
  /** Stable key for React + filtering. */
  key: string
  /** Human-readable parameter title (level suffix stripped). */
  title: string
  /** Raw short code (e.g. `q@pl`) when the title was humanised via lookup;
   * null when the title is already the canonical human form. */
  subtitle: string | null
  /** Detected level unit ("hPa") when grouped; null for single-instance groups. */
  levelUnit: string | null
  /** Layers in the group; sorted descending by level (1000 hPa first). */
  entries: Array<LayerLevelEntry>
}

const TITLE_LEVEL_RE =
  /^(.+?)\s+(?:at\s+)?([0-9]+(?:\.[0-9]+)?)\s*(hPa|mb|millibars?)\s*$/i
const NAME_LEVEL_RE = /^(.+?)_(\d+)$/

/**
 * ECMWF / IFS / AIFS short-name → human-readable mapping. SkinnyWMS often
 * exposes these short codes verbatim as layer names (e.g. `q@pl_500`,
 * `2t`, `msl`), which are unfriendly in a parameter picker. Lookups are
 * tried with the `@<scope>` suffix stripped, then on the raw input, then
 * fall through to the input unchanged.
 *
 * Keep this list focused on what AIFS / IFS forecasts commonly emit; we
 * don't aim for full GRIB code coverage.
 */
const PARAM_NAMES: Record<string, string> = {
  // Pressure-level (3D)
  t: 'Temperature',
  q: 'Specific humidity',
  u: 'U component of wind',
  v: 'V component of wind',
  'u/v': 'Wind (u, v components)',
  w: 'Vertical velocity',
  z: 'Geopotential',
  gh: 'Geopotential height',
  d: 'Divergence',
  vo: 'Relative vorticity',
  r: 'Relative humidity',
  // Surface (2D)
  '2t': '2 m temperature',
  '2d': '2 m dewpoint temperature',
  '10u': '10 m U wind',
  '10v': '10 m V wind',
  '10u/10v': '10 m wind (u, v components)',
  '100u': '100 m U wind',
  '100v': '100 m V wind',
  '100u/100v': '100 m wind (u, v components)',
  skt: 'Skin temperature',
  sp: 'Surface pressure',
  msl: 'Mean sea level pressure',
  tp: 'Total precipitation',
  tcw: 'Total column water',
  tcwv: 'Total column water vapour',
  sst: 'Sea surface temperature',
  sd: 'Snow depth',
  ci: 'Sea-ice cover',
}

interface HumanizedParam {
  title: string
  subtitle: string | null
}

function humanizeParam(short: string): HumanizedParam {
  // Strip a single `@<scope>` suffix (e.g. `@pl`, `@sfc`, `@ml`) before lookup.
  const cleaned = short.toLowerCase().replace(/@\w+$/, '').trim()
  const human = PARAM_NAMES[cleaned] ?? PARAM_NAMES[short.toLowerCase()]
  return human
    ? { title: human, subtitle: short }
    : { title: short, subtitle: null }
}

interface LevelHit {
  base: string
  level: number
  unit: string | null
  source: 'title' | 'name'
}

function detectLevel(layer: ParsedLayer): LevelHit | null {
  const tm = TITLE_LEVEL_RE.exec(layer.title)
  if (tm) {
    return {
      base: tm[1].trim(),
      level: Number(tm[2]),
      unit: 'hPa',
      source: 'title',
    }
  }
  const nm = NAME_LEVEL_RE.exec(layer.name)
  if (nm) {
    return { base: nm[1], level: Number(nm[2]), unit: null, source: 'name' }
  }
  return null
}

/**
 * Group layers by detected parameter (e.g. "Specific humidity at 500 hPa",
 * "… at 700 hPa", "… at 850 hPa" all collapse to one group with three
 * entries). Layers with no detectable level become single-entry groups so
 * the caller can render them uniformly.
 *
 * Group title uses the title-derived base when available (cleaner than
 * the name-derived `q`-style short codes). Entries within a group are
 * sorted descending by level, putting tropospheric / surface levels first
 * — the meteorologically conventional reading order.
 */
export function groupLayers(
  layers: ReadonlyArray<ParsedLayer>,
): Array<LayerGroup> {
  const groups = new Map<string, LayerGroup>()
  for (const layer of layers) {
    const hit = detectLevel(layer)
    if (hit) {
      const key = `param:${hit.base.toLowerCase()}`
      let g = groups.get(key)
      if (!g) {
        // Title-derived bases are already human-readable; only short-code
        // bases (from name regex) need lookup.
        const humanized =
          hit.source === 'name'
            ? humanizeParam(hit.base)
            : { title: hit.base, subtitle: null }
        g = {
          key,
          title: humanized.title,
          subtitle: humanized.subtitle,
          levelUnit: hit.unit,
          entries: [],
        }
        groups.set(key, g)
      }
      g.entries.push({ level: hit.level, layer })
      if (g.levelUnit === null && hit.unit) g.levelUnit = hit.unit
    } else {
      const key = `single:${layer.name}`
      groups.set(key, {
        key,
        title: layer.title,
        subtitle: null, // single-instance rows already render the layer name as their own subtitle
        levelUnit: null,
        entries: [{ level: null, layer }],
      })
    }
  }
  for (const g of groups.values()) {
    g.entries.sort((a, b) => {
      if (a.level === null && b.level === null) return 0
      if (a.level === null) return 1
      if (b.level === null) return -1
      return b.level - a.level
    })
  }
  return Array.from(groups.values())
}

/**
 * Split groups into single-level (surface / single-instance) and multi-level
 * (pressure-level) buckets, each sorted alphabetically by title. The two
 * lists are mutually exclusive and cover all input groups.
 */
export interface PartitionedGroups {
  singles: Array<LayerGroup>
  multiLevel: Array<LayerGroup>
}

export function partitionGroups(
  groups: ReadonlyArray<LayerGroup>,
): PartitionedGroups {
  const singles: Array<LayerGroup> = []
  const multiLevel: Array<LayerGroup> = []
  for (const g of groups) {
    const isMulti =
      g.entries.length > 1 && g.entries.some((e) => e.level !== null)
    ;(isMulti ? multiLevel : singles).push(g)
  }
  const byTitle = (a: LayerGroup, b: LayerGroup): number =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  singles.sort(byTitle)
  multiLevel.sort(byTitle)
  return { singles, multiLevel }
}

/**
 * Collect the union of pressure levels across all groups, sorted descending.
 */
export function uniquePressureLevels(
  groups: ReadonlyArray<LayerGroup>,
): Array<number> {
  const set = new Set<number>()
  for (const g of groups) {
    for (const e of g.entries) {
      if (e.level !== null) set.add(e.level)
    }
  }
  return Array.from(set).sort((a, b) => b - a)
}

/**
 * Rewrite a URL emitted by the lens (which embeds its bind address, e.g.
 * `http://0.0.0.0:54321/...`) so it points at `baseUrl` (the address the
 * frontend actually reaches, e.g. `http://127.0.0.1:54321/...`). Path and
 * query are preserved. Returns the input unchanged on parse failure.
 */
export function rebaseLensUrl(url: string, baseUrl: string): string {
  try {
    const u = new URL(url)
    const b = new URL(baseUrl)
    u.protocol = b.protocol
    u.hostname = b.hostname
    u.port = b.port
    return u.toString()
  } catch {
    return url
  }
}
