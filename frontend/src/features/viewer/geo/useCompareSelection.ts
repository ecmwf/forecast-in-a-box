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
 */

import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_LAYER_OPACITY } from '../ol-layers'
import type { PairedLayer, SourceSlot } from './layer-pairing'

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
  isPairActive: (key: string) => boolean
  togglePair: (key: string) => void
  setPairOpacity: (key: string, opacity: number) => void
  pairOpacity: (key: string) => number
  /** Move an active pair within the stacking order (linked mode). */
  reorderPair: (from: number, to: number) => void
  /** Move an active layer within one source's order (unlinked mode). */
  reorderLayer: (slot: SourceSlot, from: number, to: number) => void
  isLayerActive: (slot: SourceSlot, name: string) => boolean
  toggleLayer: (slot: SourceSlot, name: string) => void
  setLayerOpacity: (slot: SourceSlot, name: string, opacity: number) => void
  layerOpacity: (slot: SourceSlot, name: string) => number
  setLinkMode: (mode: LinkMode, options?: { auto?: boolean }) => void
  clear: () => void
}

export function useCompareSelection(
  pairs: ReadonlyArray<PairedLayer>,
): CompareSelection {
  const [linkMode, setLinkModeState] = useState<LinkMode>('linked')
  const [autoUnlinked, setAutoUnlinked] = useState(false)
  const [linkedOrder, setLinkedOrder] = useState<Array<string>>([])
  const [linkedOpacities, setLinkedOpacities] = useState<Map<string, number>>(
    new Map(),
  )
  const [perSource, setPerSource] = useState<
    Record<SourceSlot, PerSourceSelection>
  >({
    a: { activeOrder: [], layerOpacities: new Map() },
    b: { activeOrder: [], layerOpacities: new Map() },
  })

  const pairByKey = useMemo(
    () => new Map(pairs.map((p) => [p.key, p])),
    [pairs],
  )

  /** Linked selection projected onto one source's layer names. */
  const deriveForSlot = useCallback(
    (slot: SourceSlot): PerSourceSelection => {
      const activeOrder: Array<string> = []
      const layerOpacities = new Map<string, number>()
      for (const key of linkedOrder) {
        const layer = pairByKey.get(key)?.perSource[slot]
        if (!layer) continue
        activeOrder.push(layer.name)
        layerOpacities.set(
          layer.name,
          linkedOpacities.get(key) ?? DEFAULT_LAYER_OPACITY,
        )
      }
      return { activeOrder, layerOpacities }
    },
    [linkedOrder, linkedOpacities, pairByKey],
  )

  // Memoized: consumers hang memos and effects off the returned identities
  // (time-index expansion, the stacks' reconcile deps, the prefetch loop) —
  // deriving fresh objects per call would churn them all every render.
  const derived = useMemo(
    () => ({ a: deriveForSlot('a'), b: deriveForSlot('b') }),
    [deriveForSlot],
  )
  const activeOrderFor = useCallback(
    (slot: SourceSlot) =>
      linkMode === 'linked'
        ? derived[slot].activeOrder
        : perSource[slot].activeOrder,
    [linkMode, derived, perSource],
  )
  const opacitiesFor = useCallback(
    (slot: SourceSlot) =>
      linkMode === 'linked'
        ? derived[slot].layerOpacities
        : perSource[slot].layerOpacities,
    [linkMode, derived, perSource],
  )

  const togglePair = useCallback((key: string) => {
    setLinkedOrder((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [key, ...prev],
    )
    setLinkedOpacities((prev) => {
      if (prev.has(key)) return prev
      const next = new Map(prev)
      next.set(key, DEFAULT_LAYER_OPACITY)
      return next
    })
  }, [])

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

  const toggleLayer = useCallback((slot: SourceSlot, name: string) => {
    setPerSource((prev) => {
      const current = prev[slot]
      const active = current.activeOrder.includes(name)
      const activeOrder = active
        ? current.activeOrder.filter((n) => n !== name)
        : [name, ...current.activeOrder]
      const layerOpacities = new Map(current.layerOpacities)
      if (!active && !layerOpacities.has(name)) {
        layerOpacities.set(name, DEFAULT_LAYER_OPACITY)
      }
      return { ...prev, [slot]: { activeOrder, layerOpacities } }
    })
  }, [])

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
          }
          setLinkedOrder(order)
          setLinkedOpacities(opacities)
        }
        setLinkModeState(mode)
      }
      setAutoUnlinked(mode === 'unlinked' ? (options?.auto ?? false) : false)
    },
    [linkMode, perSource, deriveForSlot, pairByKey],
  )

  const clear = useCallback(() => {
    setLinkedOrder([])
    setLinkedOpacities(new Map())
    setPerSource({
      a: { activeOrder: [], layerOpacities: new Map() },
      b: { activeOrder: [], layerOpacities: new Map() },
    })
  }, [])

  return {
    linkMode,
    autoUnlinked,
    linkedOrder,
    activeOrderFor,
    opacitiesFor,
    isPairActive: (key) => linkedOrder.includes(key),
    togglePair,
    reorderPair,
    reorderLayer,
    setPairOpacity,
    pairOpacity: (key) => linkedOpacities.get(key) ?? DEFAULT_LAYER_OPACITY,
    isLayerActive: (slot, name) => perSource[slot].activeOrder.includes(name),
    toggleLayer,
    setLayerOpacity,
    layerOpacity: (slot, name) =>
      perSource[slot].layerOpacities.get(name) ?? DEFAULT_LAYER_OPACITY,
    setLinkMode,
    clear,
  }
}
