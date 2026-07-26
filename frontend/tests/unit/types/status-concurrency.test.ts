/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { describe, expect, it } from 'vitest'
import type { StatusResponse } from '@/types/status.types'
import {
  computeTrafficLightStatus,
  getComponentStatusDetails,
  normalizeConcurrencyStatus,
  statusResponseSchema,
} from '@/types/status.types'

const healthy: StatusResponse = {
  api: 'up',
  cascade: 'up',
  ecmwf: 'up',
  scheduler: 'up',
  plugins: 'ok',
  concurrency: { lifecycle: 'running', healthy: true },
  version: '0.0.1@2025-10-31 18:00:20',
}

describe('normalizeConcurrencyStatus', () => {
  it('maps the backend health flag to the component vocabulary', () => {
    expect(
      normalizeConcurrencyStatus({ lifecycle: 'running', healthy: true }),
    ).toBe('up')
    expect(
      normalizeConcurrencyStatus({ lifecycle: 'running', healthy: false }),
    ).toBe('down')
  })
})

describe('statusResponseSchema', () => {
  it('keeps the concurrency object instead of stripping it', () => {
    const parsed = statusResponseSchema.parse(healthy)
    expect(parsed.concurrency).toEqual({ lifecycle: 'running', healthy: true })
  })

  it('rejects a response without it — the backend always reports it', () => {
    // The backend serves this bundle, so a missing field means a broken contract.
    const { concurrency: _omitted, ...withoutField } = healthy
    expect(() => statusResponseSchema.parse(withoutField)).toThrow()
  })

  it('ignores the pool and thread detail the backend also sends', () => {
    const parsed = statusResponseSchema.parse({
      ...healthy,
      concurrency: {
        lifecycle: 'running',
        healthy: true,
        pools: { general: { max_workers: 2, pending: 0 } },
        threads: { 'event-dispatcher': { alive: true } },
        monitored_failures: [],
        unregistered_threads: ['MainThread'],
      },
    })
    expect(parsed.concurrency).toEqual({ lifecycle: 'running', healthy: true })
  })
})

describe('concurrency in the overall status', () => {
  it('turns the light orange when the execution runtime is unhealthy', () => {
    expect(computeTrafficLightStatus(healthy)).toBe('green')
    expect(
      computeTrafficLightStatus({
        ...healthy,
        concurrency: { lifecycle: 'running', healthy: false },
      }),
    ).toBe('orange')
  })

  it('lists concurrency as a component row', () => {
    const rows = getComponentStatusDetails(healthy)
    expect(rows.map((row) => row.component)).toContain('concurrency')
    expect(rows.find((row) => row.component === 'concurrency')).toEqual({
      component: 'concurrency',
      status: 'up',
      isActive: true,
    })
  })

  it('reports the row as offline when the runtime is unhealthy', () => {
    const row = getComponentStatusDetails({
      ...healthy,
      concurrency: { lifecycle: 'stopped', healthy: false },
    }).find((item) => item.component === 'concurrency')
    expect(row).toEqual({
      component: 'concurrency',
      status: 'down',
      isActive: true,
    })
  })
})
