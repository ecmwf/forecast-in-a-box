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
 * Curated public WMS endpoints offered as one-click comparison sources.
 * All entries must be token-free and CORS-friendly; they flow through the
 * same probe → `wms:` entry path as hand-entered URLs. Attribution is
 * shown in the picker (and belongs on any exported material).
 *
 * Token-based catalogues (Copernicus Data Space / Sentinel Hub) need
 * per-deployment credentials — planned as a config-driven follow-up.
 */

export interface WmsPreset {
  id: string
  label: string
  url: string
  attribution: string
}

export const EXTERNAL_WMS_PRESETS: ReadonlyArray<WmsPreset> = [
  {
    id: 'eox-sentinel2-cloudless',
    label: 'Sentinel-2 cloudless (EOX)',
    url: 'https://tiles.maps.eox.at/wms',
    attribution:
      'Sentinel-2 cloudless by EOX IT Services GmbH (contains modified Copernicus Sentinel data)',
  },
  {
    id: 'nasa-gibs',
    label: 'NASA GIBS daily imagery',
    url: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    attribution: 'NASA EOSDIS Global Imagery Browse Services (GIBS)',
  },
]
