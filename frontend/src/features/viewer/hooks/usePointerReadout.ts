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
 * Lat/lon hover read-out for a viewer map. Attaches once on mount — call
 * after the map-constructing hook so `mapRef.current` is populated.
 */

import { useEffect, useState } from 'react'
import { toLonLat } from 'ol/proj'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'
import type MapBrowserEvent from 'ol/MapBrowserEvent'

export interface PointerReadout {
  lat: number
  lon: number
}

export function usePointerReadout(
  mapRef: RefObject<OlMap | null>,
): PointerReadout | null {
  const [pointer, setPointer] = useState<PointerReadout | null>(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onMove = (evt: MapBrowserEvent) => {
      if (evt.dragging) return
      const [lon, lat] = toLonLat(evt.coordinate)
      setPointer({ lat, lon })
    }
    const onLeave = () => setPointer(null)
    map.on('pointermove', onMove)
    const target = map.getTargetElement()
    target.addEventListener('mouseleave', onLeave)
    return () => {
      map.un('pointermove', onMove)
      target.removeEventListener('mouseleave', onLeave)
    }
  }, [mapRef])

  return pointer
}
