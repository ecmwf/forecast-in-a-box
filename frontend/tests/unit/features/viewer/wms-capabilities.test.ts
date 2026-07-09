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
import type { ParsedLayer } from '@/features/viewer/wms-capabilities'
import {
  appendWmsParams,
  expandTimeSteps,
  groupLayers,
  parseCapabilities,
  partitionGroups,
  rebaseLensUrl,
  skinnyWmsBasemap,
  toWmsEndpoint,
  uniquePressureLevels,
} from '@/features/viewer/wms-capabilities'

/** Minimal WMS 1.3.0 capabilities document in the shape SkinnyWMS emits. */
function capabilitiesXml({
  withBbox = true,
  withGetFeatureInfo = true,
}: { withBbox?: boolean; withGetFeatureInfo?: boolean } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Capability>
    <Request>
      <GetMap/>
      ${withGetFeatureInfo ? '<GetFeatureInfo/>' : ''}
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

  it('detects GetFeatureInfo support', () => {
    expect(parseCapabilities(capabilitiesXml()).supportsGetFeatureInfo).toBe(
      true,
    )
    expect(
      parseCapabilities(capabilitiesXml({ withGetFeatureInfo: false }))
        .supportsGetFeatureInfo,
    ).toBe(false)
  })

  it('throws on malformed XML', () => {
    expect(() => parseCapabilities('<WMS_Capabilities><unclosed')).toThrow()
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
