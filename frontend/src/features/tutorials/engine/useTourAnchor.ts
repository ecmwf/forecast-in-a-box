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
 * Resolves a `data-tour` anchor id to a live element + viewport rect.
 * One shared, rAF-coalesced MutationObserver serves every subscriber
 * (late mounts/unmounts/visibility flips); a per-anchor ResizeObserver plus
 * scroll/resize listeners keep the rect current.
 */

import { useEffect, useState } from 'react'
import { findTourElement } from '../anchors'

export interface AnchorRect {
  top: number
  left: number
  width: number
  height: number
}

// -------- Shared DOM-change subscription --------

const domListeners = new Set<() => void>()
let domObserver: MutationObserver | null = null
let domRaf = 0

const notifyDom = () => {
  if (domRaf) return
  domRaf = requestAnimationFrame(() => {
    domRaf = 0
    for (const listener of domListeners) listener()
  })
}

/** Runs `listener` (once per frame) after any DOM structure/style change. */
export function subscribeDomChanges(listener: () => void): () => void {
  domListeners.add(listener)
  if (domObserver === null) {
    domObserver = new MutationObserver(notifyDom)
    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden'],
    })
  }
  return () => {
    domListeners.delete(listener)
    if (domListeners.size === 0 && domObserver !== null) {
      domObserver.disconnect()
      domObserver = null
      if (domRaf) cancelAnimationFrame(domRaf)
      domRaf = 0
    }
  }
}

/** Whether any element matching `selector` is currently rendered. */
export function useDomPresence(selector: string): boolean {
  const [present, setPresent] = useState(false)
  useEffect(() => {
    const sync = () => {
      const match = Array.from(document.querySelectorAll(selector)).some(
        (el) => el.getClientRects().length > 0,
      )
      setPresent(match)
    }
    sync()
    return subscribeDomChanges(sync)
  }, [selector])
  return present
}

// -------- Anchor tracking --------

function toAnchorRect(el: Element): AnchorRect {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

function sameRect(a: AnchorRect | null, b: AnchorRect | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height
  )
}

export function useTourAnchor(
  anchorId: string | undefined,
  match = '',
): {
  element: Element | null
  rect: AnchorRect | null
} {
  const [element, setElement] = useState<Element | null>(null)
  const [rect, setRect] = useState<AnchorRect | null>(null)

  useEffect(() => {
    if (anchorId === undefined) {
      setElement(null)
      setRect(null)
      return
    }

    // Starts undefined so a re-subscription publishes even a null result.
    let current: Element | null | undefined
    // Defer a frame: a synchronous setState trips the RO "undelivered" guard.
    let raf = 0
    const resizeObserver = new ResizeObserver(() => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        sync()
      })
    })

    const sync = () => {
      const el = findTourElement(anchorId, match)
      if (el !== current) {
        if (current) resizeObserver.disconnect()
        current = el
        if (el) resizeObserver.observe(el)
        setElement(el)
      }
      const next = el ? toAnchorRect(el) : null
      setRect((prev) => (sameRect(prev, next) ? prev : next))
    }

    const unsubscribe = subscribeDomChanges(sync)
    window.addEventListener('resize', sync)
    document.addEventListener('scroll', sync, { capture: true })
    sync()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      unsubscribe()
      resizeObserver.disconnect()
      window.removeEventListener('resize', sync)
      document.removeEventListener('scroll', sync, { capture: true })
    }
  }, [anchorId, match])

  return { element, rect }
}
