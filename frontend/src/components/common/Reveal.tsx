/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Matches the `duration-200` transition; closing content stays this long. */
const REVEAL_MS = 200

/** Slides content in and out by animating height, instead of jumping. */
export function Reveal({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  const lastRef = useRef<ReactNode>(null)
  if (open) lastRef.current = children
  // Expand a frame after mount so initial content slides in too.
  const [ready, setReady] = useState(false)
  const [gone, setGone] = useState(!open)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (open) {
      setGone(false)
      return
    }
    const timer = window.setTimeout(() => setGone(true), REVEAL_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  return (
    <div
      aria-hidden={!open || undefined}
      className={cn(
        'grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none',
        open && ready ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        className,
      )}
    >
      <div className="min-h-0 overflow-hidden">
        {open || !gone ? lastRef.current : null}
      </div>
    </div>
  )
}
