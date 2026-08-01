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
 * Annotation state for the compare viewer: the pin list, editor draft,
 * tool arming, sidebar highlight/locate, GeoJSON import, and the
 * route-leave guard. Rendering stays with the caller.
 */

import { useCallback, useRef, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { toLonLat } from 'ol/proj'
import { formatLatLon } from '../format'
import {
  defaultAnnotationColor,
  nextAnnotationId,
  nextAnnotationLabel,
} from './annotations'
import type { RefObject } from 'react'
import type View from 'ol/View'
import type { MapAnnotation } from './annotations'
import type { AnnotationDraft, AnnotationPatch } from './AnnotationEditorDialog'
import type { SourceSlot } from './layer-pairing'

export function useViewerAnnotations({
  viewRef,
  onToggle,
}: {
  /** Shared camera — locate() pans it to a pin. */
  viewRef: RefObject<View | null>
  /** Fires on every arm/disarm toggle — the caller disarms rival tools. */
  onToggle: () => void
}) {
  const [annotations, setAnnotations] = useState<Array<MapAnnotation>>([])
  // Annotations are ephemeral — block route-leave and browser unload
  // while any exist; the dialog offers a GeoJSON export first.
  // Search-only navigations (slot/mode changes) keep the viewer mounted
  // and must pass freely.
  const leaveBlocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      annotations.length > 0 && current.pathname !== next.pathname,
    enableBeforeUnload: () => annotations.length > 0,
    withResolver: true,
  })
  const [annotateArmed, setAnnotateArmed] = useState(false)
  const [annotationDraft, setAnnotationDraft] =
    useState<AnnotationDraft | null>(null)
  // Where a new annotation will land, captured at map-click time.
  const pendingRef = useRef<{
    coordinate: [number, number]
    slot: SourceSlot | null
  } | null>(null)

  const onAnnotationCreate = useCallback(
    (coordinate: [number, number], slot: SourceSlot | null) => {
      pendingRef.current = { coordinate, slot }
      setAnnotationDraft({
        id: null,
        text: '',
        label: nextAnnotationLabel(annotations),
        color: defaultAnnotationColor(slot),
      })
    },
    [annotations],
  )
  const onAnnotationEdit = useCallback(
    (id: string) => {
      const annotation = annotations.find((ann) => ann.id === id)
      if (!annotation) return
      setAnnotationDraft({
        id,
        text: annotation.text,
        label: annotation.label,
        color: annotation.color,
      })
    },
    [annotations],
  )
  const saveAnnotation = (patch: AnnotationPatch) => {
    if (annotationDraft?.id) {
      setAnnotations((prev) =>
        prev.map((ann) =>
          ann.id === annotationDraft.id ? { ...ann, ...patch } : ann,
        ),
      )
    } else if (pendingRef.current) {
      const { coordinate, slot } = pendingRef.current
      setAnnotations((prev) => [
        ...prev,
        { id: nextAnnotationId(), coordinate, slot, ...patch },
      ])
      pendingRef.current = null
    }
    setAnnotationDraft(null)
  }
  const deleteAnnotation = () => {
    if (annotationDraft?.id) {
      setAnnotations((prev) =>
        prev.filter((ann) => ann.id !== annotationDraft.id),
      )
    }
    setAnnotationDraft(null)
  }
  const closeAnnotationEditor = useCallback(() => {
    pendingRef.current = null
    setAnnotationDraft(null)
  }, [])
  const removeAnnotationById = useCallback(
    (id: string) =>
      setAnnotations((prev) => prev.filter((ann) => ann.id !== id)),
    [],
  )
  const moveAnnotation = useCallback(
    (id: string, coordinate: [number, number]) =>
      setAnnotations((prev) =>
        prev.map((ann) => (ann.id === id ? { ...ann, coordinate } : ann)),
      ),
    [],
  )
  const importAnnotations = useCallback(
    (items: ReadonlyArray<Omit<MapAnnotation, 'id'>>) =>
      setAnnotations((prev) => {
        // Label-less pins (v1 files) get the next free numbers here.
        const next = [...prev]
        for (const item of items) {
          next.push({
            ...item,
            label: item.label || nextAnnotationLabel(next),
            id: nextAnnotationId(),
          })
        }
        return next
      }),
    [],
  )
  // Sidebar-row hover echoes onto the map; row click pans to the pin.
  const [annotationHighlightId, setAnnotationHighlightId] = useState<
    string | null
  >(null)
  const locateAnnotation = useCallback(
    (id: string) => {
      const annotation = annotations.find((ann) => ann.id === id)
      if (!annotation) return
      viewRef.current?.animate({
        center: annotation.coordinate,
        duration: 350,
      })
    },
    [annotations, viewRef],
  )

  const onToggleRef = useRef(onToggle)
  onToggleRef.current = onToggle
  const toggleAnnotate = useCallback(() => {
    setAnnotateArmed((armed) => !armed)
    onToggleRef.current()
  }, [])
  const disarmAnnotate = useCallback(() => setAnnotateArmed(false), [])

  // The editing pin's position (or the pending click) for the dialog.
  const annotationDraftLocation = (() => {
    const coordinate = annotationDraft?.id
      ? annotations.find((ann) => ann.id === annotationDraft.id)?.coordinate
      : pendingRef.current?.coordinate
    if (!coordinate) return null
    const [lon, lat] = toLonLat(coordinate)
    return formatLatLon(lat, lon)
  })()

  return {
    annotations,
    leaveBlocker,
    annotateArmed,
    toggleAnnotate,
    disarmAnnotate,
    annotationDraft,
    annotationDraftLocation,
    onAnnotationCreate,
    onAnnotationEdit,
    saveAnnotation,
    deleteAnnotation,
    closeAnnotationEditor,
    removeAnnotationById,
    moveAnnotation,
    importAnnotations,
    locateAnnotation,
    annotationHighlightId,
    setAnnotationHighlightId,
  }
}
