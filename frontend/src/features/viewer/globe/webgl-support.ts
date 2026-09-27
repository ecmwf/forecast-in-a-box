/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { createLogger } from '@/lib/logger'

const log = createLogger('globe')

let supported: boolean | null = null

/** Software rasterisers by name; the caveat flag alone lets SwiftShader through. */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software/i

function rendererName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const unmasked = info
    ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER)
  return String(unmasked)
}

/** Hardware WebGL2 is available; the globe is offered only then. */
export function supportsGlobe(): boolean {
  if (supported !== null) return supported
  try {
    const gl = document
      .createElement('canvas')
      .getContext('webgl2', { failIfMajorPerformanceCaveat: true })
    supported = gl !== null && !SOFTWARE_RENDERER.test(rendererName(gl))
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch (err) {
    log.warn('WebGL probe failed', err)
    supported = false
  }
  return supported
}

/** A lost context withdraws the globe for the rest of the session. */
export function disableGlobe(): void {
  supported = false
}
