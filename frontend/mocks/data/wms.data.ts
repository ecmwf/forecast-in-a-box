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
 * Mock state for SkinnyWMS lens servers, keyed by a generic string key — a
 * literal port (tests that talk to `http://localhost:<port>` directly, as
 * an external-style bare origin) or a lens instance id (tests that go
 * through the real `/api/v1/lens/proxy/<id>` route, matching production).
 * The `*\/wms` handler serves a capabilities document in the exact shape
 * SkinnyWMS emits (decoration layers, per-layer TIME dimension, legend URLs
 * on an internal bind address so `rebaseLensUrl` is exercised). Unregistered
 * keys answer 503, mirroring the real race where a lens reports `running`
 * before its WMS port accepts requests — unless a default config was
 * registered via `registerDefaultMockWmsServer`, which seeds any
 * unregistered key on first use (a running lens whose exact id/port a test
 * doesn't need to predict).
 */

export interface MockWmsLayerConfig {
  name: string
  title: string
  /** Raw TIME dimension, e.g. '2026-07-06T00:00:00Z,2026-07-06T06:00:00Z'. */
  time?: string
}

export interface MockWmsServerConfig {
  layers: Array<MockWmsLayerConfig>
  /** Decoration layer names split off as basemap/reference by the viewer. */
  decorations?: Array<string>
  /** EPSG:4326 [west, south, east, north]. */
  bbox?: [number, number, number, number]
  /** Requests answered 503 before the server starts serving capabilities. */
  failuresBeforeSuccess?: number
  /** GetMap TIME values answered with a WMS service exception. */
  failGetMapTimes?: Array<string>
  /** Delay every GetMap response (exercises superseding/abort paths). */
  getMapDelayMs?: number
}

interface MockWmsServer {
  config: MockWmsServerConfig
  remainingFailures: number
  capabilitiesRequests: number
  /** Fake internal bind port advertised in legend URLs, independent of the
   *  routing key (which may be a non-numeric lens instance id). */
  internalPort: number
}

let servers = new Map<string, MockWmsServer>()
let defaultConfig: MockWmsServerConfig | null = null
let internalPortCounter = 40000

export function resetWmsState(): void {
  servers = new Map()
  defaultConfig = null
  internalPortCounter = 40000
  getMapLog.clear()
}

export function hasMockWmsServer(key: string | number): boolean {
  return servers.has(String(key))
}

function createServer(config: MockWmsServerConfig): MockWmsServer {
  return {
    config,
    remainingFailures: config.failuresBeforeSuccess ?? 0,
    capabilitiesRequests: 0,
    internalPort: internalPortCounter++,
  }
}

export function registerMockWmsServer(
  key: string | number,
  config: MockWmsServerConfig,
): void {
  servers.set(String(key), createServer(config))
}

/** Seed any unregistered key with this config on first use — for flows
 *  (auto-started lenses) where the test doesn't predict the exact key. */
export function registerDefaultMockWmsServer(
  config: MockWmsServerConfig,
): void {
  defaultConfig = config
}

function serverFor(key: string): MockWmsServer | undefined {
  const existing = servers.get(key)
  if (existing) return existing
  if (!defaultConfig) return undefined
  const created = createServer(defaultConfig)
  servers.set(key, created)
  return created
}

/** GetMap requests seen per key (TIME param values, in order). */
const getMapLog = new Map<string, Array<string | null>>()

export function recordGetMap(key: string | number, time: string | null): void {
  const k = String(key)
  const log = getMapLog.get(k) ?? []
  log.push(time)
  getMapLog.set(k, log)
}

export function getMapRequests(
  key: string | number,
): ReadonlyArray<string | null> {
  return getMapLog.get(String(key)) ?? []
}

/** Should this key's GetMap fail for the given TIME? */
export function getMapFailsFor(
  key: string | number,
  time: string | null,
): boolean {
  const times = servers.get(String(key))?.config.failGetMapTimes
  return !!time && !!times && times.includes(time)
}

/** Configured GetMap response delay for a key (0 = respond immediately). */
export function getMapDelayFor(key: string | number): number {
  return servers.get(String(key))?.config.getMapDelayMs ?? 0
}

/** Capabilities requests seen by a server (asserting retry behaviour). */
export function wmsCapabilitiesRequestCount(key: string | number): number {
  return servers.get(String(key))?.capabilitiesRequests ?? 0
}

/**
 * Resolve a capabilities request against the registry.
 * `unregistered` and `failing` both surface to the client as 503.
 */
export function serveCapabilities(
  key: string | number,
): { kind: 'ok'; xml: string } | { kind: 'unavailable' } {
  const server = serverFor(String(key))
  if (!server) return { kind: 'unavailable' }
  server.capabilitiesRequests++
  if (server.remainingFailures > 0) {
    server.remainingFailures--
    return { kind: 'unavailable' }
  }
  return {
    kind: 'ok',
    xml: capabilitiesXml(server.internalPort, server.config),
  }
}

function layerXml(internalPort: number, layer: MockWmsLayerConfig): string {
  const time = layer.time
    ? `<Dimension name="time" units="ISO8601">${layer.time}</Dimension>`
    : ''
  return `<Layer>
    <Name>${layer.name}</Name>
    <Title>${layer.title}</Title>
    ${time}
    <Style>
      <Name>default</Name>
      <LegendURL>
        <OnlineResource xlink:href="http://0.0.0.0:${internalPort}/legend?layer=${encodeURIComponent(layer.name)}"/>
      </LegendURL>
    </Style>
  </Layer>`
}

function capabilitiesXml(
  internalPort: number,
  config: MockWmsServerConfig,
): string {
  const [west, south, east, north] = config.bbox ?? [-180, -90, 180, 90]
  const decorations = (config.decorations ?? ['background', 'foreground'])
    .map((name) => `<Layer><Name>${name}</Name><Title>${name}</Title></Layer>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Capability>
    <Request>
      <GetMap/>
    </Request>
    <Layer>
      <Title>WMS server</Title>
      <EX_GeographicBoundingBox>
        <westBoundLongitude>${west}</westBoundLongitude>
        <eastBoundLongitude>${east}</eastBoundLongitude>
        <southBoundLatitude>${south}</southBoundLatitude>
        <northBoundLatitude>${north}</northBoundLatitude>
      </EX_GeographicBoundingBox>
      ${decorations}
      ${config.layers.map((l) => layerXml(internalPort, l)).join('\n')}
    </Layer>
  </Capability>
</WMS_Capabilities>`
}
