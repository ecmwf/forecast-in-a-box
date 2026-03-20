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
 * MSW Handlers for Artifacts API
 *
 * Mock handlers for ML model artifact management:
 * - GET /api/v1/artifacts/list_models
 * - POST /api/v1/artifacts/model_details
 * - POST /api/v1/artifacts/download_model
 * - POST /api/v1/artifacts/delete_model
 *
 * The download handler simulates the real backend's async behaviour:
 * the first call starts a background "download" and returns progress 0;
 * subsequent polls return increasing progress until 100 ("available").
 */

import { HttpResponse, delay, http } from 'msw'
import type {
  CompositeArtifactId,
  MlModelDetail,
  MlModelOverview,
} from '@/api/types/artifacts.types'
import { API_ENDPOINTS } from '@/api/endpoints'

const mockModels: Array<MlModelDetail> = [
  {
    composite_id: {
      artifact_store_id: 'ecmwf',
      ml_model_checkpoint_id: 'aifs-single-v0.2.1',
    },
    display_name: 'AIFS Single',
    display_author: 'ECMWF',
    disk_size_bytes: 2_147_483_648,
    supported_platforms: ['cpu', 'cuda'],
    is_available: true,
    display_description:
      'ECMWF Artificial Intelligence Forecasting System (AIFS) single model for medium-range weather prediction.',
    url: 'https://www.ecmwf.int/en/forecasts/documentation-and-support',
    pip_package_constraints: ['torch>=2.0.0', 'numpy>=1.24.0'],
    output_characteristics: {
      variables: ['temperature', 'wind_speed', 'pressure'],
      resolution: '0.25 degrees',
      lead_time: '10 days',
    },
    input_characteristics: {
      variables: ['temperature', 'wind_speed', 'pressure', 'humidity'],
      resolution: '0.25 degrees',
    },
  },
  {
    composite_id: {
      artifact_store_id: 'ecmwf',
      ml_model_checkpoint_id: 'aifs-ensemble-v0.1.0',
    },
    display_name: 'AIFS Ensemble',
    display_author: 'ECMWF',
    disk_size_bytes: 4_294_967_296,
    supported_platforms: ['cuda'],
    is_available: false,
    display_description:
      'ECMWF AIFS ensemble model for probabilistic weather forecasting with multiple ensemble members.',
    url: null,
    pip_package_constraints: ['torch>=2.0.0', 'numpy>=1.24.0'],
    output_characteristics: {
      variables: ['temperature', 'wind_speed', 'pressure'],
      resolution: '0.25 degrees',
      ensemble_members: 50,
    },
    input_characteristics: {
      variables: ['temperature', 'wind_speed', 'pressure', 'humidity'],
      resolution: '0.25 degrees',
    },
  },
  {
    composite_id: {
      artifact_store_id: 'community',
      ml_model_checkpoint_id: 'pangu-weather-v1.0',
    },
    display_name: 'Pangu-Weather',
    display_author: 'Huawei Cloud',
    disk_size_bytes: 1_073_741_824,
    supported_platforms: ['cpu', 'cuda', 'rocm'],
    is_available: true,
    display_description:
      'Pangu-Weather model for global weather forecasting using 3D Earth-specific transformer architecture.',
    url: 'https://github.com/198808xc/Pangu-Weather',
    pip_package_constraints: ['onnxruntime>=1.14.0'],
    output_characteristics: {
      variables: ['geopotential', 'temperature', 'humidity', 'wind'],
      resolution: '0.25 degrees',
      lead_time: '7 days',
    },
    input_characteristics: {
      variables: ['geopotential', 'temperature', 'humidity', 'wind'],
      resolution: '0.25 degrees',
    },
  },
  {
    composite_id: {
      artifact_store_id: 'community',
      ml_model_checkpoint_id: 'graphcast-v0.1',
    },
    display_name: 'GraphCast',
    display_author: 'Google DeepMind',
    disk_size_bytes: 3_221_225_472,
    supported_platforms: ['cuda'],
    is_available: false,
    display_description:
      'GraphCast: Learning skillful medium-range global weather forecasting using graph neural networks.',
    url: 'https://github.com/google-deepmind/graphcast',
    pip_package_constraints: ['jax>=0.4.0', 'jraph>=0.0.6'],
    output_characteristics: {
      variables: ['temperature', 'wind', 'pressure', 'humidity'],
      resolution: '0.25 degrees',
      lead_time: '10 days',
    },
    input_characteristics: {
      variables: ['temperature', 'wind', 'pressure', 'humidity'],
      resolution: '0.25 degrees',
    },
  },
]

function artifactKey(id: CompositeArtifactId): string {
  return `${id.artifact_store_id}::${id.ml_model_checkpoint_id}`
}

/** Mimic Python's str(CompositeArtifactId(...)) repr format used by the backend */
function compositeIdStr(id: CompositeArtifactId): string {
  return `CompositeArtifactId(artifact_store_id='${id.artifact_store_id}', ml_model_checkpoint_id='${id.ml_model_checkpoint_id}')`
}

function findModel(id: CompositeArtifactId) {
  return mockModels.find(
    (m) =>
      m.composite_id.artifact_store_id === id.artifact_store_id &&
      m.composite_id.ml_model_checkpoint_id === id.ml_model_checkpoint_id,
  )
}

/**
 * Tracks simulated download progress per model.
 * Each call to download_model advances progress by a random increment,
 * mimicking the real backend's chunked-download polling behaviour.
 */
const ongoingDownloads = new Map<string, number>()

/** Advance progress by 20-40% per poll, capped at 100. */
function advanceProgress(key: string): number {
  const current = ongoingDownloads.get(key) ?? 0
  const increment = 20 + Math.random() * 20
  const next = Math.min(100, Math.round(current + increment))
  if (next >= 100) {
    ongoingDownloads.delete(key)
  } else {
    ongoingDownloads.set(key, next)
  }
  return next
}

export const artifactsHandlers = [
  // GET /api/v1/artifacts/list_models
  http.get(API_ENDPOINTS.artifacts.listModels, async () => {
    await delay(300)

    const overviews: Array<MlModelOverview> = mockModels.map(
      ({
        display_description,
        url,
        pip_package_constraints,
        output_characteristics,
        input_characteristics,
        ...overview
      }) => overview,
    )

    return HttpResponse.json(overviews)
  }),

  // POST /api/v1/artifacts/model_details
  http.post(API_ENDPOINTS.artifacts.modelDetails, async ({ request }) => {
    await delay(200)
    const body = (await request.json()) as CompositeArtifactId

    const model = findModel(body)
    if (!model) {
      return new HttpResponse(JSON.stringify({ detail: 'Model not found' }), {
        status: 404,
      })
    }

    return HttpResponse.json(model)
  }),

  // POST /api/v1/artifacts/download_model
  //
  // Simulates the real backend: first call starts the "download" (progress 0),
  // subsequent calls return increasing progress, final call returns "available"
  // with progress 100 and flips is_available to true.
  http.post(API_ENDPOINTS.artifacts.downloadModel, async ({ request }) => {
    await delay(200)
    const body = (await request.json()) as CompositeArtifactId

    const model = findModel(body)
    if (!model) {
      return new HttpResponse(JSON.stringify({ detail: 'Model not found' }), {
        status: 404,
      })
    }

    // Already available locally
    if (model.is_available) {
      return HttpResponse.json({
        status: 'available',
        composite_id: compositeIdStr(body),
        progress: 100,
      })
    }

    const key = artifactKey(body)
    const isNew = !ongoingDownloads.has(key)

    if (isNew) {
      // First call: submit download, start at 0
      ongoingDownloads.set(key, 0)
      return HttpResponse.json({
        status: 'download submitted',
        composite_id: compositeIdStr(body),
        progress: 0,
      })
    }

    // Subsequent calls: advance progress
    const progress = advanceProgress(key)
    if (progress >= 100) {
      model.is_available = true
      return HttpResponse.json({
        status: 'available',
        composite_id: compositeIdStr(body),
        progress: 100,
      })
    }

    return HttpResponse.json({
      status: 'download in progress',
      composite_id: body,
      progress,
    })
  }),

  // POST /api/v1/artifacts/delete_model
  http.post(API_ENDPOINTS.artifacts.deleteModel, async ({ request }) => {
    await delay(500)
    const body = (await request.json()) as CompositeArtifactId

    const model = findModel(body)
    if (!model) {
      return new HttpResponse(JSON.stringify({ detail: 'Model not found' }), {
        status: 404,
      })
    }

    model.is_available = false

    return HttpResponse.json({
      status: 'deleted',
      composite_id: body,
    })
  }),
]
