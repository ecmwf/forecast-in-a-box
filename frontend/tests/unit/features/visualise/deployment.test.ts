/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import {
  cspConnectPolicy,
  isRemoteDeployment,
  matchesCspSource,
  parseConnectSrc,
} from '@/features/visualise/deployment'

const APP = 'https://fiab.example.int'

// Mirrors the generated production tag (index.html + vite.config.ts).
const PROD_CSP = `
  default-src 'self';
  img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com http://localhost:* http://127.0.0.1:* https://maps.dwd.de;
  connect-src 'self' https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://cdn.jsdelivr.net http://localhost:* http://127.0.0.1:* https://maps.dwd.de https://eccharts.ecmwf.int;
`

// Dev builds substitute the curated list with open scheme sources.
const DEV_CSP = `connect-src 'self' http://localhost:* https: http:;`

describe('parseConnectSrc', () => {
  it('extracts the connect-src source list', () => {
    expect(parseConnectSrc(DEV_CSP)).toEqual([
      "'self'",
      'http://localhost:*',
      'https:',
      'http:',
    ])
  })

  it('returns null when the directive is absent', () => {
    expect(parseConnectSrc(`default-src 'self';`)).toBeNull()
  })
})

describe('cspConnectPolicy', () => {
  it('is unrestricted without a CSP tag or with open scheme sources (dev)', () => {
    expect(cspConnectPolicy(null, APP).restricted).toBe(false)
    expect(cspConnectPolicy(DEV_CSP, APP).restricted).toBe(false)
    expect(
      cspConnectPolicy(DEV_CSP, APP).allows(new URL('https://anywhere.org')),
    ).toBe(true)
  })

  it('restricts to the enumerated origins in production', () => {
    const policy = cspConnectPolicy(PROD_CSP, APP)
    expect(policy.restricted).toBe(true)
    expect(policy.allows(new URL('https://maps.dwd.de/geoserver/ows?'))).toBe(
      true,
    )
    expect(policy.allows(new URL('https://eccharts.ecmwf.int/wms/'))).toBe(true)
    expect(policy.allows(new URL('https://evil.example.org/wms'))).toBe(false)
    // Same host, wrong scheme or non-default port: not the listed origin.
    expect(policy.allows(new URL('http://maps.dwd.de/'))).toBe(false)
    expect(policy.allows(new URL('https://maps.dwd.de:8443/'))).toBe(false)
  })

  it('matches self, port wildcards, and subdomain wildcards', () => {
    const policy = cspConnectPolicy(PROD_CSP, APP)
    expect(policy.allows(new URL(`${APP}/lens/54300`))).toBe(true)
    expect(policy.allows(new URL('http://localhost:54321/wms'))).toBe(true)
    expect(policy.allows(new URL('http://127.0.0.1:8080/'))).toBe(true)
    expect(policy.allows(new URL('https://a.basemaps.cartocdn.com/x'))).toBe(
      true,
    )
    // `*.host` must not match the bare host (covered by its own entry).
    expect(
      matchesCspSource(
        new URL('https://basemaps.cartocdn.com/'),
        'https://*.basemaps.cartocdn.com',
        APP,
      ),
    ).toBe(false)
  })
})

describe('isRemoteDeployment', () => {
  it('treats loopback hosts as local, everything else as remote', () => {
    expect(isRemoteDeployment('localhost')).toBe(false)
    expect(isRemoteDeployment('127.0.0.1')).toBe(false)
    expect(isRemoteDeployment('fiab.example.int')).toBe(true)
    expect(isRemoteDeployment('192.168.1.20')).toBe(true)
  })
})
