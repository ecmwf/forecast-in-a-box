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
 * Mock state for the lens API. Instances start as `starting` and flip to
 * `running` (with a port) after a configurable number of status polls, so
 * the UI's poll-until-running flow is exercised realistically.
 */

import { hasMockWmsServer, registerMockWmsServer } from './wms.data'
import type { LensInstanceDetailResponse } from '@/api/types/lens.types'

interface MockLensInstance {
  detail: LensInstanceDetailResponse
  /** Status polls remaining before the instance flips to `running`. */
  pollsUntilRunning: number
}

let lensIdCounter = 1
let portCounter = 54300
let lensState: Record<string, MockLensInstance> = {}

/** Polls before a freshly started lens reports `running`. */
let pollsUntilRunning = 1

/** Mirrors deployments without the optional SkinnyWMS package installed. */
let skinnyWmsInstalled = true

export function resetLensState(options?: {
  pollsUntilRunning?: number
  skinnyWmsInstalled?: boolean
}): void {
  lensIdCounter = 1
  portCounter = 54300
  lensState = {}
  pollsUntilRunning = options?.pollsUntilRunning ?? 1
  skinnyWmsInstalled = options?.skinnyWmsInstalled ?? true
}

export function isSkinnyWmsInstalled(): boolean {
  return skinnyWmsInstalled
}

export function startMockLens(localPath: string): string {
  const id = `lens-${lensIdCounter++}`
  lensState[id] = {
    detail: {
      lens_instance_id: id,
      status: 'starting',
      lens_name: 'skinnyWMS',
      lens_params: { local_path: localPath },
      ports: [],
    },
    pollsUntilRunning,
  }
  return id
}

export function pollMockLens(id: string): LensInstanceDetailResponse | null {
  if (!(id in lensState)) return null
  const instance = lensState[id]
  if (instance.detail.status === 'starting') {
    if (instance.pollsUntilRunning <= 0) {
      const port = portCounter++
      instance.detail = {
        ...instance.detail,
        status: 'running',
        ports: [port],
      }
      // Serve WMS behind every mock lens so the viewer/compare flows work
      // end-to-end in dev:mock. Tests that pre-registered the port keep
      // their fixture.
      if (!hasMockWmsServer(port)) {
        registerMockWmsServer(port, DEFAULT_LENS_WMS_CONFIG)
      }
    } else {
      instance.pollsUntilRunning--
    }
  }
  return instance.detail
}

/** Layer set served behind mock lenses — enough surface + pressure-level
 * parameters and a time dimension to exercise viewer and compare flows. */
const DEFAULT_LENS_WMS_CONFIG = {
  layers: [
    {
      name: '2t',
      title: '2 m temperature',
      time: '2026-07-06T00:00:00Z/2026-07-07T00:00:00Z/PT6H',
    },
    {
      name: 'msl',
      title: 'Mean sea level pressure',
      time: '2026-07-06T00:00:00Z/2026-07-07T00:00:00Z/PT6H',
    },
    { name: 'tp', title: 'Total precipitation' },
    { name: 'q@pl_500', title: 'Specific humidity at 500 hPa' },
    { name: 'q@pl_850', title: 'Specific humidity at 850 hPa' },
  ],
}

/** Real-backend external stop: the record stays, status flips to failed. */
export function failMockLens(id: string): void {
  const instance = lensState[id] as (typeof lensState)[string] | undefined
  if (instance) instance.detail = { ...instance.detail, status: 'failed' }
}

export function stopMockLens(id: string): boolean {
  if (!(id in lensState)) return false
  delete lensState[id]
  return true
}

export function listMockLenses(): Array<LensInstanceDetailResponse> {
  return Object.values(lensState).map((i) => i.detail)
}

/** Seed a lens directly in a given state (for list-driven UI tests). */
export function injectMockLens(detail: LensInstanceDetailResponse): void {
  lensState[detail.lens_instance_id] = { detail, pollsUntilRunning: 0 }
}
