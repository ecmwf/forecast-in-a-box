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
  QubeNode,
} from '@/api/types/artifacts.types'
import { API_ENDPOINTS } from '@/api/endpoints'

/**
 * Build a realistic qube fixture mirroring the shape served by the backend
 * for an AIFS-style model: one `pl` branch with parameters × pressure levels,
 * and one `sfc` branch with surface parameters and no further dimensions.
 */
function buildAifsQube({
  pressureParams,
  pressureLevels,
  surfaceParams,
}: {
  pressureParams: Array<string>
  pressureLevels: Array<number>
  surfaceParams: Array<string>
}): QubeNode {
  return {
    key: 'root',
    values: { type: 'enum', dtype: 'str', values: ['root'] },
    metadata: {},
    children: [
      {
        key: 'levtype',
        values: { type: 'enum', dtype: 'str', values: ['pl'] },
        metadata: {
          name: { shape: [1, 1, 1], dtype: 'str', values: ['pressure'] },
        },
        children: [
          {
            key: 'param',
            values: { type: 'enum', dtype: 'str', values: pressureParams },
            metadata: {},
            children: [
              {
                key: 'level',
                values: {
                  type: 'enum',
                  dtype: 'int64',
                  values: pressureLevels,
                },
                metadata: {},
                children: [],
              },
            ],
          },
        ],
      },
      {
        key: 'levtype',
        values: { type: 'enum', dtype: 'str', values: ['sfc'] },
        metadata: {
          name: { shape: [1, 1, 1], dtype: 'str', values: ['surface'] },
        },
        children: [
          {
            key: 'param',
            values: { type: 'enum', dtype: 'str', values: surfaceParams },
            metadata: {},
            children: [],
          },
        ],
      },
    ],
  }
}

const STANDARD_PRESSURE_LEVELS = [
  50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 850, 925, 1000,
]
const STANDARD_PRESSURE_PARAMS = ['q', 't', 'u', 'v', 'w', 'z']
const STANDARD_SURFACE_PARAMS = [
  '10u',
  '10v',
  '2d',
  '2t',
  'cp',
  'msl',
  'skt',
  'sp',
  'tcw',
  'tp',
]
const EXTENDED_SURFACE_PARAMS = [
  '100u',
  '100v',
  '10u',
  '10v',
  '2d',
  '2t',
  'cp',
  'hcc',
  'lcc',
  'mcc',
  'msl',
  'ro',
  'sf',
  'skt',
  'sp',
  'ssrd',
  'stl1',
  'stl2',
  'strd',
  'swvl1',
  'swvl2',
  'tcc',
  'tcw',
  'tp',
]

/**
 * Build a non-AIFS qube fixture mirroring the canonical compressed-tree
 * example from the qubed docs (class → expver → param). Routes the renderer
 * to the generic compressed-tree view rather than the matrix.
 */
function buildGenericQube(): QubeNode {
  return {
    key: 'root',
    values: { type: 'enum', dtype: 'str', values: ['root'] },
    metadata: {},
    children: [
      {
        key: 'class',
        values: { type: 'enum', dtype: 'str', values: ['od'] },
        metadata: {},
        children: [
          {
            key: 'expver',
            values: { type: 'enum', dtype: 'str', values: ['0001', '0002'] },
            metadata: {},
            children: [
              {
                key: 'param',
                values: { type: 'enum', dtype: 'int64', values: [1, 2] },
                metadata: {},
                children: [],
              },
            ],
          },
        ],
      },
      {
        key: 'class',
        values: { type: 'enum', dtype: 'str', values: ['rd'] },
        metadata: {},
        children: [
          {
            key: 'expver',
            values: { type: 'enum', dtype: 'str', values: ['0001'] },
            metadata: {},
            children: [
              {
                key: 'param',
                values: { type: 'enum', dtype: 'int64', values: [1, 2, 3] },
                metadata: {},
                children: [],
              },
            ],
          },
          {
            key: 'expver',
            values: { type: 'enum', dtype: 'str', values: ['0002'] },
            metadata: {},
            children: [
              {
                key: 'param',
                values: { type: 'enum', dtype: 'int64', values: [1, 2] },
                metadata: {},
                children: [],
              },
            ],
          },
        ],
      },
    ],
  }
}

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
    output_characteristics: buildAifsQube({
      pressureParams: STANDARD_PRESSURE_PARAMS,
      pressureLevels: STANDARD_PRESSURE_LEVELS,
      surfaceParams: STANDARD_SURFACE_PARAMS,
    }),
    input_characteristics: [
      'input_source',
      'lead_time',
      'base_time',
      'anemoi_kwargs',
    ],
    timestep: '6h',
  },
  {
    composite_id: {
      artifact_store_id: 'ecmwf',
      ml_model_checkpoint_id: 'aifs-single-mse-1.1_w_sdpa',
    },
    display_name: 'AIFS Single MSE 1.1',
    display_author: 'ECMWF',
    disk_size_bytes: 993_937_386,
    supported_platforms: ['linux', 'macos'],
    is_available: false,
    display_description:
      'ECMWF AIFS single MSE 1.1 model with scaled-dot-product attention for medium-range weather forecasting.',
    url: 'https://sites.ecmwf.int/repository/fiab/aifs/aifs-single-mse-1.1_sdpa.ckpt',
    pip_package_constraints: [
      'anemoi-models==0.4.2',
      'torch>=2.6.0',
      'torch_geometric==2.4.0',
    ],
    output_characteristics: buildAifsQube({
      pressureParams: STANDARD_PRESSURE_PARAMS,
      pressureLevels: STANDARD_PRESSURE_LEVELS,
      surfaceParams: EXTENDED_SURFACE_PARAMS,
    }),
    input_characteristics: [
      'input_source',
      'lead_time',
      'base_time',
      'anemoi_kwargs',
    ],
    timestep: '6h',
  },
  {
    composite_id: {
      artifact_store_id: 'ecmwf',
      ml_model_checkpoint_id: 'aifs-ens-crps-1.0_w_sdpa',
    },
    display_name: 'AIFS ENS CRPS 1.0',
    display_author: 'ECMWF',
    disk_size_bytes: 921_584_533,
    supported_platforms: ['linux', 'macos'],
    is_available: true,
    display_description:
      'ECMWF AIFS ensemble CRPS-trained model with scaled-dot-product attention for probabilistic forecasts.',
    url: 'https://sites.ecmwf.int/repository/fiab/aifs/aifs-ens-crps-1.0_sdpa.ckpt',
    pip_package_constraints: [
      'anemoi-models==0.6.0',
      'torch>=2.6.0',
      'torch_geometric==2.4.0',
    ],
    // Legacy list[str] shape — exercises the back-compat render path until
    // the backend update propagates everywhere.
    output_characteristics: [
      '2t',
      '10u',
      '10v',
      'msl',
      'tp',
      't @ 1000/850/700/500/250 hPa',
    ],
    input_characteristics: [
      'input_source',
      'lead_time',
      'base_time',
      'ensemble_number',
      'anemoi_kwargs',
    ],
    timestep: '6h',
  },
  {
    composite_id: {
      artifact_store_id: 'ecmwf',
      ml_model_checkpoint_id: 'aifs-ens-v0.3.0',
    },
    display_name: 'AIFS ENS',
    display_author: 'ECMWF',
    disk_size_bytes: 3_221_225_472,
    supported_platforms: ['cuda'],
    is_available: false,
    display_description:
      'ECMWF AIFS large ensemble model for operational probabilistic weather forecasting at scale.',
    url: 'https://www.ecmwf.int/en/forecasts/documentation-and-support',
    pip_package_constraints: ['torch>=2.0.0', 'numpy>=1.24.0'],
    // Non-AIFS-shaped qube — exercises the generic compressed-tree dispatch.
    output_characteristics: buildGenericQube(),
    input_characteristics: [
      'input_source',
      'lead_time',
      'base_time',
      'ensemble_number',
      'anemoi_kwargs',
    ],
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

/**
 * Reset handler-scoped state between tests. Without this, a download left
 * mid-flight by test A will be seen by test B as "already in progress"
 * instead of starting fresh at 0. Called from `tests/setup.ts` in a global
 * `afterEach`.
 */
export function resetArtifactsHandlerState(): void {
  ongoingDownloads.clear()
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
        timestep,
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
