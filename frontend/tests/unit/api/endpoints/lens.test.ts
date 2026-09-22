/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildAbsoluteWmsCapabilitiesUrl,
  buildLensBaseUrl,
  buildWmsCapabilitiesUrl,
} from '@/api/endpoints/lens'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildLensBaseUrl', () => {
  it('builds a same-origin proxy path from the lens instance id', () => {
    expect(buildLensBaseUrl('lens-42')).toBe('/api/v1/lens/proxy/lens-42')
  })

  it('encodes the instance id', () => {
    expect(buildLensBaseUrl('lens/weird id')).toBe(
      '/api/v1/lens/proxy/lens%2Fweird%20id',
    )
  })
})

describe('buildWmsCapabilitiesUrl', () => {
  it('appends the WMS GetCapabilities query to the lens proxy base', () => {
    expect(buildWmsCapabilitiesUrl('lens-42')).toBe(
      '/api/v1/lens/proxy/lens-42/wms?service=WMS&version=1.3.0&request=GetCapabilities',
    )
  })
})

describe('buildAbsoluteWmsCapabilitiesUrl', () => {
  it('resolves against the configured backend base URL', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://backend.example:8000')
    expect(buildAbsoluteWmsCapabilitiesUrl('lens-42')).toBe(
      'http://backend.example:8000/api/v1/lens/proxy/lens-42/wms?service=WMS&version=1.3.0&request=GetCapabilities',
    )
  })

  it('falls back to the page origin when no backend base URL is set', () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect(buildAbsoluteWmsCapabilitiesUrl('lens-42')).toBe(
      `${window.location.origin}/api/v1/lens/proxy/lens-42/wms?service=WMS&version=1.3.0&request=GetCapabilities`,
    )
  })
})
