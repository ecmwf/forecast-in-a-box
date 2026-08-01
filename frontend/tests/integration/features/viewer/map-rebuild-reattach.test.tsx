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
 * Map-rebuild survival: useOlMapBase recreates its OL map on resetKey
 * change; every hook that mounts layers/listeners must follow via
 * mapVersion. Before the fix they stayed keyed on the stable mapRef and
 * stranded their content on the destroyed instance.
 */

import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import type OlMap from 'ol/Map'
import type { RefObject } from 'react'
import type { MapAnnotation } from '@/features/viewer/geo/annotations'
import type { ContextOverlay } from '@/features/viewer/geo/overlays'
import type View from 'ol/View'
import {
  createViewerView,
  useOlMapBase,
} from '@/features/viewer/hooks/useOlMapBase'
import { usePointerReadout } from '@/features/viewer/hooks/usePointerReadout'
import { useAnnotationLayer } from '@/features/viewer/geo/annotations'
import { useContextOverlays } from '@/features/viewer/geo/overlays'

const noop = () => {}
const handlers = { onCreate: noop, onEdit: noop, onMove: noop }

const ANNOTATION: MapAnnotation = {
  id: 'a1',
  coordinate: [0, 0],
  text: 'pin',
  slot: null,
}

function makeOverlay(): ContextOverlay {
  return {
    id: 'o1',
    name: 'probe.geojson',
    source: new VectorSource({
      features: [new Feature({ geometry: new Point([0, 0]) })],
    }),
    visible: true,
    featureCount: 1,
    propertyKeys: [],
    labelProperty: null,
  }
}

// Exposes the live mapRef to the test without polling DOM.
const probe: { mapRef: RefObject<OlMap | null> | null } = { mapRef: null }

function Harness({
  resetKey,
  overlays,
  view,
}: {
  resetKey: string
  overlays: ReadonlyArray<ContextOverlay>
  view?: View
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { mapRef, mapVersion } = useOlMapBase(containerRef, {
    view,
    resetKey,
    incLoading: noop,
    decLoading: noop,
  })
  probe.mapRef = mapRef
  useAnnotationLayer(
    mapRef,
    [ANNOTATION],
    null,
    false,
    handlers,
    null,
    mapVersion,
  )
  useContextOverlays(mapRef, overlays, mapVersion)
  usePointerReadout(mapRef, mapVersion)
  return (
    <div
      ref={containerRef}
      style={{ width: 300, height: 200, position: 'relative' }}
    />
  )
}

const vectorLayerCount = () =>
  probe.mapRef?.current
    ?.getLayers()
    .getArray()
    .filter((l) => l instanceof VectorLayer).length ?? -1

describe('map rebuild re-attachment', () => {
  it('annotation and overlay layers follow the recreated map', async () => {
    const overlays = [makeOverlay()]
    const screen = await render(<Harness resetKey="k1" overlays={overlays} />)

    // Pin layer + overlay layer mounted on map #1.
    await expect.poll(vectorLayerCount).toBe(2)
    const firstMap = probe.mapRef?.current
    expect(firstMap).toBeTruthy()

    // resetKey change → useOlMapBase tears down and rebuilds the map.
    await screen.rerender(<Harness resetKey="k2" overlays={overlays} />)
    await expect.poll(() => probe.mapRef?.current).not.toBe(firstMap)
    // The layers must be on the NEW instance, not stranded on the dead one.
    await expect.poll(vectorLayerCount).toBe(2)
    expect(probe.mapRef?.current?.hasListener('pointermove')).toBe(true)
  })
})

describe('restored-camera floor', () => {
  it('a camera below the basemap floor clamps to minZoom', async () => {
    // A URL-restored camera from another viewport size: below z1 the
    // basemap style paints nothing and the extent can become
    // unsatisfiable — the view floor rejects it outright.
    const view = createViewerView()
    view.setCenter([0, 0])
    view.setZoom(0.2)
    expect(view.getZoom()).toBeGreaterThanOrEqual(1)

    await render(<Harness resetKey="floor" overlays={[]} view={view} />)
    await expect.poll(() => view.isDef()).toBe(true)
    expect(view.getZoom()).toBeGreaterThanOrEqual(1)
  })
})
