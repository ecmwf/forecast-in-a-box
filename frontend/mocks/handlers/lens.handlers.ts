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
 * MSW Handlers for the Lens API (SkinnyWMS manager).
 */

import { HttpResponse, delay, http } from 'msw'
import {
  isSkinnyWmsInstalled,
  listMockLenses,
  pollMockLens,
  startMockLens,
  stopMockLens,
} from '../data/lens.data'
import { API_ENDPOINTS } from '@/api/endpoints'

export const lensHandlers = [
  http.post(API_ENDPOINTS.lens.startSkinnyWms, async ({ request }) => {
    await delay(50)
    if (!isSkinnyWmsInstalled()) {
      return HttpResponse.json(
        { detail: 'SkinnyWMS installation not found' },
        { status: 400 },
      )
    }
    const localPath = new URL(request.url).searchParams.get('local_path')
    if (!localPath) {
      return HttpResponse.json(
        { detail: 'Provided path does not exist' },
        { status: 400 },
      )
    }
    return HttpResponse.json(startMockLens(localPath))
  }),

  http.get(API_ENDPOINTS.lens.status, async ({ request }) => {
    await delay(50)
    const id = new URL(request.url).searchParams.get('lens_instance_id')
    const detail = id ? pollMockLens(id) : null
    if (!detail) {
      return HttpResponse.json(
        { detail: `Lens instance ${id ?? '?'} not found` },
        { status: 404 },
      )
    }
    return HttpResponse.json(detail)
  }),

  http.delete(API_ENDPOINTS.lens.stop, async ({ request }) => {
    await delay(50)
    const id = new URL(request.url).searchParams.get('lens_instance_id')
    if (!id || !stopMockLens(id)) {
      return HttpResponse.json(
        { detail: `Lens instance ${id ?? '?'} not found` },
        { status: 404 },
      )
    }
    return HttpResponse.json('ok')
  }),

  http.get(API_ENDPOINTS.lens.list, async () => {
    await delay(50)
    return HttpResponse.json(listMockLenses())
  }),

  http.get(API_ENDPOINTS.lens.supported, async () => {
    await delay(50)
    if (!isSkinnyWmsInstalled()) return HttpResponse.json([])
    return HttpResponse.json([
      {
        name: 'skinnyWMS',
        route: '/api/v1/lens/start/skinnyWMS',
        params: { local_path: 'str' },
      },
    ])
  }),
]
