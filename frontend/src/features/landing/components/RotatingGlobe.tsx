/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import ReactGlobe from 'react-globe.gl'
import { useCallback, useMemo, useRef } from 'react'
import { CanvasTexture, MeshBasicMaterial } from 'three'
import type { GlobeMethods } from 'react-globe.gl'
import { useSpriteSheetAnimation } from '@/features/landing/hooks/useSpriteSheetAnimation'
import coastlinesLow from '@/features/landing/data/coastlines-low.json'

const defaultPOV = { lat: 52, lng: 16, altitude: 1.4 }

// Sprite-sheet geometry — must match era5/sprite_sheet.png.
const FRAME_WIDTH = 600
const FRAME_HEIGHT = 300
const COLUMNS = 20
const TOTAL_FRAMES = 280
const FPS = 40

interface CoastlineGeometry {
  type: string
  coordinates: Array<Array<Array<number>>>
}

interface CoastlineFeature {
  geometry: CoastlineGeometry
  properties: Record<string, unknown>
}

interface CoastlineData {
  features: Array<CoastlineFeature>
}

interface ProcessedPath {
  coords: Array<Array<number>>
  properties: Record<string, unknown>
}

// The coastlines dataset contains only MultiLineString geometries: each entry
// in `coordinates` is a separate line segment used directly as a globe path.
const processCoastlines = (data: CoastlineData): Array<ProcessedPath> => {
  const paths: Array<ProcessedPath> = []
  data.features.forEach(({ geometry, properties }) => {
    geometry.coordinates.forEach((segment) => {
      paths.push({ coords: segment, properties })
    })
  })
  return paths
}

const RotatingGlobe = () => {
  const globeEl = useRef<GlobeMethods | undefined>(undefined)

  // Holds the current globe material so the rAF frame callback (whose identity
  // is stable inside the animation hook) always reads the latest texture.
  const globeMaterialRef = useRef<MeshBasicMaterial | null>(null)

  // Flag the canvas texture as dirty inside the same rAF tick that drew the
  // new frame — keeps the texture in step with the animation without a
  // second, uncoordinated timer.
  const handleFrameRendered = useCallback(() => {
    const map = globeMaterialRef.current?.map
    if (map) map.needsUpdate = true
  }, [])

  const { canvasRef, isAnimationReady } = useSpriteSheetAnimation({
    spriteSheetUrl: './era5/sprite_sheet.png',
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    totalFrames: TOTAL_FRAMES,
    columns: COLUMNS,
    fps: FPS,
    onFrameRendered: handleFrameRendered,
  })

  const coastlines = useMemo(() => processCoastlines(coastlinesLow), [])

  const globeMaterial = useMemo(() => {
    if (!isAnimationReady || !canvasRef.current)
      return new MeshBasicMaterial({ color: '#ffffff' })

    const texture = new CanvasTexture(canvasRef.current)
    // Anisotropy enhances texture quality when viewed at an angle
    texture.anisotropy = 16
    return new MeshBasicMaterial({ map: texture, color: '#ffffff' })
  }, [isAnimationReady, canvasRef])

  globeMaterialRef.current = globeMaterial

  const onGlobeReady = useCallback(() => {
    const globe = globeEl.current
    if (!globe) return

    const controls = globe.controls()
    controls.autoRotate = true
    controls.autoRotateSpeed = 2
    controls.enableZoom = false

    globe.pointOfView(defaultPOV)
  }, [])

  return (
    <>
      <canvas
        ref={canvasRef}
        width={FRAME_WIDTH}
        height={FRAME_HEIGHT}
        style={{ display: 'none' }}
      />

      <div style={{ position: 'relative', width: 400, height: 400 }}>
        <ReactGlobe
          onGlobeReady={onGlobeReady}
          ref={globeEl}
          pathsData={coastlines}
          pathPoints="coords"
          pathPointLat={(p) => p[1]}
          pathPointLng={(p) => p[0]}
          pathPointAlt={0.001}
          pathColor={() => '#222'}
          pathStroke={0.5}
          pathTransitionDuration={0}
          globeMaterial={globeMaterial}
          backgroundColor="#ffffff00"
          showAtmosphere={false}
          atmosphereColor="#3366ff"
          width={400}
          height={400}
          atmosphereAltitude={0.1}
          pointAltitude={0}
        />
      </div>
    </>
  )
}

export default RotatingGlobe
