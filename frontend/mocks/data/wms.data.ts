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
 * Mock state for SkinnyWMS lens servers, keyed by port. Tests register a
 * server per fake lens port; the `*\/wms` handler serves a capabilities
 * document in the exact shape SkinnyWMS emits (decoration layers, per-layer
 * TIME dimension, legend URLs on the internal bind address so `rebaseLensUrl`
 * is exercised). Unregistered ports answer 503, mirroring the real race where
 * a lens reports `running` before its WMS port accepts requests.
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
}

interface MockWmsServer {
  config: MockWmsServerConfig
  remainingFailures: number
  capabilitiesRequests: number
}

let servers = new Map<number, MockWmsServer>()

export function resetWmsState(): void {
  servers = new Map()
  getMapLog.clear()
}

export function hasMockWmsServer(port: number): boolean {
  return servers.has(port)
}

export function registerMockWmsServer(
  port: number,
  config: MockWmsServerConfig,
): void {
  servers.set(port, {
    config,
    remainingFailures: config.failuresBeforeSuccess ?? 0,
    capabilitiesRequests: 0,
  })
}

/** GetMap requests seen per port (TIME param values, in order). */
const getMapLog = new Map<number, Array<string | null>>()

export function recordGetMap(port: number, time: string | null): void {
  const log = getMapLog.get(port) ?? []
  log.push(time)
  getMapLog.set(port, log)
}

export function getMapRequests(port: number): ReadonlyArray<string | null> {
  return getMapLog.get(port) ?? []
}

/** Should this port's GetMap fail for the given TIME? */
export function getMapFailsFor(port: number, time: string | null): boolean {
  const times = servers.get(port)?.config.failGetMapTimes
  return !!time && !!times && times.includes(time)
}

/** Capabilities requests seen by a server (asserting retry behaviour). */
export function wmsCapabilitiesRequestCount(port: number): number {
  return servers.get(port)?.capabilitiesRequests ?? 0
}

/**
 * Resolve a capabilities request against the registry.
 * `unregistered` and `failing` both surface to the client as 503.
 */
export function serveCapabilities(
  port: number,
): { kind: 'ok'; xml: string } | { kind: 'unavailable' } {
  const server = servers.get(port)
  if (!server) return { kind: 'unavailable' }
  server.capabilitiesRequests++
  if (server.remainingFailures > 0) {
    server.remainingFailures--
    return { kind: 'unavailable' }
  }
  return { kind: 'ok', xml: capabilitiesXml(port, server.config) }
}

function layerXml(port: number, layer: MockWmsLayerConfig): string {
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
        <OnlineResource xlink:href="http://0.0.0.0:${port}/legend?layer=${encodeURIComponent(layer.name)}"/>
      </LegendURL>
    </Style>
  </Layer>`
}

function capabilitiesXml(port: number, config: MockWmsServerConfig): string {
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
      ${config.layers.map((l) => layerXml(port, l)).join('\n')}
    </Layer>
  </Capability>
</WMS_Capabilities>`
}
