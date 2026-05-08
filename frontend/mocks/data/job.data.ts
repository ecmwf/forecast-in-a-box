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
 * Mock data for job & execution API
 */

import type {
  CompilationDetailResponse,
  JobExecuteRequest,
  JobExecuteResponse,
  JobExecutionDetail,
} from '@/api/types/job.types'

const now = new Date()
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
const threeDaysAgo = new Date(
  now.getTime() - 3 * 24 * 60 * 60 * 1000,
).toISOString()

// ─── Execution mock state ─────────────────────────────────────────────────

let executionIdCounter = 200

let executionsState: Record<string, JobExecutionDetail> = {}

const seedExecutions: Array<JobExecutionDetail> = [
  {
    run_id: 'job-completed-001',
    attempt_count: 1,
    status: 'completed',
    created_at: threeDaysAgo,
    updated_at: threeDaysAgo,
    blueprint_id: 'def-001',
    blueprint_version: 1,
    error: null,
    progress: '100',
    cascade_job_id: 'cascade-001',
    outputs: {
      byTask: {
        'task-out-1': {
          mime_type: 'image/png',
          original_block: 'sink_temperature_map',
          is_available: true,
        },
        'task-out-2': {
          mime_type: 'application/pdf',
          original_block: 'sink_temperature_map',
          is_available: true,
        },
        'task-out-3': {
          mime_type: 'image/svg+xml',
          original_block: 'sink_wind_map',
          is_available: true,
        },
      },
      stored: {},
    },
    // Cache is popped on terminal status; both arrays come back null.
    completed_block_ids: null,
    planned_block_ids: null,
  },
  {
    run_id: 'job-running-002',
    attempt_count: 1,
    status: 'running',
    created_at: oneHourAgo,
    updated_at: oneHourAgo,
    blueprint_id: 'def-002',
    blueprint_version: 1,
    error: null,
    progress: '45',
    cascade_job_id: 'cascade-002',
    outputs: {
      byTask: {
        'task-out-4': {
          mime_type: 'image/png',
          original_block: 'sink_precipitation',
          is_available: false,
        },
      },
      stored: {},
    },
    completed_block_ids: ['block_source_1'],
    planned_block_ids: ['block_source_1', 'block_product_1', 'block_sink_1'],
  },
  {
    run_id: 'job-errored-003',
    attempt_count: 1,
    status: 'failed',
    created_at: twoHoursAgo,
    updated_at: twoHoursAgo,
    blueprint_id: 'def-003',
    blueprint_version: 1,
    error: 'Worker process exited with code 137 (OOM killed)',
    progress: '62',
    cascade_job_id: 'cascade-003',
    outputs: { byTask: {}, stored: {} },
    completed_block_ids: null,
    planned_block_ids: null,
  },
  {
    run_id: 'job-submitted-004',
    attempt_count: 1,
    status: 'submitted',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    blueprint_id: 'def-004',
    blueprint_version: 1,
    error: null,
    progress: '0',
    cascade_job_id: null,
    outputs: null,
  },
]

/** Test-only fixture for the mixed-availability filter case. Not added to
 * the default seed — inject it via {@link injectMockExecution} from the test
 * that needs it, so other seed-dependent tests stay deterministic. */
export const mixedAvailabilityExecution: JobExecutionDetail = {
  run_id: 'job-mixed-005',
  attempt_count: 1,
  status: 'preparing',
  created_at: oneHourAgo,
  updated_at: oneHourAgo,
  blueprint_id: 'def-005',
  blueprint_version: 1,
  error: null,
  progress: '70',
  cascade_job_id: 'cascade-005',
  outputs: {
    byTask: {
      'task-out-5a': {
        mime_type: 'image/png',
        original_block: 'sink_available',
        is_available: true,
      },
      'task-out-5b': {
        mime_type: 'image/png',
        original_block: 'sink_pending',
        is_available: false,
      },
    },
    stored: {},
  },
}

/** Test-only fixture: an available output whose wire mime is the opaque
 * `application/octet-stream` cascade uses for raw bytes. Its real type is
 * knowable only by sniffing the content — covers the sniff-then-filter path.
 * Inject it via {@link injectMockExecution}. */
export const opaqueMimeExecution: JobExecutionDetail = {
  run_id: 'job-opaque-006',
  attempt_count: 1,
  status: 'completed',
  created_at: oneHourAgo,
  updated_at: oneHourAgo,
  blueprint_id: 'def-006',
  blueprint_version: 1,
  error: null,
  progress: '100',
  cascade_job_id: 'cascade-006',
  outputs: {
    byTask: {
      'task-out-6': {
        mime_type: 'application/octet-stream',
        original_block: 'sink_opaque',
        is_available: true,
      },
    },
    stored: {},
  },
  completed_block_ids: null,
  planned_block_ids: null,
}

/** Terminal run with `outputs: null` — drives the backend's "no recorded
 * outputs yet" 500 from /run/outputContent. Inject via injectMockExecution. */
export const noStoredOutputsExecution: JobExecutionDetail = {
  run_id: 'job-no-outputs-007',
  attempt_count: 1,
  status: 'completed',
  created_at: oneHourAgo,
  updated_at: oneHourAgo,
  blueprint_id: 'def-007',
  blueprint_version: 1,
  error: null,
  progress: '100',
  cascade_job_id: 'cascade-007',
  outputs: null,
  completed_block_ids: null,
  planned_block_ids: null,
}

export function resetJobsState(): void {
  executionsState = {}
  executionIdCounter = 200
  for (const exec of seedExecutions) {
    executionsState[exec.run_id] = JSON.parse(
      JSON.stringify(exec),
    ) as JobExecutionDetail
  }
}

resetJobsState()

// ─── Execution accessors ──────────────────────────────────────────────────

export function getAllExecutions(): Array<JobExecutionDetail> {
  return Object.values(executionsState).sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })
}

export function getExecution(
  executionId: string,
): JobExecutionDetail | undefined {
  return executionsState[executionId]
}

export function addExecution(request: JobExecuteRequest): JobExecuteResponse {
  const run_id = `exec-mock-${String(executionIdCounter++).padStart(3, '0')}`
  const timestamp = new Date().toISOString()
  executionsState[run_id] = {
    run_id,
    attempt_count: 1,
    status: 'submitted',
    created_at: timestamp,
    updated_at: timestamp,
    blueprint_id: request.blueprint_id,
    blueprint_version: request.blueprint_version ?? 1,
    error: null,
    progress: '0',
    cascade_job_id: null,
    outputs: null,
  }
  return { run_id, attempt_count: 1 }
}

export function restartExecution(
  executionId: string,
): { run_id: string; attempt_count: number } | undefined {
  if (!(executionId in executionsState)) return undefined
  const exec = executionsState[executionId]
  const attempt_count = exec.attempt_count + 1
  executionsState[executionId] = {
    ...exec,
    attempt_count,
    status: 'submitted',
    progress: '0',
    updated_at: new Date().toISOString(),
    completed_block_ids: null,
    planned_block_ids: null,
  }
  return { run_id: executionId, attempt_count }
}

export function deleteExecution(executionId: string): boolean {
  if (!(executionId in executionsState)) return false
  delete executionsState[executionId]
  return true
}

/** Add an execution to the mock state. Intended for tests that need a
 * specific fixture without adding it to the default seed. */
export function injectMockExecution(detail: JobExecutionDetail): void {
  executionsState[detail.run_id] = JSON.parse(
    JSON.stringify(detail),
  ) as JobExecutionDetail
}

/** Flip the `is_available` flag on a single output in the mock state.
 * Useful for hand-testing the "outputs trickling in" flow against running jobs. */
export function setMockOutputAvailable(
  executionId: string,
  taskId: string,
  isAvailable: boolean,
): boolean {
  // The record lookups are statically typed as the value type (no
  // `noUncheckedIndexedAccess`), so cast to surface the runtime undefined.
  const exec = executionsState[executionId] as JobExecutionDetail | undefined
  if (!exec?.outputs) return false
  const meta = exec.outputs.byTask[taskId] as
    | { is_available: boolean }
    | undefined
  if (!meta) return false
  meta.is_available = isAvailable
  return true
}

// ─── Compilation detail fixtures ──────────────────────────────────────────
//
// Only some runs have a fixture; the rest exercise the 404 "not available"
// path that the cross-panel highlight gracefully degrades to.

/** Tasks for `job-completed-001` (def-001: source → product → sink),
 * a fully cross-block DAG with leaf tasks under each block. */
const compilationDetailJobCompleted001: CompilationDetailResponse = {
  tasks: [
    {
      task_id:
        'earthkit.workflows.plugins.anemoi.inference._get_initial_conditions_from_config:a1b2c3d4',
      block: 'block_source_1',
      display_name:
        'earthkit.workflows.plugins.anemoi.inference._get_initial_conditions_from_config:a1b2c3d4',
      parents: [],
    },
    {
      task_id: '_empty_payload:e5f6a7b8',
      block: 'block_source_1',
      display_name: '_empty_payload:e5f6a7b8',
      parents: [
        'earthkit.workflows.plugins.anemoi.inference._get_initial_conditions_from_config:a1b2c3d4',
      ],
    },
    {
      task_id:
        'earthkit.workflows.plugins.anemoi.inference.run_as_earthkit_from_config:c9d0e1f2',
      block: 'block_source_1',
      display_name:
        'earthkit.workflows.plugins.anemoi.inference.run_as_earthkit_from_config:c9d0e1f2',
      parents: ['_empty_payload:e5f6a7b8'],
    },
    {
      task_id: 'take:33445566778899aa',
      block: 'block_product_1',
      display_name: 'take:33445566778899aa',
      parents: [
        'earthkit.workflows.plugins.anemoi.inference.run_as_earthkit_from_config:c9d0e1f2',
      ],
    },
    {
      task_id:
        'fiab_plugin_ecmwf.runtime.statistics.ensemble_mean:bbccddeeff001122',
      block: 'block_product_1',
      display_name:
        'fiab_plugin_ecmwf.runtime.statistics.ensemble_mean:bbccddeeff001122',
      parents: ['take:33445566778899aa'],
    },
    {
      task_id: 'take:33445566fedcba98',
      block: 'block_sink_1',
      display_name: 'take:33445566fedcba98',
      parents: [
        'fiab_plugin_ecmwf.runtime.statistics.ensemble_mean:bbccddeeff001122',
      ],
    },
    {
      task_id: 'fiab_plugin_ecmwf.runtime.plots.map_plot:01234567abcdef89',
      block: 'block_sink_1',
      display_name: 'fiab_plugin_ecmwf.runtime.plots.map_plot:01234567abcdef89',
      parents: ['take:33445566fedcba98'],
    },
    {
      task_id: 'take:8899aabbccddeeff',
      block: 'block_sink_1',
      display_name: 'take:8899aabbccddeeff',
      parents: [
        'fiab_plugin_ecmwf.runtime.statistics.ensemble_mean:bbccddeeff001122',
      ],
    },
    {
      task_id: 'fiab_plugin_ecmwf.runtime.plots.map_plot:fedcba9876543210',
      block: 'block_sink_1',
      display_name: 'fiab_plugin_ecmwf.runtime.plots.map_plot:fedcba9876543210',
      parents: ['take:8899aabbccddeeff'],
    },
  ],
}

/** Tasks for `job-running-002` (def-002: source → sink) — partial DAG. */
const compilationDetailJobRunning002: CompilationDetailResponse = {
  tasks: [
    {
      task_id:
        'earthkit.workflows.plugins.anemoi.inference._get_initial_conditions_from_config:11aa22bb',
      block: 'block_source_1',
      display_name:
        'earthkit.workflows.plugins.anemoi.inference._get_initial_conditions_from_config:11aa22bb',
      parents: [],
    },
    {
      task_id:
        'earthkit.workflows.plugins.anemoi.inference.run_as_earthkit_from_config:33cc44dd',
      block: 'block_source_1',
      display_name:
        'earthkit.workflows.plugins.anemoi.inference.run_as_earthkit_from_config:33cc44dd',
      parents: [
        'earthkit.workflows.plugins.anemoi.inference._get_initial_conditions_from_config:11aa22bb',
      ],
    },
    {
      task_id: 'take:55ee66ff77001122',
      block: 'block_sink_1',
      display_name: 'take:55ee66ff77001122',
      parents: [
        'earthkit.workflows.plugins.anemoi.inference.run_as_earthkit_from_config:33cc44dd',
      ],
    },
  ],
}

/** Lookup keyed by run_id. Absence ⇒ backend would return 404. */
const compilationDetailByRunId: Record<string, CompilationDetailResponse> = {
  'job-completed-001': compilationDetailJobCompleted001,
  'job-running-002': compilationDetailJobRunning002,
  // job-errored-003 deliberately omitted to exercise the empty-state path.
}

export function getCompilationDetailFixture(
  runId: string,
): CompilationDetailResponse | undefined {
  return compilationDetailByRunId[runId]
}

/** Add or replace a compilation-detail fixture for a given run.
 * Intended for tests that need to pair a custom execution (via
 * {@link injectMockExecution}) with a matching compilation DAG. */
export function injectCompilationDetail(
  runId: string,
  fixture: CompilationDetailResponse,
): void {
  compilationDetailByRunId[runId] = fixture
}

export function createMockPngBlob(): Blob {
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
    0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe2, 0x21, 0xbc, 0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
  return new Blob([pngBytes], { type: 'image/png' })
}

/** Minimal PDF — `%PDF-` magic is enough to sniff; pdfjs may reject the body
 * and PdfThumbnail then falls back to the FileText icon. */
export function createMockPdfBlob(): Blob {
  const body =
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n' +
    'trailer<</Size 4/Root 1 0 R>>\n' +
    '%%EOF\n'
  return new Blob([new TextEncoder().encode(body)], {
    type: 'application/pdf',
  })
}

export function createMockSvgBlob(): Blob {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<rect width="64" height="64" fill="#94a3b8"/></svg>\n'
  return new Blob([new TextEncoder().encode(body)], {
    type: 'image/svg+xml',
  })
}

/** Mock blob for a stored mime. Opaque mimes return PNG bytes so the
 * sniff-promotion path stays exercised; unknown mimes also fall back to PNG. */
export function mockBlobForMime(mimeType: string): Blob {
  switch (mimeType) {
    case 'application/pdf':
      return createMockPdfBlob()
    case 'image/svg+xml':
      return createMockSvgBlob()
    case 'image/png':
    case 'application/octet-stream':
    case 'application/pickle':
    case 'application/clpkl':
    default:
      return createMockPngBlob()
  }
}
