/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'

/**
 * Hook to measure and report node dimensions to React Flow.
 * Uses ResizeObserver to track dimension changes and updates
 * the node's measured property for use in layout calculations.
 *
 * @param nodeId - The ID of the node to track dimensions for
 * @returns A ref to attach to the node's root element
 */
export function useNodeDimensions(nodeId: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { updateNode } = useReactFlow()

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const observer = new ResizeObserver((entries) => {
      // ResizeObserver always provides at least one entry when observing a single element
      const { width, height } = entries[0].contentRect
      // Update node's measured dimensions in React Flow
      updateNode(nodeId, { measured: { width, height } })
    })

    observer.observe(element)
    return () => observer.disconnect()
  }, [nodeId, updateNode])

  return containerRef
}
