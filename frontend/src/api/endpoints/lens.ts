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
 * Lens API client. The lens routes are passthroughs to the backend lens
 * manager, which spawns external tools (e.g. SkinnyWMS) on dynamic ports.
 * Always check status until `running` before talking to the lens directly.
 */

import { z } from 'zod'
import type {
  LensInstanceDetailResponse,
  SupportedLensDetail,
} from '@/api/types/lens.types'
import {
  LensInstanceDetailResponseSchema,
  SupportedLensDetailSchema,
} from '@/api/types/lens.types'
import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import { getBackendBaseUrl } from '@/utils/env'

export async function startSkinnyWms(localPath: string): Promise<string> {
  return apiClient.post(
    API_ENDPOINTS.lens.startSkinnyWms,
    {},
    {
      params: { local_path: localPath },
      schema: z.string(),
    },
  )
}

export async function getLensStatus(
  lensInstanceId: string,
): Promise<LensInstanceDetailResponse> {
  return apiClient.get(API_ENDPOINTS.lens.status, {
    params: { lens_instance_id: lensInstanceId },
    schema: LensInstanceDetailResponseSchema,
  })
}

export async function stopLens(lensInstanceId: string): Promise<string> {
  return apiClient.delete(API_ENDPOINTS.lens.stop, {
    params: { lens_instance_id: lensInstanceId },
    schema: z.string(),
  })
}

export async function listLenses(): Promise<Array<LensInstanceDetailResponse>> {
  return apiClient.get(API_ENDPOINTS.lens.list, {
    schema: z.array(LensInstanceDetailResponseSchema),
  })
}

export async function listSupportedLenses(): Promise<
  Array<SupportedLensDetail>
> {
  return apiClient.get(API_ENDPOINTS.lens.supported, {
    schema: z.array(SupportedLensDetailSchema),
  })
}

/**
 * Build the absolute base URL of a running lens instance from its port.
 * Lens binds on the same host as the FIAB backend; falls through to
 * `window.location` for same-origin deployments.
 */
export function buildLensBaseUrl(port: number): string {
  const backendBase = getBackendBaseUrl()
  const source = backendBase
    ? new URL(backendBase)
    : new URL(window.location.href)
  return `${source.protocol}//${source.hostname}:${port}`
}

/**
 * GetCapabilities URL for the WMS instance behind a lens. Suitable for
 * pasting into external WMS clients (QGIS, ArcGIS, etc.).
 */
export function buildWmsCapabilitiesUrl(port: number): string {
  return `${buildLensBaseUrl(port)}/wms?service=WMS&version=1.3.0&request=GetCapabilities`
}
