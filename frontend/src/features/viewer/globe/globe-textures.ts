/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Globe layer images: what loads, what shows, the GPU budget and the failure policy. */

import {
  bytesOf,
  firstScale,
  imageLimits,
  layerRegion,
  planViewImage,
  refetchScale,
  regionGetMapUrl,
  regionSize,
  requestParts,
  worldScale,
  worldUpgrade,
} from './globe-plan'
import type { Region, ViewState } from './globe-plan'
import type { GlobeEngineEvents, GlobeLayerSpec } from './engine'
import { createLogger } from '@/lib/logger'

const log = createLogger('globe')

const UPGRADE_IDLE_MS = 300
/** After a failed sharper image, wait this long before the next, doubling up to the cap. */
const RETRY_MS = 5000
const RETRY_MAX_MS = 5 * 60_000

export type Vec4 = [number, number, number, number]

/** An image the renderer draws: a decoded bitmap until uploaded, then a texture, in a unit equirect box. */
export interface ShownImage {
  pending: ImageBitmap | null
  texture: WebGLTexture | null
  box: Vec4
}

interface Backoff {
  /** performance.now() before which no sharper image is asked for. */
  until: number
  failures: number
}

function backOff(b: Backoff) {
  b.failures++
  b.until =
    performance.now() + Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (b.failures - 1))
}

function recover(b: Backoff) {
  b.failures = 0
  b.until = 0
}

const retryDue = (b: Backoff) => performance.now() >= b.until

/** Ledger share of one image: resident (pending or uploaded) and in flight. */
interface Slot {
  bytes: number
  reserved: number
}

interface Tile extends Slot, ShownImage {
  region: Region
  /** px/degree of the shown texture (0 = none yet). */
  scale: number
  /** Params the shown texture was fetched with ('' = none). */
  shownKey: string
  controller: AbortController | null
}

interface LayerEntry extends Slot, ShownImage {
  spec: GlobeLayerSpec
  paramsKey: string
  /** px/degree of the shown texture (0 = none yet). */
  scale: number
  /** Params the shown texture was fetched with ('' = none). */
  shownKey: string
  controller: AbortController | null
  /** Screen-resolution image of the visible area, once the world image is too coarse. */
  detail: Tile | null
  /** Sharper world images and view images each back off after a failure. */
  upgradeBackoff: Backoff
  detailBackoff: Backoff
  errored: boolean
  /** Settled at least once (whenLoaded). */
  settled: boolean
  /** Changed while not live: fetch on the next wake. */
  stale: boolean
}

const NO_HOLE: Vec4 = [0, 0, 0, 0]

/** GPU bytes every globe panel on the page may hold in layer textures; touch devices get less. */
export const textureLedger = {
  budget: (navigator.maxTouchPoints > 1 ? 96 : 256) * 2 ** 20,
  bytes: 0,
}

/** What drawing reads from a spec besides its image. */
const drawKey = (spec: GlobeLayerSpec) =>
  `${spec.opacity}|${spec.zIndex}|${spec.scale?.minRes}|${spec.scale?.maxRes}`

function boxOf([w, s, e, n]: Region): Vec4 {
  return [(w + 180) / 360, (90 - n) / 180, (e - w) / 360, (n - s) / 180]
}

/** West and east halves side by side: one texture for a region across the antimeridian. */
function join([west, east]: ReadonlyArray<ImageBitmap>): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(west.width + east.width, west.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(west, 0, 0)
  ctx.drawImage(east, west.width, 0)
  west.close()
  east.close()
  return createImageBitmap(canvas, {
    premultiplyAlpha: 'premultiply',
    colorSpaceConversion: 'none',
  })
}

function fetchBitmap(
  spec: GlobeLayerSpec,
  region: Region,
  size: readonly [number, number],
  signal: AbortSignal,
): Promise<ImageBitmap> {
  const url = regionGetMapUrl(spec, region, size)
  return fetch(url, { signal })
    .then((r) => {
      if (!r.ok) throw new Error(`GetMap ${r.status}`)
      return r.blob()
    })
    .then((blob) =>
      createImageBitmap(blob, {
        premultiplyAlpha: 'premultiply',
        colorSpaceConversion: 'none',
      }),
    )
}

/** `region` as one bitmap; past 180 deg two halves, joined. */
async function fetchRegion(
  spec: GlobeLayerSpec,
  region: Region,
  scale: number,
  signal: AbortSignal,
): Promise<{ bitmap: ImageBitmap; region: Region }> {
  const plan = requestParts(region, scale)
  const results = await Promise.allSettled(
    plan.parts.map((part) => fetchBitmap(spec, part.region, part.size, signal)),
  )
  const bitmaps = results.flatMap((r) =>
    r.status === 'fulfilled' ? [r.value] : [],
  )
  const failed = results.find((r) => r.status === 'rejected')
  if (failed) {
    for (const b of bitmaps) b.close()
    throw failed.reason
  }
  return {
    bitmap: bitmaps.length === 1 ? bitmaps[0] : await join(bitmaps),
    region: plan.region,
  }
}

export interface TextureStore {
  setLayers: (specs: ReadonlyArray<GlobeLayerSpec>) => void
  /** The server's own basemap images: z below the data (background) or above (reference). */
  setDecoration: (specs: ReadonlyArray<GlobeLayerSpec>) => void
  /** Not live: data layers keep their specs but fetch nothing (a hidden, warm globe). */
  setLive: (live: boolean) => void
  whenLoaded: () => Promise<void>
  /** Refetch sharper textures once the camera rests. */
  scheduleUpgrade: () => void
  /** Upgrade at once: entering, where the camera is already final. */
  upgradeNow: () => void
  /** Layers bottom to top with the images to draw; one instant per frame. */
  eachLayer: (
    draw: (
      spec: GlobeLayerSpec,
      world: ShownImage | null,
      view: ShownImage | null,
    ) => void,
  ) => void
  /** A new context: the uploaded textures died with the old one. */
  forgetTextures: () => void
  /** After a context loss: every image is fetched again. */
  reload: () => void
  dispose: () => void
}

export function createTextureStore({
  events,
  invalidate,
  view,
  gpuMax,
  deleteTexture,
}: {
  events: GlobeEngineEvents
  invalidate: () => void
  /** Current camera and viewport (texture detail). */
  view: () => ViewState
  /** The context's texture size limit, once known. */
  gpuMax: () => number | undefined
  deleteTexture: (texture: WebGLTexture) => void
}): TextureStore {
  const zoom = () => view().zoom
  const layers = new Map<string, LayerEntry>()
  const deco = new Map<string, LayerEntry>()
  const allEntries = () => [...layers.values(), ...deco.values()]
  // Draw order by z, rebuilt only when the stacks change.
  let drawOrder: Array<LayerEntry> = []
  const reorder = () => {
    drawOrder = allEntries().sort((a, b) => a.spec.zIndex - b.spec.zIndex)
  }
  const loadWaiters: Array<() => void> = []
  let inFlight = 0
  let upgradeTimer = 0
  let disposed = false
  let live = true

  const limits = (spec: GlobeLayerSpec) => imageLimits(spec, gpuMax())
  const first = (spec: GlobeLayerSpec) => firstScale(spec, zoom(), limits(spec))
  /** Budget left for `slot`'s image once its own is released. */
  const free = (slot: Slot) =>
    textureLedger.budget - textureLedger.bytes + slot.bytes + slot.reserved

  function checkLoaded() {
    // Loaded = every first image settled and no sharp view image still coming.
    if (allEntries().every((e) => e.settled && !e.detail?.controller)) {
      for (const resolve of loadWaiters.splice(0)) resolve()
    }
  }

  function setInFlight(delta: number) {
    inFlight += delta
    events.onLoadingChange(inFlight)
  }

  function holdBytes(slot: Slot, n: number) {
    textureLedger.bytes += n - slot.reserved
    slot.reserved = n
  }

  /** The reserved image is now the resident one. */
  function commitBytes(slot: Slot) {
    slot.bytes = slot.reserved
    slot.reserved = 0
  }

  function dropTile(tile: Tile) {
    if (tile.texture) deleteTexture(tile.texture)
    tile.texture = null
    tile.pending?.close()
    tile.pending = null
    tile.shownKey = ''
    textureLedger.bytes -= tile.bytes
    tile.bytes = 0
  }

  function dropDetail(entry: LayerEntry) {
    if (!entry.detail) return
    entry.detail.controller?.abort()
    dropTile(entry.detail)
    entry.detail = null
  }

  /** Call off an in-flight view image, keeping the shown one. */
  function abortDetail(entry: LayerEntry) {
    const d = entry.detail
    if (!d?.controller) return
    d.controller.abort()
    d.controller = null
    holdBytes(d, 0)
  }

  function dropTexture(entry: LayerEntry) {
    if (entry.texture) deleteTexture(entry.texture)
    entry.texture = null
    entry.pending?.close()
    entry.pending = null
    entry.shownKey = ''
    textureLedger.bytes -= entry.bytes
    entry.bytes = 0
  }

  /** A screen-resolution image of `region` over the coarser world image. */
  function loadDetail(entry: LayerEntry, region: Region, scale: number) {
    entry.detail?.controller?.abort()
    const controller = new AbortController()
    const key = entry.paramsKey
    const tile: Tile = entry.detail ?? {
      pending: null,
      texture: null,
      box: NO_HOLE,
      region,
      scale: 0,
      shownKey: '',
      controller: null,
      bytes: 0,
      reserved: 0,
    }
    tile.controller = controller
    entry.detail = tile
    holdBytes(tile, bytesOf(regionSize(region, scale)))
    setInFlight(1)
    fetchRegion(entry.spec, region, scale, controller.signal)
      .then(({ bitmap, region: shown }) => {
        if (controller.signal.aborted || disposed) {
          bitmap.close()
          return
        }
        dropTile(tile)
        commitBytes(tile)
        tile.pending = bitmap
        tile.box = boxOf(shown)
        tile.region = shown
        tile.scale = scale
        tile.shownKey = key
        recover(entry.detailBackoff)
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || disposed) return
        log.warn(`Globe detail GetMap failed for ${entry.spec.layerName}`, err)
        backOff(entry.detailBackoff)
      })
      .finally(() => {
        if (tile.controller === controller) {
          tile.controller = null
          holdBytes(tile, 0)
        }
        setInFlight(-1)
        checkLoaded()
        if (!disposed) invalidate()
      })
  }

  function load(entry: LayerEntry, wanted: number) {
    entry.controller?.abort()
    const controller = new AbortController()
    entry.controller = controller
    const { key, time } = entry.spec
    const paramsKey = entry.paramsKey
    // A sharper copy of the shown instant: failing it keeps what is shown.
    const sharper = entry.shownKey === paramsKey
    const region = layerRegion(entry.spec)
    const scale = worldScale(
      entry.spec,
      wanted,
      zoom(),
      limits(entry.spec),
      free(entry),
    )
    holdBytes(entry, bytesOf(regionSize(region, scale)))
    setInFlight(1)
    fetchBitmap(
      entry.spec,
      region,
      regionSize(region, scale),
      controller.signal,
    )
      .then((bitmap) => {
        if (controller.signal.aborted || disposed) {
          bitmap.close()
          return
        }
        dropTexture(entry)
        commitBytes(entry)
        entry.pending = bitmap
        entry.shownKey = paramsKey
        entry.box = boxOf(region)
        entry.scale = scale
        entry.errored = false
        if (sharper) recover(entry.upgradeBackoff)
        events.onLayerLoad(key, time, true)
        scheduleUpgrade()
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || disposed) return
        if (sharper) {
          log.warn(
            `Globe sharper GetMap failed for ${entry.spec.layerName}, keeping the shown image`,
            err,
          )
          backOff(entry.upgradeBackoff)
          return
        }
        log.warn(`Globe GetMap failed for ${entry.spec.layerName}`, err)
        // A stale image must never pose as the requested instant.
        entry.errored = true
        dropTexture(entry)
        events.onLayerLoad(key, time, false)
      })
      .finally(() => {
        if (entry.controller === controller) {
          entry.controller = null
          holdBytes(entry, 0)
        }
        setInFlight(-1)
        if (!controller.signal.aborted) entry.settled = true
        checkLoaded()
        if (!disposed) invalidate()
      })
  }

  /** Once the world image is too coarse for the screen, fetch the visible area sharp. */
  function upgradeDetail(entry: LayerEntry, v: ViewState) {
    const d = entry.detail
    const plan = planViewImage({
      spec: entry.spec,
      view: v,
      limits: limits(entry.spec),
      free: free(d ?? { bytes: 0, reserved: 0 }),
      shown: d?.shownKey === entry.paramsKey ? d : null,
    })
    if (plan.kind === 'drop') {
      if (d) {
        dropDetail(entry)
        invalidate()
      }
      return
    }
    if (plan.kind === 'keep' || d?.controller) return
    // Alongside the world image, not after it: entering zoomed in needs it first.
    if (!entry.errored && retryDue(entry.detailBackoff))
      loadDetail(entry, plan.region, plan.scale)
  }

  /** Sharper world images and view images for the current camera. */
  function upgradeNow() {
    window.clearTimeout(upgradeTimer)
    if (!live) return
    const v = view()
    for (const entry of allEntries()) {
      const target = worldUpgrade(
        entry.spec,
        v.zoom,
        limits(entry.spec),
        free(entry),
        entry.scale,
      )
      if (
        target !== null &&
        !entry.controller &&
        !entry.errored &&
        retryDue(entry.upgradeBackoff)
      )
        load(entry, target)
      upgradeDetail(entry, v)
    }
  }

  function scheduleUpgrade() {
    window.clearTimeout(upgradeTimer)
    upgradeTimer = window.setTimeout(upgradeNow, UPGRADE_IDLE_MS)
  }

  function removeLayer(entry: LayerEntry) {
    entry.controller?.abort()
    dropTexture(entry)
    dropDetail(entry)
  }

  /** Hold an entry until the next wake; its old image must not pose as the new one. */
  function defer(entry: LayerEntry) {
    entry.controller?.abort()
    dropTexture(entry)
    entry.settled = false
    entry.stale = true
  }

  /** Match `target` to `specs`: new keys load, changed params reload, the rest update. */
  function reconcile(
    target: Map<string, LayerEntry>,
    specs: ReadonlyArray<GlobeLayerSpec>,
    deferrable: boolean,
  ) {
    const hold = deferrable && !live
    const wanted = new Set<string>()
    const loading: Array<LayerEntry> = []
    let changed = false
    for (const spec of specs) {
      wanted.add(spec.key)
      const paramsKey = `${spec.endpoint}|${JSON.stringify(spec.params)}`
      let entry = target.get(spec.key)
      if (!entry) {
        entry = {
          spec,
          paramsKey,
          pending: null,
          texture: null,
          box: [0, 0, 1, 1],
          scale: 0,
          shownKey: '',
          controller: null,
          detail: null,
          upgradeBackoff: { until: 0, failures: 0 },
          detailBackoff: { until: 0, failures: 0 },
          errored: false,
          settled: false,
          stale: false,
          bytes: 0,
          reserved: 0,
        }
        target.set(spec.key, entry)
        changed = true
        if (hold) entry.stale = true
        else {
          load(entry, first(spec))
          loading.push(entry)
        }
      } else if (entry.paramsKey !== paramsKey) {
        entry.spec = spec
        entry.paramsKey = paramsKey
        entry.errored = false
        changed = true
        if (hold) {
          dropDetail(entry)
          defer(entry)
        } else {
          // Keep the shown pair until the new world image lands; fetched small when a view image covers it.
          abortDetail(entry)
          // Unloaded until the new instant is in: export waits on it.
          entry.settled = false
          load(
            entry,
            refetchScale(
              spec,
              zoom(),
              limits(spec),
              entry.scale,
              Boolean(entry.detail?.texture),
            ),
          )
          loading.push(entry)
        }
      } else {
        if (drawKey(entry.spec) !== drawKey(spec)) changed = true
        entry.spec = spec
      }
    }
    for (const [key, entry] of target) {
      if (wanted.has(key)) continue
      removeLayer(entry)
      target.delete(key)
      changed = true
    }
    // Sharp view images once every first image holds its budget share.
    if (loading.length > 0) {
      const v = view()
      for (const entry of loading) upgradeDetail(entry, v)
    }
    checkLoaded()
    // An unchanged stack (React pushes one every commit) repaints nothing.
    if (!changed) return
    reorder()
    invalidate()
  }

  return {
    setLayers: (specs) => reconcile(layers, specs, true),

    // The native basemap has no time: a warm globe preloads it.
    setDecoration: (specs) => reconcile(deco, specs, false),

    setLive: (on) => {
      if (on === live) return
      live = on
      if (!on) {
        window.clearTimeout(upgradeTimer)
        // In-flight loads for a hidden globe would only feed the flat map's failure log.
        for (const entry of layers.values()) {
          if (entry.controller) defer(entry)
          entry.detail?.controller?.abort()
        }
        return
      }
      const woken = [...layers.values()].filter((entry) => entry.stale)
      for (const entry of woken) {
        entry.stale = false
        load(
          entry,
          refetchScale(
            entry.spec,
            zoom(),
            limits(entry.spec),
            entry.scale,
            false,
          ),
        )
      }
      const v = view()
      for (const entry of woken) upgradeDetail(entry, v)
      scheduleUpgrade()
    },

    whenLoaded: () =>
      new Promise<void>((resolve) => {
        loadWaiters.push(resolve)
        checkLoaded()
      }),

    scheduleUpgrade,

    upgradeNow,

    eachLayer: (draw) => {
      for (const entry of drawOrder) {
        const world = entry.texture || entry.pending ? entry : null
        const d = entry.detail
        // One instant per frame: a view image only over a world image of its params.
        const shown =
          d &&
          (d.texture || d.pending) &&
          d.shownKey === (world ? entry.shownKey : entry.paramsKey)
        draw(entry.spec, world, shown ? d : null)
      }
    },

    forgetTextures: () => {
      for (const entry of allEntries()) {
        entry.texture = null
        if (entry.detail) entry.detail.texture = null
      }
    },

    reload: () => {
      for (const entry of allEntries()) {
        dropTexture(entry)
        dropDetail(entry)
        entry.scale = 0
        entry.settled = false
        if (!live && layers.has(entry.spec.key)) entry.stale = true
        else load(entry, first(entry.spec))
      }
      scheduleUpgrade()
    },

    dispose: () => {
      disposed = true
      window.clearTimeout(upgradeTimer)
      for (const entry of allEntries()) removeLayer(entry)
      layers.clear()
      deco.clear()
      drawOrder = []
      for (const resolve of loadWaiters.splice(0)) resolve()
    },
  }
}
