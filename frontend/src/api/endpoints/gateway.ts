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
 * Gateway API Endpoints
 */

import { apiClient } from '@/api/client'
import { API_ENDPOINTS } from '@/api/endpoints'
import { getBackendBaseUrl } from '@/utils/env'

export async function getGatewayStatus(): Promise<string> {
  return apiClient.get(API_ENDPOINTS.gateway.status)
}

export function getGatewayLogsUrl(): string {
  const baseUrl = getBackendBaseUrl()
  const path = API_ENDPOINTS.gateway.logs
  return baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : path
}
