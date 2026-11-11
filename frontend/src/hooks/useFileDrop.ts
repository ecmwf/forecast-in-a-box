/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useState } from 'react'
import type { DragEvent } from 'react'

/** True when the drag carries files, e.g. from the desktop. */
export function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  return !!dataTransfer && dataTransfer.types.includes('Files')
}

export interface FileDropTarget {
  /** A file is being dragged over the target. */
  isDragOver: boolean
  /** Spread onto the drop target; empty without `onFile`. */
  dropHandlers: {
    onDragEnter?: (event: DragEvent<HTMLElement>) => void
    onDragOver?: (event: DragEvent<HTMLElement>) => void
    onDragLeave?: (event: DragEvent<HTMLElement>) => void
    onDrop?: (event: DragEvent<HTMLElement>) => void
  }
}

/** Makes an element accept one dropped file; other drags pass through untouched. */
export function useFileDrop(onFile?: (file: File) => void): FileDropTarget {
  const [isDragOver, setIsDragOver] = useState(false)
  if (!onFile) return { isDragOver: false, dropHandlers: {} }
  return {
    isDragOver,
    dropHandlers: {
      onDragEnter: (event) => {
        if (!isFileDrag(event.dataTransfer)) return
        event.preventDefault()
        setIsDragOver(true)
      },
      onDragOver: (event) => {
        if (!isFileDrag(event.dataTransfer)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (event) => {
        // Moving onto a child also fires dragleave on the target.
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setIsDragOver(false)
      },
      onDrop: (event) => {
        if (!isFileDrag(event.dataTransfer)) return
        event.preventDefault()
        setIsDragOver(false)
        const file = event.dataTransfer.files.item(0)
        if (file) onFile(file)
      },
    },
  }
}

/** Refuses file drops outside the page's own drop targets. */
export function useRefuseStrayFileDrops(): void {
  useEffect(() => {
    const refuse = (event: globalThis.DragEvent) => {
      if (event.defaultPrevented || !isFileDrag(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
    }
    window.addEventListener('dragover', refuse)
    window.addEventListener('drop', refuse)
    return () => {
      window.removeEventListener('dragover', refuse)
      window.removeEventListener('drop', refuse)
    }
  }, [])
}
