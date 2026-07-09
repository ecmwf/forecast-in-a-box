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
import { useHotkey } from '@tanstack/react-hotkeys'
import Feature from 'ol/Feature'
import OlMap from 'ol/Map'
import View from 'ol/View'
import { containsXY, createEmpty, extend, isEmpty } from 'ol/extent'
import GeoJSON from 'ol/format/GeoJSON'
import Point from 'ol/geom/Point'
import { fromExtent } from 'ol/geom/Polygon'
import Draw, { createBox } from 'ol/interaction/Draw'
import PointerInteraction from 'ol/interaction/Pointer'
import VectorLayer from 'ol/layer/Vector'
import { fromLonLat, transformExtent } from 'ol/proj'
import VectorSource from 'ol/source/Vector'
import { Fill, RegularShape, Stroke, Style } from 'ol/style'
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
  boxHandles,
  clampBboxLatitudeForMercator,
  isDegenerateBboxValue,
  moveExtent,
  parseBbox,
  resizeExtent,
  serializeBbox,
  serializeNames,
  toggleName,
  tokenize,
} from './geo-domain'
import type { Coordinate } from 'ol/coordinate'
import type { Pixel } from 'ol/pixel'
import type { Bbox, BoxHandle, BoxHandleRole, OlExtent } from './geo-domain'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  WEB_MERCATOR_EXTENT,
  makeCartoBasemapLayer,
} from '@/lib/map/ol-basemap'

type MapMode = 'select' | 'draw'

export interface GeoDomainMapProps {
  /** Full stored geodomain value (region/country names or a `west,south,east,north` bbox). */
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
// White square grips drawn at the box's corners and edge midpoints.
const HANDLE_IMAGE = new RegularShape({
  points: 4,
  radius: 6,
  angle: Math.PI / 4,
  fill: new Fill({ color: '#fff' }),
  stroke: new Stroke({ color: '#2563eb', width: 1.5 }),
})
const HANDLE_HIT_PX = 8

/** In-flight drag of the box: resizing from a handle, or moving the whole box. */
type DragCtx = {
  feature: Feature
  kind: 'move' | 'resize'
  role?: BoxHandleRole
  last?: Coordinate
  moved: boolean
}

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
  // Open straight into draw mode when the value is already a box, so it is immediately editable.
  const [mode, setMode] = useState<MapMode>(() =>
    parseBbox(value) ? 'draw' : 'select',
  )

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<OlMap | null>(null)
  const countriesLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const boxSourceRef = useRef<VectorSource | null>(null)
  const drawRef = useRef<Draw | null>(null)
  const boxLayerRef = useRef<VectorLayer<VectorSource> | null>(null)
  const editRef = useRef<PointerInteraction | null>(null)
  const dragRef = useRef<DragCtx | null>(null)
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

    // Box outline plus, in draw mode, the 8 resize handles rendered at its corners/edges.
    const boxLayer = new VectorLayer({
      source: boxSource,
      style: (feature) => {
        const geometry = feature.getGeometry()
        if (!geometry) return BOX_STYLE
        if (disabledRef.current || modeRef.current !== 'draw') return BOX_STYLE
        const styles: Array<Style> = [BOX_STYLE]
        for (const handle of boxHandles(geometry.getExtent() as OlExtent)) {
          styles.push(
            new Style({
              geometry: new Point([handle.x, handle.y]),
              image: HANDLE_IMAGE,
            }),
          )
        }
        return styles
      },
    })
    boxLayerRef.current = boxLayer

    const map = new OlMap({
      target: container,
      layers: [makeCartoBasemapLayer(), countriesLayer, boxLayer],
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

    // The box's current extent (map projection), or null when no box is drawn.
    const boxExtent = (): OlExtent | null => {
      const geometry = boxSource.getFeatures().at(0)?.getGeometry()
      return geometry ? (geometry.getExtent() as OlExtent) : null
    }
    // The resize handle under a pixel, if any (within a small grab tolerance).
    const hitHandle = (pixel: Pixel, extent: OlExtent): BoxHandle | null => {
      for (const handle of boxHandles(extent)) {
        const point = map.getPixelFromCoordinate([handle.x, handle.y])
        const distance = Math.hypot(point[0] - pixel[0], point[1] - pixel[1])
        if (distance <= HANDLE_HIT_PX) return handle
      }
      return null
    }

    // Cursor feedback: pointer over a country (select); resize/move over the box or its handles (draw).
    map.on('pointermove', (event) => {
      if (event.dragging) return
      const element = map.getTargetElement()
      if (disabledRef.current) {
        element.style.cursor = ''
        return
      }
      if (modeRef.current === 'select') {
        const overCountry = map.hasFeatureAtPixel(event.pixel, {
          layerFilter: (layer) => layer === countriesLayer,
        })
        element.style.cursor = overCountry ? 'pointer' : ''
        return
      }
      const extent = boxExtent()
      if (extent) {
        const handle = hitHandle(event.pixel, extent)
        if (handle) {
          element.style.cursor = handle.cursor
          return
        }
        if (containsXY(extent, event.coordinate[0], event.coordinate[1])) {
          element.style.cursor = 'move'
          return
        }
      }
      element.style.cursor = 'crosshair'
    })

    // Re-render the stored box (or nothing) after a discarded sketch.
    const restoreBoxFromValue = () => {
      boxSource.clear()
      const bbox = parseBbox(valueRef.current)
      if (bbox) {
        boxSource.addFeature(
          new Feature(fromExtent(bboxToMercatorExtent(bbox))),
        )
      }
    }

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
      const next = serializeBbox(latLon)
      if (isDegenerateBboxValue(next)) {
        // zero-size after whole-degree rounding: restore once Draw has added the sketch
        setTimeout(restoreBoxFromValue, 0)
        return
      }
      onChangeRef.current(next)
    })
    map.addInteraction(draw)
    drawRef.current = draw

    // Edit the box: handle-drag resizes, interior-drag moves. Above Draw, so empty-map drags still draw a new box.
    const edit = new PointerInteraction({
      handleDownEvent: (event) => {
        if (disabledRef.current || modeRef.current !== 'draw') return false
        const feature = boxSource.getFeatures().at(0)
        const extent = feature?.getGeometry()?.getExtent() as
          | OlExtent
          | undefined
        if (!feature || !extent) return false
        const handle = hitHandle(event.pixel, extent)
        if (handle) {
          dragRef.current = {
            feature,
            kind: 'resize',
            role: handle.role,
            moved: false,
          }
          map.getTargetElement().style.cursor = handle.cursor
          return true
        }
        if (containsXY(extent, event.coordinate[0], event.coordinate[1])) {
          dragRef.current = {
            feature,
            kind: 'move',
            last: event.coordinate,
            moved: false,
          }
          map.getTargetElement().style.cursor = 'move'
          return true
        }
        return false
      },
      handleDragEvent: (event) => {
        const context = dragRef.current
        const extent = context?.feature.getGeometry()?.getExtent() as
          | OlExtent
          | undefined
        if (!context || !extent) return
        context.moved = true
        const [x, y] = event.coordinate
        let next: OlExtent
        if (context.kind === 'resize' && context.role) {
          next = resizeExtent(extent, context.role, x, y, WEB_MERCATOR_EXTENT)
        } else if (context.last) {
          next = moveExtent(
            extent,
            x - context.last[0],
            y - context.last[1],
            WEB_MERCATOR_EXTENT,
          )
          context.last = event.coordinate
        } else {
          return
        }
        context.feature.setGeometry(fromExtent(next))
      },
      handleUpEvent: () => {
        const context = dragRef.current
        dragRef.current = null
        if (context?.moved) {
          const extent = context.feature.getGeometry()?.getExtent()
          if (extent) {
            const latLon = transformExtent(
              extent,
              'EPSG:3857',
              'EPSG:4326',
            ) as OlExtent
            const next = serializeBbox(latLon)
            // an edge dragged onto its opposite rounds to a zero-size box: revert instead
            if (isDegenerateBboxValue(next)) restoreBoxFromValue()
            else onChangeRef.current(next)
          }
        }
        return false
      },
    })
    edit.setActive(false)
    map.addInteraction(edit)
    editRef.current = edit

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
      boxLayerRef.current = null
      editRef.current = null
      dragRef.current = null
    }
  }, [])

  // Enable drawing + box editing only in draw mode; in select mode drag pans and clicks select.
  useEffect(() => {
    drawRef.current?.setActive(mode === 'draw')
    editRef.current?.setActive(mode === 'draw')
    boxLayerRef.current?.changed() // show/hide the resize handles for the new mode
  }, [mode])

  // Reflect the current value: restyle country highlights and (re)draw the box rectangle.
  useEffect(() => {
    countriesLayerRef.current?.changed()
    const boxSource = boxSourceRef.current
    if (!boxSource) return
    boxSource.clear()
    const bbox = parseBbox(value)
    if (bbox) {
      boxSource.addFeature(new Feature(fromExtent(bboxToMercatorExtent(bbox))))
    }
  }, [value])

  // Delete/Backspace clears the selection while the map holds focus (scoped to the map element).
  useHotkey('Delete', () => onChange(''), {
    target: containerRef,
    enabled: !disabled && !!value,
    preventDefault: true,
  })
  useHotkey('Backspace', () => onChange(''), {
    target: containerRef,
    enabled: !disabled && !!value,
    preventDefault: true,
  })

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
            title={t('geoDomain.clearHint')}
          >
            <Eraser className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        tabIndex={0}
        role="group"
        aria-label={t('geoDomain.tabMap')}
        onPointerDown={(event) =>
          event.currentTarget.focus({ preventScroll: true })
        }
        className={cn(
          'w-full overflow-hidden rounded-md border bg-muted transition-[height] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring',
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

/** Convert a stored `[W,S,E,N]` bbox to a Web Mercator display extent. Latitude is clamped so a
 *  polar bbox (lat →±90) can't yield an infinite extent that breaks the map's fit. */
function bboxToMercatorExtent(bbox: Bbox): OlExtent {
  return transformExtent(
    clampBboxLatitudeForMercator(bbox),
    'EPSG:4326',
    'EPSG:3857',
  ) as OlExtent
}

/** Initial fit target: a drawn box, else the extent of the initially selected countries, else null. */
function initialExtent(
  countriesSource: VectorSource,
  value: string,
): OlExtent | null {
  const bbox = parseBbox(value)
  if (bbox) return bboxToMercatorExtent(bbox)
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
