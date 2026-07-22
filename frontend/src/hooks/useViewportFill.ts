/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useCallback, useLayoutEffect, useState } from 'react'

/**
 * Height landing the element's bottom on the viewport bottom; the page
 * stays a normal document (footer below the fold). Re-measures on resize
 * and body-height changes (banner dismissal). Callback ref — the target
 * usually mounts after loading states.
 */
export function useViewportFill(
  active: boolean,
  { minPx = 480, insetPx = 16 }: { minPx?: number; insetPx?: number } = {},
): { ref: (node: HTMLDivElement | null) => void; height: number | null } {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const ref = useCallback((node: HTMLDivElement | null) => setEl(node), [])
  const [height, setHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    if (!active || !el) return
    const update = () => {
      const docTop = el.getBoundingClientRect().top + window.scrollY
      setHeight(Math.max(minPx, window.innerHeight - docTop - insetPx))
    }
    update()
    window.addEventListener('resize', update)
    const observer = new ResizeObserver(update)
    observer.observe(document.body)
    return () => {
      window.removeEventListener('resize', update)
      observer.disconnect()
    }
  }, [active, el, minPx, insetPx])

  return { ref, height }
}
