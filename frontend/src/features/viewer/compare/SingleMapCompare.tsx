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
import { useMeasure } from '../hooks/useMeasure'
import { useContextOverlays } from './overlays'
import { useAnnotationLayer } from './annotations'
import type { MapAnnotation } from './annotations'
import type { ContextOverlay } from './overlays'
import type { MeasureMode } from '../hooks/useMeasure'
import type { SourceSlot } from './layer-pairing'
import { compositeMapToCanvas } from '../map-export'
import { CompareSlotTag } from './CompareSlotTag'
import { LoupeOverlay } from './LoupeOverlay'
import { cn } from '@/lib/utils'
import type RenderEvent from 'ol/render/Event'
import type View from 'ol/View'
import type {
  CaptureResult,
  CompareMapSource,
  CompareModeOptions,
  SingleMapMode,
} from './types'

const noop = () => {}
/** Swipe keyboard step as a fraction of the map span. */
const SWIPE_KEY_STEP = 0.02

export function SingleMapCompare({
  view,
  a,
  b,
  mode,
  options,
  basemapId,
  basemapOpacity,
  measureMode,
  measureClearNonce,
  overlays,
  annotations,
  annotateArmed,
  onAnnotationCreate,
  onAnnotationEdit,
  onRegisterFit,
  onRegisterCapture,
}: {
  view: View
  a: CompareMapSource
  b: CompareMapSource
  mode: SingleMapMode
  options: CompareModeOptions
  basemapId: string
  basemapOpacity: number
  measureMode: MeasureMode
  measureClearNonce: number
  overlays: ReadonlyArray<ContextOverlay>
  annotations: ReadonlyArray<MapAnnotation>
  annotateArmed: boolean
  onAnnotationCreate: (
    coordinate: [number, number],
    slot: SourceSlot | null,
  ) => void
  onAnnotationEdit: (id: string) => void
  onRegisterFit: (fit: (() => void) | null) => void
  onRegisterCapture: (
    capture: (() => Promise<Array<CaptureResult>>) | null,
  ) => void
}) {
  const { t } = useTranslation('compare')
  const containerRef = useRef<HTMLDivElement>(null)

  // Mode-owned reveal state; tuning (orientation/shape/size/blend) comes
  // from the toolbar via `options`.
  const [swipeFraction, setSwipeFraction] = useState(0.5)
  const swipeFractionRef = useRef(swipeFraction)
  const [flickerFrame, setFlickerFrame] = useState<'a' | 'b'>('a')
  const spyPixelRef = useRef<[number, number] | null>(null)
  const { swipeOrientation, spyShape, spySizePx, blend } = options

  const { mapRef, basemapLayerRef, tryFit, setFitBbox } = useOlMapBase(
    containerRef,
    { view, resetKey: 'compare-single', incLoading: noop, decLoading: noop },
  )
  useBasemap({
    mapRef,
    basemapLayerRef,
    baseUrl: a.baseUrl,
    // SkinnyWMS-native uses A's background — one canvas, one base.
    decorationLayers: a.decorationLayers,
    basemapId,
    opacity: basemapOpacity,
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

  // Per-stack network activity for the slot-tag spinners.
  const [loadingCount, setLoadingCount] = useState<Record<SourceSlot, number>>({
    a: 0,
    b: 0,
  })
  const incA = useCallback(
    () => setLoadingCount((c) => ({ ...c, a: c.a + 1 })),
    [],
  )
  const decA = useCallback(
    () => setLoadingCount((c) => ({ ...c, a: Math.max(0, c.a - 1) })),
    [],
  )
  const incB = useCallback(
    () => setLoadingCount((c) => ({ ...c, b: c.b + 1 })),
    [],
  )
  const decB = useCallback(
    () => setLoadingCount((c) => ({ ...c, b: Math.max(0, c.b - 1) })),
    [],
  )

  const stackA = useWmsLayerStack(mapRef, a.baseUrl, a.layers, {
    zBase: 100,
    masterOpacity: masterA,
    activeOrder: a.activeOrder,
    layerOpacities: a.layerOpacities,
    resolveTime: a.resolveTime,
    incLoading: incA,
    decLoading: decA,
    trackRevision: true,
  })
  const stackB = useWmsLayerStack(mapRef, b.baseUrl, b.layers, {
    zBase: 200,
    masterOpacity: masterB,
    activeOrder: b.activeOrder,
    layerOpacities: b.layerOpacities,
    resolveTime: b.resolveTime,
    incLoading: incB,
    decLoading: decB,
    trackRevision: true,
  })

  useMeasure(mapRef, measureMode, measureClearNonce)
  useContextOverlays(mapRef, overlays)
  useAnnotationLayer(mapRef, annotations, null, annotateArmed, {
    onCreate: onAnnotationCreate,
    onEdit: onAnnotationEdit,
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

  // Export capture: composite all layer canvases (basemap, WMS stacks,
  // overlays) — the mode's clipping is baked into the WMS canvas, so the
  // result is WYSIWYG.
  useEffect(() => {
    onRegisterCapture(() => {
      const map = mapRef.current
      if (!map) return Promise.resolve([])
      return new Promise((resolve) => {
        map.once('rendercomplete', () => {
          const canvas = compositeMapToCanvas(map.getTargetElement())
          const timeLabel =
            a.timeLabel === b.timeLabel
              ? a.timeLabel
              : [
                  a.timeLabel ? `A ${a.timeLabel}` : null,
                  b.timeLabel ? `B ${b.timeLabel}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || null
          resolve(
            canvas
              ? [
                  {
                    label: `A · ${a.label}  |  B · ${b.label}`,
                    slot: null,
                    canvas,
                    timeLabel,
                  },
                ]
              : [],
          )
        })
        map.renderSync()
      })
    })
    return () => onRegisterCapture(null)
  }, [mapRef, a.label, b.label, a.timeLabel, b.timeLabel, onRegisterCapture])

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

    /** Corner path for a CSS-pixel rectangle. getRenderPixel maps CSS
     *  pixels through OL's transform — never multiply by DPR. */
    const traceRegion = (
      ctx: CanvasRenderingContext2D,
      evt: RenderEvent,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ) => {
      const p1 = getRenderPixel(evt, [x0, y0])
      const p2 = getRenderPixel(evt, [x0, y1])
      const p3 = getRenderPixel(evt, [x1, y1])
      const p4 = getRenderPixel(evt, [x1, y0])
      ctx.moveTo(p1[0], p1[1])
      ctx.lineTo(p2[0], p2[1])
      ctx.lineTo(p3[0], p3[1])
      ctx.lineTo(p4[0], p4[1])
      ctx.closePath()
    }

    const traceSpyLens = (
      ctx: CanvasRenderingContext2D,
      evt: RenderEvent,
      pos: [number, number],
      shape: 'circle' | 'rectangle',
      sizePx: number,
    ) => {
      if (shape === 'rectangle') {
        // 16:10-ish window centred on the cursor.
        traceRegion(
          ctx,
          evt,
          pos[0] - sizePx,
          pos[1] - sizePx * 0.62,
          pos[0] + sizePx,
          pos[1] + sizePx * 0.62,
        )
        return
      }
      const center = getRenderPixel(evt, pos)
      const edge = getRenderPixel(evt, [pos[0] + sizePx, pos[1]])
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
        if (swipeOrientation === 'vertical') {
          const x = size[0] * swipeFractionRef.current
          if (slot === 'a') {
            traceRegion(ctx, evt, 0, 0, x, size[1]) // A left of the divider
          } else {
            traceRegion(ctx, evt, x, 0, size[0], size[1]) // B right of it
          }
        } else {
          const y = size[1] * swipeFractionRef.current
          if (slot === 'a') {
            traceRegion(ctx, evt, 0, 0, size[0], y) // A above the divider
          } else {
            traceRegion(ctx, evt, 0, y, size[0], size[1]) // B below it
          }
        }
        ctx.clip()
      } else {
        // Spy: B only inside the circle, A only outside it (even-odd
        // punches the circle out of the full-canvas span). No cursor →
        // empty B path hides B; A keeps the full span.
        const pos = spyPixelRef.current
        if (slot === 'a') {
          traceRegion(ctx, evt, 0, 0, size[0], size[1])
          if (pos) traceSpyLens(ctx, evt, pos, spyShape, spySizePx)
          ctx.clip('evenodd')
        } else {
          if (pos) traceSpyLens(ctx, evt, pos, spyShape, spySizePx)
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
    swipeOrientation,
    spyShape,
    spySizePx,
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
    updateSwipe(
      swipeOrientation === 'vertical'
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height,
    )
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-md border border-border bg-muted/20">
      <div
        ref={containerRef}
        className={cn('absolute inset-0', annotateArmed && 'cursor-copy')}
        onClick={
          mode === 'flicker' && !annotateArmed ? toggleFlicker : undefined
        }
      />
      <CompareSlotTag
        slot="a"
        label={a.label}
        side="left"
        loading={loadingCount.a > 0}
        timeLabel={a.timeLabel}
      />
      <CompareSlotTag
        slot="b"
        label={b.label}
        side="right"
        loading={loadingCount.b > 0}
        timeLabel={b.timeLabel}
      />

      {a.hiddenAtTime && <GapBadge slot="A" side="left" />}
      {b.hiddenAtTime && <GapBadge slot="B" side="right" />}
      {a.timeTag && <TimeTagBadge slot="A" tag={a.timeTag} side="left" />}
      {b.timeTag && <TimeTagBadge slot="B" tag={b.timeTag} side="right" />}

      {mode === 'swipe' && (
        <div
          role="slider"
          aria-label={t('modes.swipeHandle')}
          aria-orientation={
            swipeOrientation === 'vertical' ? 'horizontal' : 'vertical'
          }
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(swipeFraction * 100)}
          tabIndex={0}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onKeyDown={(e) => {
            const dec =
              swipeOrientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp'
            const inc =
              swipeOrientation === 'vertical' ? 'ArrowRight' : 'ArrowDown'
            if (e.key === dec) {
              updateSwipe(swipeFractionRef.current - SWIPE_KEY_STEP)
            } else if (e.key === inc) {
              updateSwipe(swipeFractionRef.current + SWIPE_KEY_STEP)
            }
          }}
          className={cn(
            'absolute z-20 touch-none outline-none',
            swipeOrientation === 'vertical'
              ? 'inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize'
              : 'inset-x-0 h-6 -translate-y-1/2 cursor-ns-resize',
          )}
          style={
            swipeOrientation === 'vertical'
              ? { left: `${swipeFraction * 100}%` }
              : { top: `${swipeFraction * 100}%` }
          }
        >
          <div
            className={cn(
              'absolute bg-background shadow-[0_0_4px_rgba(0,0,0,0.5)]',
              swipeOrientation === 'vertical'
                ? 'inset-y-0 left-1/2 w-0.5 -translate-x-1/2'
                : 'inset-x-0 top-1/2 h-0.5 -translate-y-1/2',
            )}
          />
          <div className="absolute top-1/2 left-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background font-mono text-[10px] font-bold shadow-md">
            {swipeOrientation === 'vertical' ? '⇄' : '⇅'}
          </div>
        </div>
      )}

      <LoupeOverlay containerRef={containerRef} />

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
    </div>
  )
}

/** Nearest/offset resolution indicator, e.g. "B +6 h". */
function TimeTagBadge({
  slot,
  tag,
  side,
}: {
  slot: string
  tag: string
  side: 'left' | 'right'
}) {
  const { t } = useTranslation('compare')
  return (
    <div
      className={
        side === 'left'
          ? 'absolute top-10 left-2 z-10'
          : 'absolute top-10 right-2 z-10'
      }
    >
      <div className="rounded-md border border-border bg-background/90 px-2 py-1 font-mono text-xs font-medium shadow-sm backdrop-blur-sm">
        {t('timeline.offsetBadge', { slot, tag })}
      </div>
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
