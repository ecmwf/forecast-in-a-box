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
 * Single-map comparison: both sources render into ONE OpenLayers map as
 * two z-banded layer stacks (A: 100+, B: 200+ — B on top). The active
 * mode decides how B is revealed:
 *
 *  - swipe   — a TRUE partition at a draggable divider: A's layers are
 *              canvas-clipped to the left region and B's to the right
 *              (prerender clip / postrender restore, coordinates via
 *              getRenderPixel so DPR never leaks in) — never both
 *  - spy     — same idea: B only inside the cursor circle, A only
 *              outside it (even-odd clip)
 *  - flicker — A/B master opacities swap 1↔0 (opacity keeps the decoded
 *              image, unlike `visible: false`, so the swap is instant
 *              with zero requests); map click or Space toggles
 *  - blend   — B's master opacity follows a slider
 *
 * Clip listeners re-attach whenever the B stack reconciles (revision
 * counter from useWmsLayerStack) and detach on mode exit — a leaked clip
 * would corrupt other modes' rendering.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getRenderPixel } from 'ol/render'
import { useOlMapBase } from '../hooks/useOlMapBase'
import { useBasemap } from '../hooks/useBasemap'
import { useWmsLayerStack } from '../hooks/useWmsLayerStack'
import { DEFAULT_BASEMAP_ID } from '../ol-layers'
import { firstNumber } from '../format'
import { CompareSlotTag } from './CompareSlotTag'
import type RenderEvent from 'ol/render/Event'
import type View from 'ol/View'
import type { ParsedLayer } from '../wms-capabilities'
import type { CompareMapSource, SingleMapMode } from './types'
import { Slider } from '@/components/ui/slider'

const noop = () => {}
const NO_DECORATIONS: ReadonlyArray<ParsedLayer> = []
/** Spy-glass radius in CSS pixels. */
const SPY_RADIUS_PX = 90
/** Swipe keyboard step as a fraction of the map width. */
const SWIPE_KEY_STEP = 0.02

export function SingleMapCompare({
  view,
  a,
  b,
  mode,
  onRegisterFit,
}: {
  view: View
  a: CompareMapSource
  b: CompareMapSource
  mode: SingleMapMode
  onRegisterFit: (fit: (() => void) | null) => void
}) {
  const { t } = useTranslation('compare')
  const containerRef = useRef<HTMLDivElement>(null)

  // Mode-owned reveal state.
  const [swipeFraction, setSwipeFraction] = useState(0.5)
  const swipeFractionRef = useRef(swipeFraction)
  const [flickerFrame, setFlickerFrame] = useState<'a' | 'b'>('a')
  const [blend, setBlend] = useState(0.6)
  const spyPixelRef = useRef<[number, number] | null>(null)

  const { mapRef, basemapLayerRef, tryFit, setFitBbox } = useOlMapBase(
    containerRef,
    { view, resetKey: 'compare-single', incLoading: noop, decLoading: noop },
  )
  useBasemap({
    mapRef,
    basemapLayerRef,
    baseUrl: a.baseUrl,
    decorationLayers: NO_DECORATIONS,
    basemapId: DEFAULT_BASEMAP_ID,
    incLoading: noop,
    decLoading: noop,
  })

  // Stack opacity = base tier (global × source) × mode factor; a time gap
  // hides the stack outright.
  let masterA = a.masterOpacity
  let masterB = b.masterOpacity
  if (mode === 'flicker') {
    masterA = flickerFrame === 'a' ? masterA : 0
    masterB = flickerFrame === 'b' ? masterB : 0
  } else if (mode === 'blend') {
    masterB *= blend
  }
  if (a.hiddenAtTime) masterA = 0
  if (b.hiddenAtTime) masterB = 0

  const needsClip = mode === 'swipe' || mode === 'spy'

  const stackA = useWmsLayerStack(mapRef, a.baseUrl, a.layers, {
    zBase: 100,
    masterOpacity: masterA,
    activeOrder: a.activeOrder,
    layerOpacities: a.layerOpacities,
    resolveTime: a.resolveTime,
    incLoading: noop,
    decLoading: noop,
    trackRevision: true,
  })
  const stackB = useWmsLayerStack(mapRef, b.baseUrl, b.layers, {
    zBase: 200,
    masterOpacity: masterB,
    activeOrder: b.activeOrder,
    layerOpacities: b.layerOpacities,
    resolveTime: b.resolveTime,
    incLoading: noop,
    decLoading: noop,
    trackRevision: true,
  })

  // Fit plumbing (union bbox of both sources).
  useEffect(() => {
    const boxes = [a.bbox, b.bbox].filter(
      (box): box is [number, number, number, number] => box !== null,
    )
    if (boxes.length === 0) {
      setFitBbox(null)
      return
    }
    setFitBbox([
      Math.min(...boxes.map((box) => box[0])),
      Math.min(...boxes.map((box) => box[1])),
      Math.max(...boxes.map((box) => box[2])),
      Math.max(...boxes.map((box) => box[3])),
    ])
  }, [a.bbox, b.bbox, setFitBbox])
  useEffect(() => {
    onRegisterFit(() => tryFit(true))
    return () => onRegisterFit(null)
  }, [tryFit, onRegisterFit])

  // -------- Canvas clips (swipe / spy) --------
  // BOTH stacks are clipped to complementary regions so the comparison is
  // a true partition — pure A on one side, pure B on the other. Clipping
  // only B would leave A visible underneath wherever B's raster is
  // transparent (sparse fields like precipitation), which reads as bogus
  // agreement between the sources.
  useEffect(() => {
    if (!needsClip) return
    const map = mapRef.current
    if (!map) return
    const layersA = [...stackA.stackRef.current]
    const layersB = [...stackB.stackRef.current]
    if (layersA.length === 0 && layersB.length === 0) return

    /** Corner path for the CSS-pixel span [x0, x1] across the full height.
     *  getRenderPixel maps CSS pixels through OL's transform — never
     *  multiply by DPR. */
    const traceSpan = (
      ctx: CanvasRenderingContext2D,
      evt: RenderEvent,
      x0: number,
      x1: number,
      height: number,
    ) => {
      const topLeft = getRenderPixel(evt, [x0, 0])
      const topRight = getRenderPixel(evt, [x1, 0])
      const bottomLeft = getRenderPixel(evt, [x0, height])
      const bottomRight = getRenderPixel(evt, [x1, height])
      ctx.moveTo(topLeft[0], topLeft[1])
      ctx.lineTo(bottomLeft[0], bottomLeft[1])
      ctx.lineTo(bottomRight[0], bottomRight[1])
      ctx.lineTo(topRight[0], topRight[1])
      ctx.closePath()
    }

    const traceSpyCircle = (
      ctx: CanvasRenderingContext2D,
      evt: RenderEvent,
      pos: [number, number],
    ) => {
      const center = getRenderPixel(evt, pos)
      const edge = getRenderPixel(evt, [pos[0] + SPY_RADIUS_PX, pos[1]])
      const radius = Math.hypot(edge[0] - center[0], edge[1] - center[1])
      ctx.moveTo(center[0] + radius, center[1])
      ctx.arc(center[0], center[1], radius, 0, 2 * Math.PI)
    }

    const prerenderFor = (slot: 'a' | 'b') => (evt: RenderEvent) => {
      const ctx = evt.context as CanvasRenderingContext2D
      const size = map.getSize()
      if (!size) return
      ctx.save()
      ctx.beginPath()
      if (mode === 'swipe') {
        const x = size[0] * swipeFractionRef.current
        if (slot === 'a') {
          traceSpan(ctx, evt, 0, x, size[1]) // A left of the divider
        } else {
          traceSpan(ctx, evt, x, size[0], size[1]) // B right of it
        }
        ctx.clip()
      } else {
        // Spy: B only inside the circle, A only outside it (even-odd
        // punches the circle out of the full-canvas span). No cursor →
        // empty B path hides B; A keeps the full span.
        const pos = spyPixelRef.current
        if (slot === 'a') {
          traceSpan(ctx, evt, 0, size[0], size[1])
          if (pos) traceSpyCircle(ctx, evt, pos)
          ctx.clip('evenodd')
        } else {
          if (pos) traceSpyCircle(ctx, evt, pos)
          ctx.clip()
        }
      }
    }
    const postrender = (evt: RenderEvent) => {
      ;(evt.context as CanvasRenderingContext2D).restore()
    }

    const prerenderA = prerenderFor('a')
    const prerenderB = prerenderFor('b')
    for (const layer of layersA) {
      layer.on('prerender', prerenderA)
      layer.on('postrender', postrender)
    }
    for (const layer of layersB) {
      layer.on('prerender', prerenderB)
      layer.on('postrender', postrender)
    }
    map.render()
    return () => {
      for (const layer of layersA) {
        layer.un('prerender', prerenderA)
        layer.un('postrender', postrender)
      }
      for (const layer of layersB) {
        layer.un('prerender', prerenderB)
        layer.un('postrender', postrender)
      }
      map.render()
    }
  }, [
    needsClip,
    mode,
    stackA.revision,
    stackA.stackRef,
    stackB.revision,
    stackB.stackRef,
    mapRef,
  ])

  // Spy cursor tracking.
  useEffect(() => {
    if (mode !== 'spy') return
    const map = mapRef.current
    const container = containerRef.current
    if (!map || !container) return
    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      spyPixelRef.current = [e.clientX - rect.left, e.clientY - rect.top]
      map.render()
    }
    const onLeave = () => {
      spyPixelRef.current = null
      map.render()
    }
    container.addEventListener('pointermove', onMove)
    container.addEventListener('pointerleave', onLeave)
    return () => {
      container.removeEventListener('pointermove', onMove)
      container.removeEventListener('pointerleave', onLeave)
      spyPixelRef.current = null
    }
  }, [mode, mapRef])

  // Flicker: Space toggles (map click too, via the overlay button below).
  const toggleFlicker = useCallback(
    () => setFlickerFrame((f) => (f === 'a' ? 'b' : 'a')),
    [],
  )
  useEffect(() => {
    if (mode !== 'flicker') return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const target = e.target as HTMLElement | null
      if (target && target.closest('input, button, textarea, [role="slider"]'))
        return
      e.preventDefault()
      toggleFlicker()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, toggleFlicker])

  // Swipe divider drag + keyboard.
  const updateSwipe = useCallback(
    (fraction: number) => {
      const clamped = Math.min(0.98, Math.max(0.02, fraction))
      swipeFractionRef.current = clamped
      setSwipeFraction(clamped)
      mapRef.current?.render()
    },
    [mapRef],
  )
  const onDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDividerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    updateSwipe((e.clientX - rect.left) / rect.width)
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-md border border-border bg-muted/20">
      <div
        ref={containerRef}
        className="absolute inset-0"
        onClick={mode === 'flicker' ? toggleFlicker : undefined}
      />
      <CompareSlotTag slot="a" label={a.label} side="left" />
      <CompareSlotTag slot="b" label={b.label} side="right" />

      {a.hiddenAtTime && <GapBadge slot="A" side="left" />}
      {b.hiddenAtTime && <GapBadge slot="B" side="right" />}

      {mode === 'swipe' && (
        <div
          role="slider"
          aria-label={t('modes.swipeHandle')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(swipeFraction * 100)}
          tabIndex={0}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              updateSwipe(swipeFractionRef.current - SWIPE_KEY_STEP)
            } else if (e.key === 'ArrowRight') {
              updateSwipe(swipeFractionRef.current + SWIPE_KEY_STEP)
            }
          }}
          className="absolute inset-y-0 z-20 w-6 -translate-x-1/2 cursor-ew-resize touch-none outline-none"
          style={{ left: `${swipeFraction * 100}%` }}
        >
          <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-background shadow-[0_0_4px_rgba(0,0,0,0.5)]" />
          <div className="absolute top-1/2 left-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] font-bold shadow-md">
            ⇄
          </div>
        </div>
      )}

      {mode === 'flicker' && (
        <div className="absolute top-2 left-1/2 z-20 -translate-x-1/2 space-y-1 text-center">
          <button
            type="button"
            onClick={toggleFlicker}
            aria-pressed={flickerFrame === 'b'}
            className="rounded-md border border-border bg-background/90 px-3 py-1 font-mono text-xs font-bold shadow-sm backdrop-blur-sm"
          >
            {t('modes.showing', { slot: flickerFrame.toUpperCase() })}
          </button>
          <p className="rounded bg-background/75 px-2 py-0.5 text-xs text-muted-foreground">
            {t('modes.flickerHint')}
          </p>
        </div>
      )}

      {mode === 'blend' && (
        <div className="absolute top-2 left-1/2 z-20 flex w-56 -translate-x-1/2 items-center gap-2 rounded-md border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur-sm">
          <span className="font-mono text-xs font-bold">A</span>
          <Slider
            value={[Math.round(blend * 100)]}
            min={0}
            max={100}
            step={1}
            aria-label={t('modes.blendLabel')}
            onValueChange={(v) => setBlend(firstNumber(v) / 100)}
          />
          <span className="font-mono text-xs font-bold">B</span>
        </div>
      )}
    </div>
  )
}

function GapBadge({ slot, side }: { slot: string; side: 'left' | 'right' }) {
  const { t } = useTranslation('compare')
  return (
    <div
      className={
        side === 'left'
          ? 'absolute top-10 left-2 z-10'
          : 'absolute top-10 right-2 z-10'
      }
    >
      <div className="rounded-md border border-amber-500/40 bg-amber-50/95 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
        {t('timeline.gap', { slot })}
      </div>
    </div>
  )
}
