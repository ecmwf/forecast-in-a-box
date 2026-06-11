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
import { buildLensBaseUrl, buildWmsCapabilitiesUrl } from '@/api/endpoints/lens'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildLensBaseUrl', () => {
  it('targets the backend host at the lens port when a backend base URL is set', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://backend.example:8000')
    expect(buildLensBaseUrl(54321)).toBe('http://backend.example:54321')
  })

  it('keeps the backend scheme', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://fiab.example')
    expect(buildLensBaseUrl(54321)).toBe('https://fiab.example:54321')
  })

  it('falls back to the page origin host when no backend base URL is set', () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const { protocol, hostname } = window.location
    expect(buildLensBaseUrl(54321)).toBe(`${protocol}//${hostname}:54321`)
  })
})

describe('buildWmsCapabilitiesUrl', () => {
  it('appends the WMS GetCapabilities query to the lens base URL', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://backend.example:8000')
    expect(buildWmsCapabilitiesUrl(54321)).toBe(
      'http://backend.example:54321/wms?service=WMS&version=1.3.0&request=GetCapabilities',
    )
  })
})
