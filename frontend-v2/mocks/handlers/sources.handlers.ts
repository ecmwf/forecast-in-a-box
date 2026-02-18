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
 * Sources Mock Handlers
 *
 * MSW handlers for sources and registries management endpoints.
 */

import { HttpResponse, delay, http } from 'msw'
import { mockRegistries, mockSources } from '../data/sources.data'
import type { SourceRegistry } from '@/api/types/sources.types'
import { API_ENDPOINTS, API_PATTERNS } from '@/api/endpoints'

// Mutable copies for simulating state changes
let sources = [...mockSources]
let registries = [...mockRegistries]

export const sourcesHandlers = [
  // ============================================
  // Sources Handlers
  // ============================================

  /**
   * GET /api/v1/sources - List all sources and registries
   */
  http.get(API_ENDPOINTS.sources.list, async () => {
    await delay(300)
    return HttpResponse.json({ sources, registries })
  }),

  /**
   * GET /api/v1/sources/:sourceId - Get source details
   */
  http.get(API_PATTERNS.sources.byId, async ({ params }) => {
    await delay(200)
    const { sourceId } = params
    const source = sources.find((s) => s.id === sourceId)

    if (!source) {
      return HttpResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    return HttpResponse.json({ source })
  }),

  /**
   * POST /api/v1/sources/:sourceId/download - Download a source
   */
  http.post(API_PATTERNS.sources.download, async ({ params }) => {
    await delay(500)
    const { sourceId } = params
    const sourceIndex = sources.findIndex((s) => s.id === sourceId)

    if (sourceIndex === -1) {
      return HttpResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    // Update source status to downloading
    sources[sourceIndex] = {
      ...sources[sourceIndex],
      status: 'downloading',
      downloadProgress: 0,
    }

    return HttpResponse.json({
      success: true,
      message: 'Download started',
      sourceId,
    })
  }),

  /**
   * DELETE /api/v1/sources/:sourceId - Remove a source
   */
  http.delete(API_PATTERNS.sources.byId, async ({ params }) => {
    await delay(300)
    const { sourceId } = params
    const source = sources.find((s) => s.id === sourceId)

    if (!source) {
      return HttpResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    if (source.isDefault) {
      return HttpResponse.json(
        { error: 'Cannot remove default source' },
        { status: 400 },
      )
    }

    sources = sources.filter((s) => s.id !== sourceId)

    return HttpResponse.json({
      success: true,
      message: 'Source removed',
    })
  }),

  /**
   * PUT /api/v1/sources/:sourceId/enable - Enable a source
   */
  http.put(API_PATTERNS.sources.enable, async ({ params }) => {
    await delay(200)
    const { sourceId } = params
    const sourceIndex = sources.findIndex((s) => s.id === sourceId)

    if (sourceIndex === -1) {
      return HttpResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    sources[sourceIndex] = {
      ...sources[sourceIndex],
      isEnabled: true,
    }

    return HttpResponse.json({
      success: true,
      message: 'Source enabled',
    })
  }),

  /**
   * PUT /api/v1/sources/:sourceId/disable - Disable a source
   */
  http.put(API_PATTERNS.sources.disable, async ({ params }) => {
    await delay(200)
    const { sourceId } = params
    const sourceIndex = sources.findIndex((s) => s.id === sourceId)

    if (sourceIndex === -1) {
      return HttpResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    sources[sourceIndex] = {
      ...sources[sourceIndex],
      isEnabled: false,
    }

    return HttpResponse.json({
      success: true,
      message: 'Source disabled',
    })
  }),

  /**
   * PUT /api/v1/sources/:sourceId/configure - Update source configuration
   */
  http.put(API_PATTERNS.sources.configure, async ({ params, request }) => {
    await delay(300)
    const { sourceId } = params
    const sourceIndex = sources.findIndex((s) => s.id === sourceId)

    if (sourceIndex === -1) {
      return HttpResponse.json({ error: 'Source not found' }, { status: 404 })
    }

    const body = (await request.json()) as {
      configurationValues: Record<string, string>
    }

    sources[sourceIndex] = {
      ...sources[sourceIndex],
      configurationValues: body.configurationValues,
      status: 'ready',
    }

    return HttpResponse.json({
      success: true,
      message: 'Source configured',
    })
  }),

  // ============================================
  // Registry Handlers
  // ============================================

  /**
   * GET /api/v1/registries - List all registries
   */
  http.get(API_ENDPOINTS.registries.list, async () => {
    await delay(200)
    return HttpResponse.json({ registries })
  }),

  /**
   * POST /api/v1/registries - Add a new registry
   */
  http.post(API_ENDPOINTS.registries.add, async ({ request }) => {
    await delay(500)
    const body = (await request.json()) as { name: string; url: string }

    // Check if registry with this URL already exists
    if (registries.some((r) => r.url === body.url)) {
      return HttpResponse.json(
        { error: 'Registry with this URL already exists' },
        { status: 400 },
      )
    }

    const newRegistry: SourceRegistry = {
      id: `registry-${Date.now()}`,
      name: body.name,
      description: `Custom registry: ${body.name}`,
      url: body.url,
      isDefault: false,
      isConnected: true,
      sourcesCount: 0,
      stores: [],
      lastSyncedAt: new Date().toISOString(),
    }

    registries.push(newRegistry)

    return HttpResponse.json({
      success: true,
      message: 'Registry added',
      registry: newRegistry,
    })
  }),

  /**
   * GET /api/v1/registries/:registryId - Get registry details
   */
  http.get(API_PATTERNS.registries.byId, async ({ params }) => {
    await delay(200)
    const { registryId } = params
    const registry = registries.find((r) => r.id === registryId)

    if (!registry) {
      return HttpResponse.json({ error: 'Registry not found' }, { status: 404 })
    }

    return HttpResponse.json({ registry })
  }),

  /**
   * DELETE /api/v1/registries/:registryId - Remove a registry
   */
  http.delete(API_PATTERNS.registries.byId, async ({ params }) => {
    await delay(300)
    const { registryId } = params
    const registry = registries.find((r) => r.id === registryId)

    if (!registry) {
      return HttpResponse.json({ error: 'Registry not found' }, { status: 404 })
    }

    if (registry.isDefault) {
      return HttpResponse.json(
        { error: 'Cannot remove default registry' },
        { status: 400 },
      )
    }

    // Remove registry
    registries = registries.filter((r) => r.id !== registryId)

    // Remove sources from this registry
    sources = sources.filter((s) => s.registryId !== registryId)

    return HttpResponse.json({
      success: true,
      message: 'Registry removed',
    })
  }),

  /**
   * POST /api/v1/registries/:registryId/sync - Sync a registry
   */
  http.post(API_PATTERNS.registries.sync, async ({ params }) => {
    await delay(1000)
    const { registryId } = params
    const registryIndex = registries.findIndex((r) => r.id === registryId)

    if (registryIndex === -1) {
      return HttpResponse.json({ error: 'Registry not found' }, { status: 404 })
    }

    // Update last synced timestamp
    registries[registryIndex] = {
      ...registries[registryIndex],
      lastSyncedAt: new Date().toISOString(),
    }

    return HttpResponse.json({
      success: true,
      message: 'Registry synced',
      lastSyncedAt: registries[registryIndex].lastSyncedAt,
    })
  }),
]
