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
 * Basemap management for a viewer map: the swap between the external
 * vector basemap and the lens's SkinnyWMS-native background, plus the
 * coastline/border reference overlay that rides above the data layers
 * while the native basemap is active. One instance per (map × lens).
 */

import { useEffect, useMemo, useRef } from 'react'
import ImageLayer from 'ol/layer/Image'
import { skinnyWmsBasemap } from '../wms-capabilities'
import {
  BASEMAPS,
  DEFAULT_BASEMAP_ID,
  IMAGERY_BASEMAPS,
  REFERENCE_OVERLAY_Z,
  SKINNYWMS_BASEMAP,
  makeBasemapLayer,
  makeDataLayerSource,
  makeSkinnyWmsBasemap,
  makeWmsImageBasemap,
} from '../ol-layers'
import type { RefObject } from 'react'
import type OlMap from 'ol/Map'
import type { ParsedLayer, SkinnyWmsBasemap } from '../wms-capabilities'
import type { BasemapLayer, BasemapOption } from '../ol-layers'

export interface BasemapControl {
  /** Basemap choices offered to the user for this lens. */
  availableBasemaps: ReadonlyArray<BasemapOption>
  /** Decoration layers split into native background + reference overlay. */
  skinnyBasemap: SkinnyWmsBasemap
}

export function useBasemap(options: {
  mapRef: RefObject<OlMap | null>
  basemapLayerRef: RefObject<BasemapLayer | null>
  baseUrl: string
  decorationLayers: ReadonlyArray<ParsedLayer>
  basemapId: string
  incLoading: () => void
  decLoading: () => void
}): BasemapControl {
  const {
    mapRef,
    basemapLayerRef,
    baseUrl,
    decorationLayers,
    basemapId,
    incLoading,
    decLoading,
  } = options
  const previousBasemapIdRef = useRef<string>(DEFAULT_BASEMAP_ID)

  // SkinnyWMS decoration layers, split into base map + reference layers.
  const skinnyBasemap = useMemo(
    () => skinnyWmsBasemap(decorationLayers),
    [decorationLayers],
  )
  // Offer the SkinnyWMS basemap only once a `background` layer is advertised.
  const availableBasemaps = useMemo<ReadonlyArray<BasemapOption>>(
    () => [
      ...BASEMAPS,
      ...IMAGERY_BASEMAPS,
      ...(skinnyBasemap.background ? [SKINNYWMS_BASEMAP] : []),
    ],
    [skinnyBasemap.background],
  )

  // -------- Basemap swap --------
  // Full layer replacement (not setSource) — the basemap types differ.
  useEffect(() => {
    const map = mapRef.current
    const oldLayer = basemapLayerRef.current
    if (!map || !oldLayer) return
    if (previousBasemapIdRef.current === basemapId) return
    previousBasemapIdRef.current = basemapId
    const opt = availableBasemaps.find((b) => b.id === basemapId) ?? BASEMAPS[0]
    let newLayer: BasemapLayer
    if (opt.type === 'skinnywms' && skinnyBasemap.background) {
      const skinny = makeSkinnyWmsBasemap(
        baseUrl,
        skinnyBasemap.background.name,
      )
      const source = skinny.getSource()
      source?.on('imageloadstart', incLoading)
      source?.on('imageloadend', decLoading)
      source?.on('imageloaderror', decLoading)
      newLayer = skinny
    } else if (opt.type === 'wms-image') {
      const imagery = makeWmsImageBasemap(opt)
      const source = imagery.getSource()
      source?.on('imageloadstart', incLoading)
      source?.on('imageloadend', decLoading)
      source?.on('imageloaderror', decLoading)
      newLayer = imagery
    } else {
      // Carto basemap — or skinnywms with no background, which falls back.
      const external = opt.type === 'skinnywms' ? BASEMAPS[0] : opt
      const tiled = makeBasemapLayer(external)
      const source = tiled.getSource()
      source?.on('tileloadstart', incLoading)
      source?.on('tileloadend', decLoading)
      source?.on('tileloaderror', decLoading)
      newLayer = tiled
    }
    map.removeLayer(oldLayer)
    map.getLayers().insertAt(0, newLayer)
    basemapLayerRef.current = newLayer
  }, [
    basemapId,
    availableBasemaps,
    skinnyBasemap.background,
    baseUrl,
    mapRef,
    basemapLayerRef,
    incLoading,
    decLoading,
  ])

  // -------- SkinnyWMS reference overlay --------
  // Coastline/border layers over the data while the SkinnyWMS basemap is
  // active. Tied to the basemap choice — no separate toggle.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (basemapId !== SKINNYWMS_BASEMAP.id) return
    if (skinnyBasemap.reference.length === 0) return
    const source = makeDataLayerSource(baseUrl, {
      LAYERS: skinnyBasemap.reference.map((l) => l.name).join(','),
      STYLES: '',
      FORMAT: 'image/png',
      TRANSPARENT: 'TRUE',
    })
    source.on('imageloadstart', incLoading)
    source.on('imageloadend', decLoading)
    source.on('imageloaderror', decLoading)
    const overlay = new ImageLayer({ source, zIndex: REFERENCE_OVERLAY_Z })
    map.addLayer(overlay)
    return () => {
      map.removeLayer(overlay)
    }
  }, [
    basemapId,
    skinnyBasemap.reference,
    baseUrl,
    mapRef,
    incLoading,
    decLoading,
  ])

  return { availableBasemaps, skinnyBasemap }
}
