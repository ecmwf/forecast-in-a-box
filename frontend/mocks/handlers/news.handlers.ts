/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { HttpResponse, http } from 'msw'
import { STATIC_FILES } from '@/api/endpoints'

export const mockCommunityNews = {
  press: [
    {
      title: 'AIFS: a new ECMWF forecasting system',
      url: 'https://www.ecmwf.int/en/newsletter/178/news/aifs-new-ecmwf-forecasting-system',
      source: 'ECMWF Newsletter 178',
      date: '2024',
    },
  ],
  materials: [
    {
      title: 'EGU 2026 abstract',
      url: 'https://meetingorganizer.copernicus.org/EGU26/EGU26-20013.html',
      source: 'EGU General Assembly',
      date: '2026',
    },
  ],
  community: [
    {
      title: 'Report an issue',
      url: 'https://github.com/ecmwf/forecast-in-a-box/issues',
      source: 'GitHub issues',
    },
  ],
}

export const newsHandlers = [
  http.get(STATIC_FILES.communityNews, () =>
    HttpResponse.json(mockCommunityNews),
  ),
]
