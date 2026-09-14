/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Curated links for the Overview's community card; edit here to update. */
export interface NewsLink {
  title: string
  url: string
  /** Publisher or venue, shown as the meta line. */
  source: string
  /** Year or ISO date when known; shown verbatim. */
  date?: string
}

export const PRESS_ITEMS: ReadonlyArray<NewsLink> = [
  {
    title: 'Bris and Forecast-in-a-Box: applications and results for Malawi',
    url: 'https://events.ecmwf.int/event/488/contributions/5644/attachments/3621/6073/ECMWF-ESA-WS_Ostvand.pdf',
    source: 'ECMWF–ESA workshop',
  },
  {
    title: 'WMO supports artificial intelligence forecasting pilot in Africa',
    url: 'https://wmo.int/media/news/wmo-supports-artificial-intelligence-forecasting-pilot-africa',
    source: 'WMO',
  },
  {
    title:
      'Forecast-in-a-Box: portable AI forecasting workflows within the DestinE Digital Twin Engine',
    url: 'https://destine.ecmwf.int/news/forecast-in-a-box-portable-ai-forecasting-workflows-within-the-destine-digital-twin-engine',
    source: 'Destination Earth',
  },
  {
    title:
      'Simplifying AI for weather forecasting with the European Weather Cloud',
    url: 'https://www.ecmwf.int/en/about/media-centre/science-blog/2025/simplifying-ai-weather-forecasting-european-weather-cloud',
    source: 'ECMWF science blog',
    date: '2025',
  },
  {
    title:
      'Significant update to key forecasting systems IFS and AIFS goes live',
    url: 'https://www.ecmwf.int/en/about/media-centre/news/2026/ifs-cycle-50r1-aifsv2-live',
    source: 'ECMWF news',
    date: '2026',
  },
  {
    title: 'AIFS: a new ECMWF forecasting system',
    url: 'https://www.ecmwf.int/en/newsletter/178/news/aifs-new-ecmwf-forecasting-system',
    source: 'ECMWF Newsletter 178',
    date: '2024',
  },
  {
    title: 'AIFS paper (arXiv 2406.01465)',
    url: 'https://arxiv.org/abs/2406.01465',
    source: 'arXiv',
    date: '2024',
  },
]

export const MATERIAL_ITEMS: ReadonlyArray<NewsLink> = [
  {
    title: 'Forecast-in-a-Box as a DestinE application',
    url: 'https://events.ecmwf.int/event/495/contributions/5756/attachments/3484/5865/DestinE%20application%20-%20FIAB.pdf',
    source: 'Presentation, ECMWF events',
  },
  {
    title: 'EGU 2026 abstract',
    url: 'https://meetingorganizer.copernicus.org/EGU26/EGU26-20013.html',
    source: 'EGU General Assembly',
    date: '2026',
  },
  {
    title: 'EGU 2026 presentation',
    url: 'https://presentations.copernicus.org/EGU26/EGU26-20013_supplement.pdf',
    source: 'EGU General Assembly',
    date: '2026',
  },
]

export const COMMUNITY_ITEMS: ReadonlyArray<NewsLink> = [
  {
    title: 'Report an issue',
    url: 'https://github.com/ecmwf/forecast-in-a-box/issues',
    source: 'GitHub issues',
  },
  {
    title: 'Contribute on GitHub',
    url: 'https://github.com/ecmwf/forecast-in-a-box',
    source: 'Source code and documentation',
  },
  {
    title: 'ECMWF community forum',
    url: 'https://forum.ecmwf.int',
    source: 'Questions and discussion',
  },
]
