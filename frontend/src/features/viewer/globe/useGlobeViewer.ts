/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** GeoViewer's side of the globe: support, mode, camera bridges and failure paths. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { compositeMapToCanvas } from '../map-export'
import { DEFAULT_PROJECTION_ID } from '../projection-ids'
import {
  flatKindOf,
  groundMppFromZoom,
  panGlobeCamera,
  zoomFromGroundMpp,
} from './globe-camera'
import { useGlobeMode } from './useGlobeMode'
import { disableGlobe, supportsGlobe } from './webgl-support'
import type { RefObject } from 'react'
import type View from 'ol/View'
import type { CaptureResult, CompareMode } from '../geo/types'
import type { SourceSlot } from '../geo/layer-pairing'
import type { ViewerUrlState } from '../geo/view-url-state'
import type { FlatProjectionId, ProjectionId } from '../projection-ids'
import type { GlobeCamera } from './engine'
import type { GlobeMode } from './useGlobeMode'
import { useMedia } from '@/hooks/useMedia'
import { createLogger } from '@/lib/logger'
import { showToast } from '@/lib/toast'

const log = createLogger('globe')

/** Where a URL restore starts on the globe; null starts flat. */
export function globeStartCamera(
  initial: ViewerUrlState | null,
): GlobeCamera | null {
  if (initial?.projection !== 'globe' || !supportsGlobe()) return null
  return initial.camera ?? { lon: 10, lat: 30, zoom: 1.5 }
}

/** The flat panels' pixels now (DOM order a, b): the bend starts from them. */
function snapshotFlatMaps(area: HTMLElement | null): Array<CaptureResult> {
  if (!area) return []
  const viewports = [...area.querySelectorAll<HTMLElement>('.ol-viewport')]
  return viewports.flatMap((viewport, i) => {
    // Transparent: the globe's own ground shows where the flat map has none.
    const canvas = compositeMapToCanvas(
      viewport.parentElement ?? viewport,
      null,
    )
    return canvas
      ? [{ slot: i === 0 ? 'a' : 'b', label: '', timeLabel: null, canvas }]
      : []
  })
}

export interface GlobeViewer extends GlobeMode {
  /** Hardware WebGL is there; a lost context withdraws it for the session. */
  available: boolean
  /** Globe panels the current layout mounts. */
  panels: 1 | 2
  /** Back from the globe: the flat map it bent from, else Mercator. */
  exitTarget: FlatProjectionId
  /** What the map shows: the globe from the moment it starts bending in. */
  projectionId: ProjectionId
  changeProjection: (id: ProjectionId) => void
  /** The flat maps' area, snapshotted at the handoff. */
  mapAreaRef: RefObject<HTMLDivElement | null>
  /** The hidden globe is mounted ahead of a choice (menu open). */
  warm: boolean
  warmUp: () => void
  onFailure: (err: unknown) => void
  onContextLost: () => void
  /** Nudge the globe by screen px; false when the flat map should pan. */
  pan: (dx: number, dy: number) => boolean
  /** Zoom the globe to a ground resolution; false when the flat map should. */
  zoomToResolution: (mpp: number) => boolean
  /** Ground m/px of the settled globe; null off it. */
  resolution: number | null
}

export function useGlobeViewer({
  viewRef,
  adoptFlatView,
  changeFlatProjection,
  flatId,
  initialProjection,
  initialCamera,
  hasB,
  focusSlot,
  mode,
}: {
  viewRef: RefObject<View>
  adoptFlatView: (view: View, id: FlatProjectionId) => void
  changeFlatProjection: (id: FlatProjectionId) => void
  flatId: FlatProjectionId
  /** The restored projection, to say why a globe restore starts flat. */
  initialProjection: ProjectionId | undefined
  /** From globeStartCamera: start on the globe, or null. */
  initialCamera: GlobeCamera | null
  hasB: boolean
  focusSlot: SourceSlot | null
  mode: CompareMode
}): GlobeViewer {
  const { t } = useTranslation('visualise')
  const [available, setAvailable] = useState(supportsGlobe)
  const unsupported = initialProjection === 'globe' && initialCamera === null
  useEffect(() => {
    if (unsupported) showToast.info(t('globe.unsupported'))
    // Mount only: the restore is judged once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reducedMotion = useMedia('(prefers-reduced-motion: reduce)')
  const panels = hasB && focusSlot === null && mode === 'side' ? 2 : 1
  const exitTarget: FlatProjectionId =
    flatKindOf(flatId) !== null ? flatId : DEFAULT_PROJECTION_ID
  const mapAreaRef = useRef<HTMLDivElement>(null)
  const globe = useGlobeMode({
    viewRef,
    onFlatView: adoptFlatView,
    panelCount: panels,
    reducedMotion,
    exitTarget,
    initialCamera,
    onFailure: (err) => {
      log.error('Globe failed to start', { error: err })
      showToast.error(t('globe.failed'))
    },
    captureFlat: () => Promise.resolve(snapshotFlatMaps(mapAreaRef.current)),
  })
  const phaseRef = useRef(globe.phase)
  useLayoutEffect(() => {
    phaseRef.current = globe.phase
  })

  const [warm, setWarm] = useState(false)
  const warmUp = useCallback(() => setWarm(true), [])
  const { fail } = globe
  // Unmounting the failed view lets the next menu open try afresh.
  const onFailure = useCallback(
    (err: unknown) => {
      log.error('Globe engine failed', { error: err })
      showToast.error(t('globe.failed'))
      fail()
      setWarm(false)
    },
    [fail, t],
  )
  const onContextLost = useCallback(() => {
    log.warn('Globe WebGL context lost')
    disableGlobe()
    setAvailable(false)
    showToast.error(t('globe.contextLost'))
    fail()
    setWarm(false)
  }, [fail, t])

  const projectionId: ProjectionId =
    globe.phase === 'entering' || globe.phase === 'globe' ? 'globe' : flatId
  const { enter, leave } = globe
  const changeProjection = useCallback(
    (id: ProjectionId) => {
      if (id === 'globe') return enter()
      if (phaseRef.current !== 'flat') return leave(id)
      changeFlatProjection(id)
    },
    [enter, leave, changeFlatProjection],
  )

  const { camera } = globe
  // Keys pan the view; the globe pans like the opposite drag.
  const pan = useCallback(
    (dx: number, dy: number) => {
      if (phaseRef.current !== 'globe') return false
      camera.set(panGlobeCamera(camera.get(), -dx, -dy), 'program', 'keys')
      return true
    },
    [camera],
  )
  const zoomToResolution = useCallback(
    (mpp: number) => {
      if (phaseRef.current !== 'globe') return false
      camera.set(
        { ...camera.get(), zoom: zoomFromGroundMpp(mpp) },
        'program',
        'scale',
      )
      return true
    },
    [camera],
  )
  const zoom = useSyncExternalStore(camera.subscribe, () => camera.get().zoom)
  const resolution = globe.phase === 'globe' ? groundMppFromZoom(zoom) : null

  return {
    ...globe,
    available,
    panels,
    exitTarget,
    projectionId,
    changeProjection,
    mapAreaRef,
    warm,
    warmUp,
    onFailure,
    onContextLost,
    pan,
    zoomToResolution,
    resolution,
  }
}
