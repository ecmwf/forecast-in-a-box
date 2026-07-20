/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

export interface CuratedWmsServer {
  name: string
  url: string
}

/** Edit freely — one line per server. A backend API replaces this later. */
export const CURATED_WMS_SERVERS: ReadonlyArray<CuratedWmsServer> = [
  { name: 'DWD', url: 'https://maps.dwd.de/geoserver/ows?' },
  { name: 'ECMWF', url: 'https://eccharts.ecmwf.int/wms/?token=public' },
  { name: 'EUMETSAT', url: 'https://view.eumetsat.int/geoserver/wms?' },
  { name: 'FMI', url: 'https://openwms.fmi.fi/geoserver/wms?' },
  {
    name: 'Harmonie DET DINI',
    url: 'https://geoservices.knmi.nl/adagucserver?dataset=uwcw-ha-det-dini-5p5km',
  },
  {
    name: 'Harmonie ENS NL',
    url: 'https://geoservices.knmi.nl/adagucserver?dataset=uwcw-ha-ens-nl-2km',
  },
  {
    name: 'KNMI Observations',
    url: 'https://geoservices.knmi.nl/adagucserver?dataset=OBS',
  },
  {
    name: 'KNMI Radar',
    url: 'https://geoservices.knmi.nl/adagucserver?dataset=RADAR',
  },
  {
    name: 'NOAA Tropical Cyclones',
    url: 'https://mapservices.weather.noaa.gov/tropical/services/tropical/NHC_tropical_weather/MapServer/WMSServer?',
  },
  { name: 'Victoria WMS', url: 'https://victoria.met.no/wms?' },
]

/** API seam — swap the static list for a backend query here. */
export function useCuratedWmsServers(): ReadonlyArray<CuratedWmsServer> {
  return CURATED_WMS_SERVERS
}
