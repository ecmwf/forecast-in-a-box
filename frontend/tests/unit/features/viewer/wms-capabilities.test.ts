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
// Init side-effect: humanizeParam resolves display names through i18next.
import '@/lib/i18n'
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'
import {
  CapabilitiesError,
  appendWmsParams,
  combineScaleBands,
  expandTimeSteps,
  fetchCapabilities,
  groupLayers,
  isLoopbackUrl,
  parseCapabilities,
  parseWmsTimestamp,
  partitionGroups,
  rebaseLensUrl,
  scaleBandState,
  scaleBandTargetResolution,
  skinnyWmsBasemap,
  toWmsEndpoint,
  uniquePressureLevels,
} from '@/features/viewer/wms-capabilities'

/** OGC standardized rendering pixel size — mirrors the parser's constant. */
const PX_M = 0.00028

/** Minimal WMS 1.3.0 capabilities document in the shape SkinnyWMS emits. */
function capabilitiesXml({
  withBbox = true,
}: { withBbox?: boolean } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Capability>
    <Request>
      <GetMap/>
      <GetFeatureInfo/>
    </Request>
    <Layer>
      <Title>WMS server</Title>
      ${
        withBbox
          ? `<EX_GeographicBoundingBox>
        <westBoundLongitude>-30</westBoundLongitude>
        <eastBoundLongitude>50</eastBoundLongitude>
        <southBoundLatitude>20</southBoundLatitude>
        <northBoundLatitude>75</northBoundLatitude>
      </EX_GeographicBoundingBox>`
          : ''
      }
      <Layer>
        <Name>background</Name>
        <Title>Background</Title>
      </Layer>
      <Layer>
        <Name>foreground</Name>
        <Title>Foreground</Title>
      </Layer>
      <Layer>
        <Name>2t</Name>
        <Title>2 m temperature</Title>
        <Dimension name="time" units="ISO8601">2026-06-10T06:00:00Z,2026-06-10T12:00:00Z</Dimension>
        <Style>
          <Name>default</Name>
          <LegendURL>
            <OnlineResource xlink:href="http://0.0.0.0:54321/legend?layer=2t"/>
          </LegendURL>
        </Style>
      </Layer>
      <Layer>
        <Title>Group of pressure levels</Title>
        <Layer>
          <Name>q@pl_500</Name>
          <Title>Specific humidity at 500 hPa</Title>
        </Layer>
        <Layer>
          <Name>q@pl_850</Name>
          <Title>Specific humidity at 850 hPa</Title>
        </Layer>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`
}

describe('parseCapabilities', () => {
  it('collects only leaf layers and splits off decoration layers', () => {
    const caps = parseCapabilities(capabilitiesXml())
    expect(caps.layers.map((l) => l.name)).toEqual([
      '2t',
      'q@pl_500',
      'q@pl_850',
    ])
    expect(caps.decorationLayers.map((l) => l.name)).toEqual([
      'background',
      'foreground',
    ])
  })

  it('extracts the root bounding box', () => {
    const caps = parseCapabilities(capabilitiesXml())
    expect(caps.bbox).toEqual([-30, 20, 50, 75])
  })

  it('falls back to the world bbox when none is advertised', () => {
    const caps = parseCapabilities(capabilitiesXml({ withBbox: false }))
    expect(caps.bbox).toEqual([-180, -90, 180, 90])
  })

  it('parses styles with their legend URLs', () => {
    const caps = parseCapabilities(capabilitiesXml())
    const t2 = caps.layers.find((l) => l.name === '2t')
    expect(t2?.styles).toEqual([
      {
        name: 'default',
        legendUrl: 'http://0.0.0.0:54321/legend?layer=2t',
      },
    ])
  })

  it('captures the raw time dimension', () => {
    const caps = parseCapabilities(capabilitiesXml())
    const t2 = caps.layers.find((l) => l.name === '2t')
    expect(t2?.time?.raw).toBe('2026-06-10T06:00:00Z,2026-06-10T12:00:00Z')
  })

  it('throws on malformed XML', () => {
    expect(() => parseCapabilities('<WMS_Capabilities><unclosed')).toThrow()
  })
})

// External-server shapes the lens never produces (WMS 1.3.0 §7.2.4.8).
describe('parseCapabilities — inheritance & interop', () => {
  const doc = (inner: string) => `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Capability>
    <Request><GetMap/></Request>
    <Layer>
      <Title>root</Title>
      ${inner}
    </Layer>
  </Capability>
</WMS_Capabilities>`

  it('children inherit parent TIME (case-insensitive) and styles; own declarations win', () => {
    const caps = parseCapabilities(
      doc(`<Layer>
        <Title>Forecast group</Title>
        <Dimension name="TIME" units="ISO8601">2026-07-06T00:00:00Z/2026-07-07T00:00:00Z/PT6H</Dimension>
        <Style>
          <Name>default</Name>
          <LegendURL><OnlineResource xlink:href="http://x/legend.png"/></LegendURL>
        </Style>
        <Layer><Name>t2m</Name><Title>2 m temperature</Title></Layer>
        <Layer>
          <Name>msl</Name><Title>MSL</Title>
          <Dimension name="time">2026-07-06T00:00:00Z</Dimension>
          <Style><Name>contours</Name></Style>
        </Layer>
      </Layer>`),
    )
    const t2m = caps.layers.find((l) => l.name === 't2m')
    expect(t2m?.time?.raw).toBe(
      '2026-07-06T00:00:00Z/2026-07-07T00:00:00Z/PT6H',
    )
    expect(t2m?.styles).toEqual([
      { name: 'default', legendUrl: 'http://x/legend.png' },
    ])
    // Own dimension replaces; own style precedes the inherited one.
    const msl = caps.layers.find((l) => l.name === 'msl')
    expect(msl?.time?.raw).toBe('2026-07-06T00:00:00Z')
    expect(msl?.styles.map((s) => s.name)).toEqual(['contours', 'default'])
  })

  it('reads 1.1.1-style Extent values behind an empty Dimension', () => {
    const caps = parseCapabilities(
      doc(`<Layer>
        <Name>radar</Name><Title>Radar</Title>
        <Dimension name="time" units="ISO8601"/>
        <Extent name="time" default="2026-07-06T06:00:00Z">2026-07-06T00:00:00Z/2026-07-06T06:00:00Z/PT1H</Extent>
      </Layer>`),
    )
    expect(caps.layers.find((l) => l.name === 'radar')?.time?.raw).toBe(
      '2026-07-06T00:00:00Z/2026-07-06T06:00:00Z/PT1H',
    )
  })

  it('keeps named composite parents as requestable layers', () => {
    const caps = parseCapabilities(
      doc(`<Layer>
        <Name>wind</Name><Title>Wind group</Title>
        <Layer><Name>u10</Name><Title>U</Title></Layer>
        <Layer><Name>v10</Name><Title>V</Title></Layer>
      </Layer>`),
    )
    expect(caps.layers.map((l) => l.name)).toEqual(['wind', 'u10', 'v10'])
  })
})

describe('parseCapabilities — scale bands', () => {
  const withLayer = (inner: string) => `<?xml version="1.0"?>
<WMS_Capabilities version="1.3.0">
  <Capability>
    <Request><GetMap/></Request>
    <Layer>
      <Title>root</Title>
      ${inner}
    </Layer>
  </Capability>
</WMS_Capabilities>`

  it('parses WMS 1.3.0 min/max scale denominators into a resolution band', () => {
    const caps = parseCapabilities(
      withLayer(`<Layer>
        <Name>basemap_2km</Name><Title>2 km Basemap</Title>
        <MinScaleDenominator>750001</MinScaleDenominator>
        <MaxScaleDenominator>1.5e+06</MaxScaleDenominator>
      </Layer>`),
    )
    expect(caps.layers[0].scale?.minRes).toBeCloseTo(750001 * PX_M, 3)
    expect(caps.layers[0].scale?.maxRes).toBeCloseTo(1_500_000 * PX_M, 3)
  })

  it('leaves the opposite side unbounded when only one denominator exists', () => {
    const caps = parseCapabilities(
      withLayer(`<Layer>
        <Name>basemap_500m</Name><Title>500 m</Title>
        <MaxScaleDenominator>350000</MaxScaleDenominator>
      </Layer>`),
    )
    expect(caps.layers[0].scale).toEqual({ minRes: 0, maxRes: 350000 * PX_M })
  })

  it('falls back to WMS 1.1.1 ScaleHint (pixel diagonal → resolution)', () => {
    const caps = parseCapabilities(
      withLayer(`<Layer>
        <Name>l</Name><Title>l</Title>
        <ScaleHint min="100" max="500"/>
      </Layer>`),
    )
    expect(caps.layers[0].scale?.minRes).toBeCloseTo(100 / Math.SQRT2, 6)
    expect(caps.layers[0].scale?.maxRes).toBeCloseTo(500 / Math.SQRT2, 6)
  })

  it('omits the band for unconstrained layers', () => {
    const caps = parseCapabilities(
      withLayer(`<Layer><Name>l</Name><Title>l</Title></Layer>`),
    )
    expect(caps.layers[0].scale).toBeUndefined()
  })
})

describe('scale band helpers', () => {
  it('classifies resolution as too-coarse / too-fine / in-range', () => {
    const band = { minRes: 200, maxRes: 400 }
    expect(scaleBandState(band, 1000)).toBe('zoom-in') // too zoomed out
    expect(scaleBandState(band, 100)).toBe('zoom-out') // too zoomed in
    expect(scaleBandState(band, 300)).toBe('in-range')
    expect(scaleBandState(band, 400)).toBe('zoom-in') // max exclusive
    expect(scaleBandState(band, 200)).toBe('in-range') // min inclusive
  })

  it('intersects two bands — a pair shows only where both do', () => {
    expect(
      combineScaleBands(
        { minRes: 200, maxRes: 400 },
        { minRes: 300, maxRes: 800 },
      ),
    ).toEqual({ minRes: 300, maxRes: 400 })
    expect(combineScaleBands(undefined, { minRes: 1, maxRes: 2 })).toEqual({
      minRes: 1,
      maxRes: 2,
    })
    expect(combineScaleBands(undefined, undefined)).toBeUndefined()
  })

  it('targets a resolution inside the band', () => {
    expect(scaleBandTargetResolution({ minRes: 200, maxRes: 400 })).toBeCloseTo(
      Math.sqrt(200 * 400),
    )
    expect(scaleBandTargetResolution({ minRes: 0, maxRes: 400 })).toBe(200)
    expect(scaleBandTargetResolution({ minRes: 200, maxRes: Infinity })).toBe(
      400,
    )
  })
})

describe('skinnyWmsBasemap', () => {
  const layer = (name: string, title = name): ParsedLayer => ({
    name,
    title,
    styles: [],
  })

  it('splits the background from line-style reference layers', () => {
    const { background, reference } = skinnyWmsBasemap([
      layer('background', 'Background'),
      layer('foreground', 'Foreground'),
      layer('coastlines', 'Coastlines'),
      layer('land', 'Land'), // area fill — dropped
      layer('oceans', 'Oceans'), // area fill — dropped
    ])
    expect(background?.name).toBe('background')
    expect(reference.map((l) => l.name)).toEqual(['foreground', 'coastlines'])
  })

  it('matches decoration layers by normalised title as well as name', () => {
    const { reference } = skinnyWmsBasemap([layer('layer_42', 'US States')])
    expect(reference.map((l) => l.name)).toEqual(['layer_42'])
  })

  it('returns null background when none is advertised', () => {
    expect(skinnyWmsBasemap([]).background).toBeNull()
  })
})

describe('parseWmsTimestamp', () => {
  it('assumes UTC only when a date-time lacks a zone', () => {
    const utc = Date.UTC(2026, 5, 10, 6)
    expect(parseWmsTimestamp('2026-06-10T06:00:00')).toBe(utc)
    expect(parseWmsTimestamp('2026-06-10T06:00:00Z')).toBe(utc)
    expect(parseWmsTimestamp('2026-06-10T08:00:00+02:00')).toBe(utc)
    expect(parseWmsTimestamp('2026-06-10')).toBe(Date.UTC(2026, 5, 10))
    expect(Number.isNaN(parseWmsTimestamp('not-a-date'))).toBe(true)
  })
})

describe('expandTimeSteps', () => {
  it('returns [] for empty input', () => {
    expect(expandTimeSteps('')).toEqual([])
    expect(expandTimeSteps('   ')).toEqual([])
  })

  it('passes through literal comma-separated timestamps', () => {
    expect(
      expandTimeSteps('2026-06-10T06:00:00Z, 2026-06-10T12:00:00Z'),
    ).toEqual(['2026-06-10T06:00:00Z', '2026-06-10T12:00:00Z'])
  })

  it('expands an ISO interval with a period', () => {
    expect(
      expandTimeSteps('2026-06-10T00:00:00Z/2026-06-10T18:00:00Z/PT6H'),
    ).toEqual([
      '2026-06-10T00:00:00.000Z',
      '2026-06-10T06:00:00.000Z',
      '2026-06-10T12:00:00.000Z',
      '2026-06-10T18:00:00.000Z',
    ])
  })

  // Pins the UTC doctrine on a non-UTC host: zone-less values shifted by
  // the host offset would mint instants the server never advertised.
  it('reads zone-less date-times as UTC (WMS Annex D)', () => {
    expect(
      expandTimeSteps('2026-06-10T06:00:00/2026-06-10T18:00:00/PT6H'),
    ).toEqual([
      '2026-06-10T06:00:00.000Z',
      '2026-06-10T12:00:00.000Z',
      '2026-06-10T18:00:00.000Z',
    ])
  })

  it('normalizes explicit offsets to UTC', () => {
    expect(
      expandTimeSteps(
        '2026-06-10T08:00:00+02:00/2026-06-10T14:00:00+02:00/PT6H',
      ),
    ).toEqual(['2026-06-10T06:00:00.000Z', '2026-06-10T12:00:00.000Z'])
  })

  it('expands mixed literal + interval segments', () => {
    expect(
      expandTimeSteps(
        '2026-06-09T18:00:00Z,2026-06-10T00:00:00Z/2026-06-10T06:00:00Z/PT6H',
      ),
    ).toEqual([
      '2026-06-09T18:00:00Z',
      '2026-06-10T00:00:00.000Z',
      '2026-06-10T06:00:00.000Z',
    ])
  })

  it('steps whole-month periods on the calendar (no drift)', () => {
    // A fixed 30.4375-day month drifts off the server's advertised
    // instants — satellite archives (P1M over decades) then 404.
    expect(expandTimeSteps('2025-11-01/2026-02-01/P1M')).toEqual([
      '2025-11-01T00:00:00.000Z',
      '2025-12-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    ])
  })

  it('falls back to the raw segment when the interval is malformed', () => {
    expect(expandTimeSteps('not-a-date/also-not/PT6H')).toEqual([
      'not-a-date/also-not/PT6H',
    ])
    expect(
      expandTimeSteps('2026-06-10T00:00:00Z/2026-06-10T06:00:00Z/NOPE'),
    ).toEqual(['2026-06-10T00:00:00Z/2026-06-10T06:00:00Z/NOPE'])
    expect(expandTimeSteps('a/b')).toEqual(['a/b'])
  })
})

describe('rebaseLensUrl', () => {
  it('grafts the upstream path and query onto the base URL', () => {
    expect(
      rebaseLensUrl(
        'http://0.0.0.0:54321/wms?service=WMS&request=GetMap',
        'http://localhost:54321',
      ),
    ).toBe('http://localhost:54321/wms?service=WMS&request=GetMap')
  })

  it('tolerates a trailing slash on the base URL', () => {
    expect(
      rebaseLensUrl('http://0.0.0.0:54321/legend?layer=2t', 'http://h:1/'),
    ).toBe('http://h:1/legend?layer=2t')
  })

  it('returns the input unchanged when it is not an absolute URL', () => {
    expect(rebaseLensUrl('not a url', 'http://h:1')).toBe('not a url')
  })

  it('keeps advertised URLs verbatim for external (non-bare-origin) bases', () => {
    // ecCharts-style base with path + token query: grafting would produce
    // /wms/?token=…/wms/?token=…&request=GetLegend… — a garbage URL.
    const advertised =
      'https://eccharts.ecmwf.int/wms/?token=public&request=GetLegend&layers=z500'
    expect(
      rebaseLensUrl(advertised, 'https://eccharts.ecmwf.int/wms/?token=public'),
    ).toBe(advertised)
  })
})

describe('groupLayers', () => {
  const layer = (name: string, title: string): ParsedLayer => ({
    name,
    title,
    styles: [],
  })

  it('groups pressure-level variants detected from titles, sorted descending', () => {
    const groups = groupLayers([
      layer('q@pl_500', 'Specific humidity at 500 hPa'),
      layer('q@pl_850', 'Specific humidity at 850 hPa'),
      layer('q@pl_300', 'Specific humidity at 300 hPa'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('Specific humidity')
    expect(groups[0].levelUnit).toBe('hPa')
    expect(groups[0].entries.map((e) => e.level)).toEqual([850, 500, 300])
  })

  it('groups by name suffix and humanises short codes when titles carry no level', () => {
    const groups = groupLayers([
      layer('q@pl_500', 'q@pl_500'),
      layer('q@pl_850', 'q@pl_850'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('Specific humidity')
    expect(groups[0].subtitle).toBe('q@pl')
    expect(groups[0].entries.map((e) => e.level)).toEqual([850, 500])
  })

  it('keeps unleveled layers as single-entry groups', () => {
    const groups = groupLayers([layer('2t', '2 m temperature')])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('2 m temperature')
    expect(groups[0].entries).toEqual([
      { level: null, layer: layer('2t', '2 m temperature') },
    ])
  })
})

describe('partitionGroups / uniquePressureLevels', () => {
  const groups = groupLayers([
    { name: 'q@pl_500', title: 'Specific humidity at 500 hPa', styles: [] },
    { name: 'q@pl_850', title: 'Specific humidity at 850 hPa', styles: [] },
    { name: 't@pl_300', title: 'Temperature at 300 hPa', styles: [] },
    { name: 't@pl_500', title: 'Temperature at 500 hPa', styles: [] },
    { name: 'msl', title: 'Mean sea level pressure', styles: [] },
    { name: '2t', title: '2 m temperature', styles: [] },
  ])

  it('splits multi-level from single groups, each sorted by title', () => {
    const { singles, multiLevel } = partitionGroups(groups)
    expect(singles.map((g) => g.title)).toEqual([
      '2 m temperature',
      'Mean sea level pressure',
    ])
    expect(multiLevel.map((g) => g.title)).toEqual([
      'Specific humidity',
      'Temperature',
    ])
  })

  it('collects the union of pressure levels, descending', () => {
    expect(uniquePressureLevels(groups)).toEqual([850, 500, 300])
  })
})

describe('toWmsEndpoint / appendWmsParams', () => {
  it('appends /wms to bare origins (the lens convention)', () => {
    expect(toWmsEndpoint('http://localhost:19000')).toBe(
      'http://localhost:19000/wms',
    )
    expect(toWmsEndpoint('http://localhost:19000/')).toBe(
      'http://localhost:19000/wms',
    )
  })

  it('keeps full endpoints with a path and/or query verbatim', () => {
    expect(toWmsEndpoint('https://eccharts.ecmwf.int/wms/?token=public')).toBe(
      'https://eccharts.ecmwf.int/wms/?token=public',
    )
    expect(toWmsEndpoint('https://geo.example.org/geoserver/ows')).toBe(
      'https://geo.example.org/geoserver/ows',
    )
    expect(toWmsEndpoint('http://host:1/?foo=bar')).toBe(
      'http://host:1/?foo=bar',
    )
  })

  it('passes non-URL input through unchanged', () => {
    expect(toWmsEndpoint('not a url')).toBe('not a url')
  })

  it('joins params with the correct separator', () => {
    expect(appendWmsParams('http://h/wms', 'request=GetCapabilities')).toBe(
      'http://h/wms?request=GetCapabilities',
    )
    expect(
      appendWmsParams('http://h/wms?token=x', 'request=GetCapabilities'),
    ).toBe('http://h/wms?token=x&request=GetCapabilities')
  })
})

describe('isLoopbackUrl', () => {
  it('recognises our lens hosts', () => {
    expect(isLoopbackUrl('http://localhost:54301/wms')).toBe(true)
    expect(isLoopbackUrl('http://127.0.0.1:8080')).toBe(true)
    expect(isLoopbackUrl('http://[::1]:9000/x')).toBe(true)
  })

  it('rejects external servers and junk', () => {
    expect(isLoopbackUrl('https://maps.dwd.de/geoserver/ows?')).toBe(false)
    expect(isLoopbackUrl('https://localhost.evil.example')).toBe(false)
    expect(isLoopbackUrl('not a url')).toBe(false)
  })
})

describe('fetchCapabilities', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** fetch stub that never responds but honours abort, like a hung server. */
  const stubHungFetch = () =>
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal!.reason),
          )
        }),
    )

  it('parses a served document', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(capabilitiesXml(), { status: 200 })),
    )
    const parsed = await fetchCapabilities('http://localhost:9999')
    expect(parsed.layers.length).toBeGreaterThan(0)
  })

  it('surfaces HTTP errors with the status', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response('nope', { status: 503 })),
    )
    await expect(fetchCapabilities('http://localhost:9999')).rejects.toThrow(
      'GetCapabilities 503',
    )
  })

  it('times out when the server never responds', async () => {
    stubHungFetch()
    await expect(
      fetchCapabilities('http://localhost:9999', undefined, { responseMs: 50 }),
    ).rejects.toSatisfy(
      (err) => err instanceof CapabilitiesError && err.kind === 'timeout',
    )
  })

  it('caller cancellation stays an abort, never a timeout', async () => {
    stubHungFetch()
    const controller = new AbortController()
    const pending = fetchCapabilities(
      'http://localhost:9999',
      controller.signal,
      {
        responseMs: 5000,
      },
    )
    controller.abort()
    await expect(pending).rejects.toSatisfy(
      (err) =>
        !(err instanceof CapabilitiesError) &&
        (err as DOMException).name === 'AbortError',
    )
  })

  /** Response whose body streams under test control. */
  const streamedResponse = (
    feed: (
      push: (text: string) => void,
      fail: (err: unknown) => void,
      close: () => void,
    ) => void,
  ) => {
    const encoder = new TextEncoder()
    return new Response(
      new ReadableStream({
        start(ctrl) {
          feed(
            (text) => ctrl.enqueue(encoder.encode(text)),
            (err) => ctrl.error(err),
            () => ctrl.close(),
          )
        },
      }),
      { status: 200 },
    )
  }

  it('times out when the download stalls mid-stream', async () => {
    vi.stubGlobal('fetch', () =>
      // One chunk, then silence — never closed.
      Promise.resolve(streamedResponse((push) => push('<WMS_Capabilities>'))),
    )
    await expect(
      fetchCapabilities('http://localhost:9999', undefined, { stallMs: 50 }),
    ).rejects.toSatisfy(
      (err) =>
        err instanceof CapabilitiesError &&
        err.kind === 'timeout' &&
        err.message.includes('stalled'),
    )
  })

  it('a slow but flowing download outlives every fixed deadline', async () => {
    const parts = capabilitiesXml().match(/[\s\S]{1,500}/g)!
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        streamedResponse((push, _fail, close) => {
          // Trickle: total time far exceeds stallMs, gaps never do.
          parts.forEach((part, i) => setTimeout(() => push(part), i * 30))
          setTimeout(close, parts.length * 30)
        }),
      ),
    )
    const parsed = await fetchCapabilities('http://localhost:9999', undefined, {
      stallMs: 120,
    })
    expect(parsed.layers.length).toBeGreaterThan(0)
  })

  it('maps a transport death mid-download to `interrupted`', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        streamedResponse((push, fail) => {
          push('<WMS_Capabilities>')
          setTimeout(() => fail(new TypeError('network error')), 10)
        }),
      ),
    )
    await expect(fetchCapabilities('http://localhost:9999')).rejects.toSatisfy(
      (err) => err instanceof CapabilitiesError && err.kind === 'interrupted',
    )
  })
})
