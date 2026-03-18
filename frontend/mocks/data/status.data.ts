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
 * Mock data for status API
 * Structure matches the actual API response from /api/v1/status
 */

import type { StatusResponse } from '@/types/status.types'

/**
 * Default mock status - all systems normal with scheduler off
 */
export const mockStatusAllUp: StatusResponse = {
  api: 'up',
  cascade: 'up',
  ecmwf: 'up',
  scheduler: 'off',
  version: '0.0.1@2025-11-10 17:06:53',
}

/**
 * Mock status - partial outage (one component down)
 */
export const mockStatusPartialOutage: StatusResponse = {
  api: 'up',
  cascade: 'down',
  ecmwf: 'up',
  scheduler: 'off',
  version: '0.0.1@2025-11-10 17:06:53',
}

/**
 * Mock status - all systems down
 */
export const mockStatusAllDown: StatusResponse = {
  api: 'down',
  cascade: 'down',
  ecmwf: 'down',
  scheduler: 'off',
  version: '0.0.1@2025-11-10 17:06:53',
}

/**
 * Current mock status - can be changed to simulate different scenarios
 */
export const mockStatus: StatusResponse = mockStatusAllUp
