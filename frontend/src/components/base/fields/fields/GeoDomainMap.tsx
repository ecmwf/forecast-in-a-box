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
import { useTranslation } from 'react-i18next'
import Feature from 'ol/Feature'
import OlMap from 'ol/Map'
import View from 'ol/View'
import { createEmpty, extend, isEmpty } from 'ol/extent'
import GeoJSON from 'ol/format/GeoJSON'
import { fromExtent } from 'ol/geom/Polygon'
import Draw, { createBox } from 'ol/interaction/Draw'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat, transformExtent } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Fill, Stroke, Style } from 'ol/style'
import {
  Eraser,
  Maximize2,
  Minimize2,
  MousePointerClick,
  SquareDashed,
} from 'lucide-react'
import 'ol/ol.css'
import countriesGeo from '../data/countries.geo.json'
import {
  olExtentToWESN,
  parseBbox,
  serializeBbox,
  serializeNames,
  toggleName,
  tokenize,
  wesnToOlExtent,
} from './geo-domain'
import type { OlExtent } from './geo-domain'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  WEB_MERCATOR_EXTENT,
  makeCartoBasemapLayer,
} from '@/lib/map/ol-basemap'

type MapMode = 'select' | 'draw'

export interface GeoDomainMapProps {
  /** Full stored geodomain value (region/country names or a `west,east,south,north` bbox). */
  value: string
  onChange: (value: string) => void
  /** Resolvable country names (NAME_LONG) — used to decide when a click extends vs. replaces. */
  countryNames: ReadonlyArray<string>
  expanded: boolean
  onToggleExpand: () => void
  disabled?: boolean
}

const COUNTRY_BASE_STYLE = new Style({
  // A faint fill makes the whole polygon clickable (a stroke alone is only hit on its edge).
  fill: new Fill({ color: 'rgba(100, 116, 139, 0.06)' }),
  stroke: new Stroke({ color: 'rgba(100, 116, 139, 0.5)', width: 0.6 }),
})
const COUNTRY_SELECTED_STYLE = new Style({
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.35)' }),
  stroke: new Stroke({ color: '#2563eb', width: 1.5 }),
})
const BOX_STYLE = new Style({
  stroke: new Stroke({ color: '#2563eb', width: 2 }),
  fill: new Fill({ color: 'rgba(37, 99, 235, 0.12)' }),
})

const lower = (value: string) => value.toLowerCase()

/**
 * Interactive OpenLayers area picker. Default export so it can be `lazy()`-loaded (OL + the
 * country polygons stay out of the main bundle until the Map tab opens). Two modes:
 * - "Select countries": click a country to toggle it into the selection (appended as a name).
 * - "Draw box": drag to draw a bounding box.
 * Country clicks and the Countries search tab edit the same value, so they stay in sync.
 */
export default function GeoDomainMap({
  value,
  onChange,
  countryNames,
  expanded,
  onToggleExpand,
  disabled,
}: GeoDomainMapProps) {
  const { t } = useTranslation('common')
  const [mode, setMode] = useState<MapMode>('select')

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<OlMap | null>(null)
  const countriesLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const boxSourceRef = useRef<VectorSource | null>(null)
  const drawRef = useRef<Draw | null>(null)
  const fittedRef = useRef(false)

  // Latest props/state mirrored into refs so the mount-once effect's handlers never go stale.
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  const modeRef = useRef(mode)
  const disabledRef = useRef(disabled)
  const selectedSetRef = useRef<Set<string>>(new Set())
  const countrySetRef = useRef<Set<string>>(new Set())
  const initialValueRef = useRef(value)
  onChangeRef.current = onChange
  valueRef.current = value
  modeRef.current = mode
  disabledRef.current = disabled
  selectedSetRef.current = new Set(tokenize(value).map(lower))
  countrySetRef.current = new Set(countryNames.map(lower))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const countriesSource = new VectorSource({
      features: new GeoJSON().readFeatures(countriesGeo, {
        featureProjection: 'EPSG:3857',
      }),
    })
    const countriesLayer = new VectorLayer({
      source: countriesSource,
      style: (feature) =>
        selectedSetRef.current.has(lower(String(feature.get('name_long'))))
          ? COUNTRY_SELECTED_STYLE
          : COUNTRY_BASE_STYLE,
    })
    countriesLayerRef.current = countriesLayer

    const boxSource = new VectorSource()
    boxSourceRef.current = boxSource

    const map = new OlMap({
      target: container,
      layers: [
        makeCartoBasemapLayer(),
        countriesLayer,
        new VectorLayer({ source: boxSource, style: BOX_STYLE }),
      ],
      view: new View({
        center: fromLonLat([0, 25]),
        zoom: 0,
        projection: 'EPSG:3857',
        extent: WEB_MERCATOR_EXTENT,
        smoothExtentConstraint: false,
        constrainResolution: false,
      }),
    })
    mapRef.current = map

    // Click a country (select mode only) to toggle it in/out of the name selection.
    map.on('singleclick', (event) => {
      if (modeRef.current !== 'select' || disabledRef.current) return
      const feature = map.forEachFeatureAtPixel(event.pixel, (hit) => hit, {
        layerFilter: (layer) => layer === countriesLayer,
      })
      if (!feature) return
      const name = String(feature.get('name_long'))
      // Extend the current selection only if it's already a pure country list; a box or a
      // preset is replaced by a fresh country selection.
      const tokens = tokenize(valueRef.current)
      const pureCountryList =
        tokens.length > 0 &&
        tokens.every((token) => countrySetRef.current.has(lower(token)))
      const current = pureCountryList ? tokens : []
      onChangeRef.current(serializeNames(toggleName(current, name)))
    })

    // Pointer cursor over a clickable country (select mode) — small interactive cue.
    map.on('pointermove', (event) => {
      if (event.dragging) return
      const overCountry =
        modeRef.current === 'select' &&
        map.hasFeatureAtPixel(event.pixel, {
          layerFilter: (layer) => layer === countriesLayer,
        })
      map.getTargetElement().style.cursor = overCountry ? 'pointer' : ''
    })

    // Drag to draw a box (active only in draw mode; see the mode effect below). The style hides
    // the sketch's cursor point so only the box outline shows while drawing.
    const draw = new Draw({
      source: boxSource,
      type: 'Circle',
      geometryFunction: createBox(),
      style: (feature) =>
        feature.getGeometry()?.getType() === 'Point' ? undefined : BOX_STYLE,
    })
    draw.setActive(false)
    draw.on('drawstart', () => boxSource.clear())
    draw.on('drawend', (event) => {
      if (disabledRef.current) return
      const geometry = event.feature.getGeometry()
      if (!geometry) return
      const latLon = transformExtent(
        geometry.getExtent(),
        'EPSG:3857',
        'EPSG:4326',
      ) as OlExtent
      onChangeRef.current(serializeBbox(olExtentToWESN(latLon)))
    })
    map.addInteraction(draw)
    drawRef.current = draw

    // Popover/tab content animates in at 0×0; recompute size once it settles, then fit once to
    // the initial selection (a box, or the extent of the initially selected countries).
    const resizeObserver = new ResizeObserver(() => {
      map.updateSize()
      if (fittedRef.current) return
      const size = map.getSize()
      if (!size || !size.every((dimension) => dimension > 0)) return
      const extent = initialExtent(countriesSource, initialValueRef.current)
      fittedRef.current = true
      if (extent)
        map.getView().fit(extent, { padding: [24, 24, 24, 24], maxZoom: 6 })
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      map.setTarget(undefined)
      mapRef.current = null
      countriesLayerRef.current = null
      boxSourceRef.current = null
      drawRef.current = null
    }
  }, [])

  // Enable box drawing only in draw mode; in select mode drag pans and clicks select.
  useEffect(() => {
    drawRef.current?.setActive(mode === 'draw')
  }, [mode])

  // Reflect the current value: restyle country highlights and (re)draw the box rectangle.
  useEffect(() => {
    countriesLayerRef.current?.changed()
    const boxSource = boxSourceRef.current
    if (!boxSource) return
    boxSource.clear()
    const bbox = parseBbox(value)
    if (bbox) {
      const extent = transformExtent(
        wesnToOlExtent(bbox),
        'EPSG:4326',
        'EPSG:3857',
      )
      boxSource.addFeature(new Feature(fromExtent(extent)))
    }
  }, [value])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          <Button
            type="button"
            size="sm"
            variant={mode === 'select' ? 'secondary' : 'ghost'}
            className="h-7 gap-1 font-normal"
            disabled={disabled}
            onClick={() => setMode('select')}
          >
            <MousePointerClick className="h-3.5 w-3.5" />
            {t('geoDomain.modeSelect')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'draw' ? 'secondary' : 'ghost'}
            className="h-7 gap-1 font-normal"
            disabled={disabled}
            onClick={() => setMode('draw')}
          >
            <SquareDashed className="h-3.5 w-3.5" />
            {t('geoDomain.modeDraw')}
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={onToggleExpand}
            aria-label={t(expanded ? 'geoDomain.collapse' : 'geoDomain.expand')}
            title={t(expanded ? 'geoDomain.collapse' : 'geoDomain.expand')}
          >
            {expanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => onChange('')}
            disabled={disabled || !value}
            aria-label={t('geoDomain.clear')}
            title={t('geoDomain.clear')}
          >
            <Eraser className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className={cn(
          'w-full overflow-hidden rounded-md border bg-muted transition-[height] duration-200',
          expanded ? 'h-[26rem]' : 'h-56',
        )}
      />
      <p className="text-xs text-muted-foreground">
        {t(mode === 'select' ? 'geoDomain.selectHint' : 'geoDomain.drawHint')}{' '}
        <span className="opacity-70">· {t('geoDomain.bordersApprox')}</span>
      </p>
    </div>
  )
}

/** Initial fit target: a drawn box, else the extent of the initially selected countries, else null. */
function initialExtent(
  countriesSource: VectorSource,
  value: string,
): OlExtent | null {
  const bbox = parseBbox(value)
  if (bbox)
    return transformExtent(
      wesnToOlExtent(bbox),
      'EPSG:4326',
      'EPSG:3857',
    ) as OlExtent
  const selected = new Set(tokenize(value).map(lower))
  if (selected.size === 0) return null
  const extent = createEmpty()
  countriesSource.forEachFeature((feature) => {
    if (selected.has(lower(String(feature.get('name_long'))))) {
      const geometry = feature.getGeometry()
      if (geometry) extend(extent, geometry.getExtent())
    }
  })
  return isEmpty(extent) ? null : (extent as OlExtent)
}
