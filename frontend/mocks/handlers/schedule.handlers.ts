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
 * Schedule MSW Handlers
 */

import { HttpResponse, http } from 'msw'
import { API_ENDPOINTS } from '@/api/endpoints'

export const scheduleHandlers = [
  // GET endpoints
  http.get(API_ENDPOINTS.schedule.list, () => {
    return HttpResponse.json({
      schedules: [],
      total: 0,
      page: 1,
      page_size: 10,
      total_pages: 0,
      error: null,
    })
  }),

  http.get(API_ENDPOINTS.schedule.get, () => {
    return HttpResponse.json(null, { status: 404 })
  }),

  http.get(API_ENDPOINTS.schedule.runs, () => {
    return HttpResponse.json({
      runs: [],
      total: 0,
      page: 1,
      page_size: 10,
      total_pages: 0,
      error: null,
    })
  }),

  http.get(API_ENDPOINTS.schedule.nextRun, () => {
    return HttpResponse.json('N/A')
  }),

  http.get(API_ENDPOINTS.schedule.currentTime, () => {
    return HttpResponse.json(new Date().toISOString().slice(0, -1))
  }),

  // Mutation endpoints
  http.put(API_ENDPOINTS.schedule.create, () => {
    return HttpResponse.json({
      experiment_id: crypto.randomUUID(),
    })
  }),

  http.post(API_ENDPOINTS.schedule.update, () => {
    return HttpResponse.json({
      experiment_id: 'mock-schedule-1',
      experiment_version: 1,
      blueprint_id: 'mock-blueprint',
      blueprint_version: 1,
      cron_expr: '0 6 * * *',
      dynamic_expr: {},
      max_acceptable_delay_hours: 24,
      enabled: true,
      created_at: new Date().toISOString(),
      created_by: null,
      display_name: 'Updated Schedule',
      display_description: null,
      tags: null,
    })
  }),

  http.post(API_ENDPOINTS.schedule.delete, () => {
    return new HttpResponse(null, { status: 204 })
  }),
]
