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

interface SpriteSheetAnimationOptions {
  spriteSheetUrl: string
  frameWidth: number
  frameHeight: number
  totalFrames: number
  columns: number
  fps?: number
  /** Called inside the rAF tick whenever a new frame has been drawn. */
  onFrameRendered?: () => void
}

export const useSpriteSheetAnimation = ({
  spriteSheetUrl,
  frameWidth,
  frameHeight,
  totalFrames,
  columns,
  fps = 40,
  onFrameRendered,
}: SpriteSheetAnimationOptions) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isReady, setIsReady] = useState(false)

  // Keep the callback in a ref so a changing identity does not restart the loop.
  const onFrameRenderedRef = useRef(onFrameRendered)
  useEffect(() => {
    onFrameRenderedRef.current = onFrameRendered
  }, [onFrameRendered])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return

    // Hoisted to effect scope so the cleanup below can cancel the loop even
    // if the component unmounts before the image has finished loading.
    let animationFrameId: number | undefined

    const img = new Image()
    img.src = spriteSheetUrl
    img.onload = () => {
      setIsReady(true)

      let frameIndex = 0
      let lastTime = 0
      const frameDuration = 1000 / fps

      const animate = (currentTime: number) => {
        animationFrameId = requestAnimationFrame(animate)
        const deltaTime = currentTime - lastTime

        if (deltaTime > frameDuration) {
          lastTime = currentTime - (deltaTime % frameDuration)

          const col = frameIndex % columns
          const row = Math.floor(frameIndex / columns)

          ctx.clearRect(0, 0, frameWidth, frameHeight)
          ctx.drawImage(
            img,
            col * frameWidth,
            row * frameHeight,
            frameWidth,
            frameHeight,
            0,
            0,
            frameWidth,
            frameHeight,
          )
          frameIndex = (frameIndex + 1) % totalFrames
          onFrameRenderedRef.current?.()
        }
      }
      animate(0)
    }

    return () => {
      img.onload = null
      if (animationFrameId !== undefined) cancelAnimationFrame(animationFrameId)
    }
  }, [spriteSheetUrl, frameWidth, frameHeight, totalFrames, columns, fps])

  return { canvasRef, isAnimationReady: isReady }
}
