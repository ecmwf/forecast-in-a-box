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
 * manager, which spawns external tools (e.g. SkinnyWMS) internally and
 * exposes them only through the same-origin proxy path. Always check
 * status until `running` before talking to the lens directly.
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
 * A lens is reachable only through the backend's same-origin proxy path,
 * which forwards to the internal process. Build that path from the lens
 * instance id.
 */
export function buildLensBaseUrl(lensInstanceId: string): string {
  return `${API_ENDPOINTS.lens.proxyBase}/${encodeURIComponent(lensInstanceId)}`
}

/**
 * GetCapabilities URL for the WMS instance behind a lens, in-app fetches
 * only (relative, same-origin).
 */
export function buildWmsCapabilitiesUrl(lensInstanceId: string): string {
  return `${buildLensBaseUrl(lensInstanceId)}/wms?service=WMS&version=1.3.0&request=GetCapabilities`
}

/**
 * Absolute GetCapabilities URL, suitable for pasting into external WMS
 * clients (QGIS, ArcGIS, etc.) that don't share the app's origin.
 */
export function buildAbsoluteWmsCapabilitiesUrl(
  lensInstanceId: string,
): string {
  const origin = getBackendBaseUrl() || window.location.origin
  return `${origin}${buildWmsCapabilitiesUrl(lensInstanceId)}`
}
