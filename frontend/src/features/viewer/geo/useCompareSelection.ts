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
 * Linked/unlinked layer selection across two compare sources.
 *
 * Linked (default): one ordered list of PAIR keys drives both sides —
 * picking "2 m temperature" activates it on every source that has it; a
 * missing side simply contributes nothing. Unlinked: each side owns its
 * ordered layer-name list. Transitions are lossless linked→unlinked (the
 * derived per-source orders are copied) and union-rebuilding the other
 * way. Zero pair overlap forces unlinked — the caller surfaces the notice.
 *
 * Opacity and request settings (style, extra dimensions) ride along the
 * same keys; a pair's style applies to each side that advertises it.
 */

import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_LAYER_OPACITY } from '../ol-layers'
import type { PairedLayer, SourceSlot } from './layer-pairing'
import type { LayerRequestSettings } from '../wms-capabilities'

export type LinkMode = 'linked' | 'unlinked'

function moveItem<T>(
  list: ReadonlyArray<T>,
  from: number,
  to: number,
): Array<T> {
  if (from === to || from < 0 || to < 0) return [...list]
  if (from >= list.length || to >= list.length) return [...list]
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

interface PerSourceSelection {
  activeOrder: Array<string>
  layerOpacities: Map<string, number>
  layerSettings: Map<string, LayerRequestSettings>
}

const emptySelection = (): PerSourceSelection => ({
  activeOrder: [],
  layerOpacities: new Map(),
  layerSettings: new Map(),
})

/** Merge a style into settings; null clears it (empty → undefined). */
function withStyle(
  prev: LayerRequestSettings | undefined,
  style: string | null,
): LayerRequestSettings | undefined {
  const next: LayerRequestSettings = { ...prev }
  if (style) next.style = style
  else delete next.style
  return next.style || next.dims ? next : undefined
}

/** Settings plus the slot's per-layer dimension values (run pins). */
function mergeDims(
  base: Map<string, LayerRequestSettings>,
  dims: Map<string, Record<string, string>>,
): Map<string, LayerRequestSettings> {
  if (dims.size === 0) return base
  const merged = new Map(base)
  for (const [name, values] of dims) {
    merged.set(name, { ...merged.get(name), dims: values })
  }
  return merged
}

export interface CompareSelection {
  linkMode: LinkMode
  /** True when unlinked was forced by zero overlap (shows the notice). */
  autoUnlinked: boolean
  /** Active pair keys, index 0 = top (linked mode). */
  linkedOrder: ReadonlyArray<string>
  /** Layer NAMES + opacities for a source's stack, in stacking order. */
  activeOrderFor: (slot: SourceSlot) => Array<string>
  opacitiesFor: (slot: SourceSlot) => Map<string, number>
  /** Per-layer request settings for a source's stack. */
  settingsFor: (slot: SourceSlot) => Map<string, LayerRequestSettings>
  isPairActive: (key: string) => boolean
  togglePair: (key: string) => void
  setPairOpacity: (key: string, opacity: number) => void
  pairOpacity: (key: string) => number
  /** A pair's chosen style (null = each side's default). */
  pairStyle: (key: string) => string | null
  setPairStyle: (key: string, style: string | null) => void
  /** Move an active pair within the stacking order (linked mode). */
  reorderPair: (from: number, to: number) => void
  /** Move an active layer within one source's order (unlinked mode). */
  reorderLayer: (slot: SourceSlot, from: number, to: number) => void
  isLayerActive: (slot: SourceSlot, name: string) => boolean
  toggleLayer: (slot: SourceSlot, name: string) => void
  setLayerOpacity: (slot: SourceSlot, name: string, opacity: number) => void
  layerOpacity: (slot: SourceSlot, name: string) => number
  layerStyle: (slot: SourceSlot, name: string) => string | null
  setLayerStyle: (slot: SourceSlot, name: string, style: string | null) => void
  /** A layer's extra-dimension value on one side (null = server default). */
  layerDim: (slot: SourceSlot, name: string, dim: string) => string | null
  setLayerDim: (
    slot: SourceSlot,
    name: string,
    dim: string,
    value: string | null,
  ) => void
  setLinkMode: (mode: LinkMode, options?: { auto?: boolean }) => void
  /** A slot swap exchanged the sources — the unlinked lists follow them. */
  onSlotsSwapped: () => void
  /** Drop unlinked names a settled catalog can't serve (opacities kept). */
  retainServable: (slot: SourceSlot, names: ReadonlySet<string>) => void
  clear: () => void
}

export interface CompareSelectionOptions {
  /** Style to start a newly activated layer with (e.g. the user's pin). */
  defaultStyle?: (slot: SourceSlot, layerName: string) => string | null
}

export function useCompareSelection(
  pairs: ReadonlyArray<PairedLayer>,
  { defaultStyle }: CompareSelectionOptions = {},
): CompareSelection {
  const [linkMode, setLinkModeState] = useState<LinkMode>('linked')
  const [autoUnlinked, setAutoUnlinked] = useState(false)
  const [linkedOrder, setLinkedOrder] = useState<Array<string>>([])
  const [linkedOpacities, setLinkedOpacities] = useState<Map<string, number>>(
    new Map(),
  )
  const [linkedSettings, setLinkedSettings] = useState<
    Map<string, LayerRequestSettings>
  >(new Map())
  const [perSource, setPerSource] = useState<
    Record<SourceSlot, PerSourceSelection>
  >({ a: emptySelection(), b: emptySelection() })
  // Dimensions (runs) are per server: per slot in both modes.
  const [dimsBySlot, setDimsBySlot] = useState<
    Record<SourceSlot, Map<string, Record<string, string>>>
  >({ a: new Map(), b: new Map() })

  const pairByKey = useMemo(
    () => new Map(pairs.map((p) => [p.key, p])),
    [pairs],
  )

  /** Linked selection projected onto one source's layer names. */
  const deriveForSlot = useCallback(
    (slot: SourceSlot): PerSourceSelection => {
      const activeOrder: Array<string> = []
      const layerOpacities = new Map<string, number>()
      const layerSettings = new Map<string, LayerRequestSettings>()
      for (const key of linkedOrder) {
        const layer = pairByKey.get(key)?.perSource[slot]
        if (!layer) continue
        activeOrder.push(layer.name)
        layerOpacities.set(
          layer.name,
          linkedOpacities.get(key) ?? DEFAULT_LAYER_OPACITY,
        )
        const settings = linkedSettings.get(key)
        if (!settings) continue
        // A pair style applies only where this side advertises it.
        const style = layer.styles.some((s) => s.name === settings.style)
          ? settings.style
          : undefined
        const projected = withStyle(
          settings.dims ? { dims: settings.dims } : undefined,
          style ?? null,
        )
        if (projected) layerSettings.set(layer.name, projected)
      }
      return { activeOrder, layerOpacities, layerSettings }
    },
    [linkedOrder, linkedOpacities, linkedSettings, pairByKey],
  )

  // Memoized: consumers hang memos and effects off the returned identities
  // (time-index expansion, the stacks' reconcile deps, the prefetch loop) —
  // deriving fresh objects per call would churn them all every render.
  const derived = useMemo(
    () => ({ a: deriveForSlot('a'), b: deriveForSlot('b') }),
    [deriveForSlot],
  )
  const current = useCallback(
    (slot: SourceSlot) =>
      linkMode === 'linked' ? derived[slot] : perSource[slot],
    [linkMode, derived, perSource],
  )
  const activeOrderFor = useCallback(
    (slot: SourceSlot) => current(slot).activeOrder,
    [current],
  )
  const opacitiesFor = useCallback(
    (slot: SourceSlot) => current(slot).layerOpacities,
    [current],
  )
  const settings = useMemo(
    () => ({
      a: mergeDims(current('a').layerSettings, dimsBySlot.a),
      b: mergeDims(current('b').layerSettings, dimsBySlot.b),
    }),
    [current, dimsBySlot],
  )
  const settingsFor = useCallback(
    (slot: SourceSlot) => settings[slot],
    [settings],
  )

  const togglePair = useCallback(
    (key: string) => {
      setLinkedOrder((prev) =>
        prev.includes(key) ? prev.filter((k) => k !== key) : [key, ...prev],
      )
      setLinkedOpacities((prev) => {
        if (prev.has(key)) return prev
        const next = new Map(prev)
        next.set(key, DEFAULT_LAYER_OPACITY)
        return next
      })
      // First activation seeds the pinned default (A's side first).
      const pair = pairByKey.get(key)
      const seed =
        (pair?.perSource.a && defaultStyle?.('a', pair.perSource.a.name)) ??
        (pair?.perSource.b && defaultStyle?.('b', pair.perSource.b.name)) ??
        null
      if (seed) {
        setLinkedSettings((prev) => {
          if (prev.has(key)) return prev
          const next = new Map(prev)
          next.set(key, { style: seed })
          return next
        })
      }
    },
    [pairByKey, defaultStyle],
  )

  const reorderPair = useCallback((from: number, to: number) => {
    setLinkedOrder((prev) => moveItem(prev, from, to))
  }, [])

  const reorderLayer = useCallback(
    (slot: SourceSlot, from: number, to: number) => {
      setPerSource((prev) => ({
        ...prev,
        [slot]: {
          ...prev[slot],
          activeOrder: moveItem(prev[slot].activeOrder, from, to),
        },
      }))
    },
    [],
  )

  const setPairOpacity = useCallback((key: string, opacity: number) => {
    setLinkedOpacities((prev) => {
      const next = new Map(prev)
      next.set(key, opacity)
      return next
    })
  }, [])

  const setPairStyle = useCallback((key: string, style: string | null) => {
    setLinkedSettings((prev) => {
      const next = new Map(prev)
      const merged = withStyle(prev.get(key), style)
      if (merged) next.set(key, merged)
      else next.delete(key)
      return next
    })
  }, [])

  const setLayerOpacity = useCallback(
    (slot: SourceSlot, name: string, opacity: number) => {
      setPerSource((prev) => {
        const layerOpacities = new Map(prev[slot].layerOpacities)
        layerOpacities.set(name, opacity)
        return { ...prev, [slot]: { ...prev[slot], layerOpacities } }
      })
    },
    [],
  )

  const setLayerStyle = useCallback(
    (slot: SourceSlot, name: string, style: string | null) => {
      setPerSource((prev) => {
        const layerSettings = new Map(prev[slot].layerSettings)
        const merged = withStyle(layerSettings.get(name), style)
        if (merged) layerSettings.set(name, merged)
        else layerSettings.delete(name)
        return { ...prev, [slot]: { ...prev[slot], layerSettings } }
      })
    },
    [],
  )

  const toggleLayer = useCallback(
    (slot: SourceSlot, name: string) => {
      setPerSource((prev) => {
        const side = prev[slot]
        const active = side.activeOrder.includes(name)
        const activeOrder = active
          ? side.activeOrder.filter((n) => n !== name)
          : [name, ...side.activeOrder]
        const layerOpacities = new Map(side.layerOpacities)
        if (!active && !layerOpacities.has(name)) {
          layerOpacities.set(name, DEFAULT_LAYER_OPACITY)
        }
        const layerSettings = new Map(side.layerSettings)
        const seed = active ? null : defaultStyle?.(slot, name)
        if (seed && !layerSettings.has(name)) {
          layerSettings.set(name, { style: seed })
        }
        return {
          ...prev,
          [slot]: { ...side, activeOrder, layerOpacities, layerSettings },
        }
      })
    },
    [defaultStyle],
  )

  const setLayerDim = useCallback(
    (slot: SourceSlot, name: string, dim: string, value: string | null) => {
      setDimsBySlot((prev) => {
        const layers = new Map(prev[slot])
        const dims = { ...layers.get(name) }
        if (value) dims[dim] = value
        else delete dims[dim]
        if (Object.keys(dims).length > 0) layers.set(name, dims)
        else layers.delete(name)
        return { ...prev, [slot]: layers }
      })
    },
    [],
  )

  const setLinkMode = useCallback(
    (mode: LinkMode, options?: { auto?: boolean }) => {
      if (mode !== linkMode) {
        if (mode === 'unlinked') {
          // Lossless: copy the derived per-source projections.
          setPerSource({ a: deriveForSlot('a'), b: deriveForSlot('b') })
        } else {
          // Rebuild pair order from the union of both sides' active layers.
          const order: Array<string> = []
          const opacities = new Map<string, number>()
          const pairSettings = new Map<string, LayerRequestSettings>()
          for (const pair of pairByKey.values()) {
            const aName = pair.perSource.a?.name
            const bName = pair.perSource.b?.name
            const aActive =
              aName !== undefined && perSource.a.activeOrder.includes(aName)
            const bActive =
              bName !== undefined && perSource.b.activeOrder.includes(bName)
            if (!aActive && !bActive) continue
            order.push(pair.key)
            const opacity =
              (aName !== undefined
                ? perSource.a.layerOpacities.get(aName)
                : undefined) ??
              (bName !== undefined
                ? perSource.b.layerOpacities.get(bName)
                : undefined) ??
              DEFAULT_LAYER_OPACITY
            opacities.set(pair.key, opacity)
            const setting =
              (aName !== undefined
                ? perSource.a.layerSettings.get(aName)
                : undefined) ??
              (bName !== undefined
                ? perSource.b.layerSettings.get(bName)
                : undefined)
            if (setting) pairSettings.set(pair.key, setting)
          }
          setLinkedOrder(order)
          setLinkedOpacities(opacities)
          setLinkedSettings(pairSettings)
        }
        setLinkModeState(mode)
      }
      setAutoUnlinked(mode === 'unlinked' ? (options?.auto ?? false) : false)
    },
    [linkMode, perSource, deriveForSlot, pairByKey],
  )

  // Pair keys are source-independent; only the per-source lists move.
  const onSlotsSwapped = useCallback(() => {
    setPerSource((prev) => ({ a: prev.b, b: prev.a }))
    setDimsBySlot((prev) => ({ a: prev.b, b: prev.a }))
  }, [])

  const retainServable = useCallback(
    (slot: SourceSlot, names: ReadonlySet<string>) => {
      setPerSource((prev) => {
        const side = prev[slot]
        const activeOrder = side.activeOrder.filter((n) => names.has(n))
        if (activeOrder.length === side.activeOrder.length) return prev
        return { ...prev, [slot]: { ...side, activeOrder } }
      })
    },
    [],
  )

  const clear = useCallback(() => {
    setLinkedOrder([])
    setLinkedOpacities(new Map())
    setLinkedSettings(new Map())
    setPerSource({ a: emptySelection(), b: emptySelection() })
    setDimsBySlot({ a: new Map(), b: new Map() })
  }, [])

  return {
    linkMode,
    autoUnlinked,
    linkedOrder,
    activeOrderFor,
    opacitiesFor,
    settingsFor,
    isPairActive: (key) => linkedOrder.includes(key),
    togglePair,
    reorderPair,
    reorderLayer,
    setPairOpacity,
    pairOpacity: (key) => linkedOpacities.get(key) ?? DEFAULT_LAYER_OPACITY,
    pairStyle: (key) => linkedSettings.get(key)?.style ?? null,
    setPairStyle,
    isLayerActive: (slot, name) => perSource[slot].activeOrder.includes(name),
    toggleLayer,
    setLayerOpacity,
    layerOpacity: (slot, name) =>
      perSource[slot].layerOpacities.get(name) ?? DEFAULT_LAYER_OPACITY,
    layerStyle: (slot, name) =>
      perSource[slot].layerSettings.get(name)?.style ?? null,
    setLayerStyle,
    layerDim: (slot, name, dim) => dimsBySlot[slot].get(name)?.[dim] ?? null,
    setLayerDim,
    setLinkMode,
    onSlotsSwapped,
    retainServable,
    clear,
  }
}
