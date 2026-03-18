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
 * Mock Sources Data
 *
 * Test data for sources management features.
 * Sources from ECMWF, Met Norway, and DWD.
 */

import type { SourceInfo, SourceRegistry } from '@/api/types/sources.types'

// ============================================
// Mock Registries
// ============================================

export const mockRegistries: Array<SourceRegistry> = [
  {
    id: 'ecmwf-fiab-registry',
    name: 'ECMWF Forecast-in-a-Box',
    description:
      'Official ECMWF registry for Forecast-in-a-Box models and datasets.',
    url: 'https://registry.fiab.ecmwf.int',
    isDefault: true,
    isConnected: true,
    sourcesCount: 12,
    stores: [
      {
        id: 'ecmwf-s3',
        name: 'ECMWF S3 Storage',
        url: 's3://ecmwf-ai-models',
        type: 's3',
      },
    ],
    lastSyncedAt: '2025-12-01T10:00:00Z',
  },
  {
    id: 'met-norway-registry',
    name: 'Met Norway',
    description:
      'Norwegian Meteorological Institute registry for BRIS models and Nordic weather data.',
    url: 'https://registry.met.no/fiab',
    isDefault: false,
    isConnected: true,
    sourcesCount: 3,
    stores: [
      {
        id: 'met-gcs',
        name: 'Met Norway GCS',
        url: 'gs://met-norway-models',
        type: 'gcs',
      },
    ],
    lastSyncedAt: '2025-11-28T14:30:00Z',
  },
  {
    id: 'dwd-registry',
    name: 'DWD',
    description:
      'Deutscher Wetterdienst registry for AICON models and German weather data.',
    url: 'https://opendata.dwd.de/fiab',
    isDefault: false,
    isConnected: true,
    sourcesCount: 2,
    stores: [
      {
        id: 'dwd-opendata',
        name: 'DWD Open Data',
        url: 'https://opendata.dwd.de',
        type: 'other',
      },
    ],
    lastSyncedAt: '2025-11-30T08:15:00Z',
  },
]

// ============================================
// Mock Sources
// ============================================

export const mockSources: Array<SourceInfo> = [
  // ============================================
  // ECMWF AI Models (from ecmwf/anemoi-inference plugin)
  // ============================================
  {
    id: 'ecmwf/ifs-ens',
    factoryId: 'anemoi-inference/ifs-ens',
    name: 'IFS ENS',
    description:
      'ECMWF Integrated Forecasting System Ensemble - operational global ensemble weather forecasting.',
    sourceType: 'model',
    pluginId: 'ecmwf/anemoi-inference',
    pluginName: 'Anemoi Inference',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: true,
    iconName: 'Brain',
    registry: 'huggingface.co/ecmwf',
    registryId: 'ecmwf-fiab-registry',
    size: '2.4 GB',
    installedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'ecmwf/ens-crps-v1.0',
    factoryId: 'anemoi-inference/ens-crps-v1.0',
    name: 'ens-crps-v1.0',
    description:
      'ECMWF ensemble model trained with CRPS loss for probabilistic forecasting.',
    sourceType: 'model',
    pluginId: 'ecmwf/anemoi-inference',
    pluginName: 'Anemoi Inference',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/ecmwf',
    registryId: 'ecmwf-fiab-registry',
    size: '1.8 GB',
    installedAt: '2025-06-15T10:30:00Z',
  },
  {
    id: 'ecmwf/single-mse-v1.0',
    factoryId: 'anemoi-inference/single-mse-v1.0',
    name: 'single-mse-v1.0',
    description:
      'ECMWF deterministic model trained with MSE loss for high-resolution forecasts.',
    sourceType: 'model',
    pluginId: 'ecmwf/anemoi-inference',
    pluginName: 'Anemoi Inference',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/ecmwf',
    registryId: 'ecmwf-fiab-registry',
    size: '2.1 GB',
    installedAt: '2025-07-20T14:00:00Z',
  },
  {
    id: 'ecmwf/single-mse-v0.2.1',
    factoryId: 'anemoi-inference/single-mse-v0.2.1',
    name: 'single-mse-v0.2.1.ckpt',
    description: 'Earlier version of ECMWF deterministic MSE model checkpoint.',
    sourceType: 'model',
    pluginId: 'ecmwf/anemoi-inference',
    pluginName: 'Anemoi Inference',
    author: 'ECMWF',
    version: '0.2.1',
    status: 'available',
    isEnabled: false,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/ecmwf',
    registryId: 'ecmwf-fiab-registry',
    size: '1.9 GB',
  },

  // ============================================
  // Met Norway AI Models (from met-norway/bris plugin)
  // ============================================
  {
    id: 'metnorway/bris',
    factoryId: 'bris/bris-main',
    name: 'BRIS',
    description:
      'Met Norway BRIS (Bergen Regional Intelligent System) weather prediction model.',
    sourceType: 'model',
    pluginId: 'met-norway/bris',
    pluginName: 'Met Norway BRIS',
    author: 'Met Norway',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/met-norway',
    registryId: 'met-norway-registry',
    size: '1.6 GB',
    installedAt: '2025-08-15T08:30:00Z',
  },
  {
    id: 'metnorway/bris-malawi-0.025-n320-20251001',
    factoryId: 'bris/bris-metnorway-malawi-0-025-n320-20251001',
    name: 'bris-metnorway-malawi-0-025-n320-20251001.ckpt',
    description:
      'BRIS model for Malawi region at 0.025° resolution on N320 grid.',
    sourceType: 'model',
    pluginId: 'met-norway/bris',
    pluginName: 'Met Norway BRIS',
    author: 'Met Norway',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/met-norway',
    registryId: 'met-norway-registry',
    size: '1.4 GB',
    installedAt: '2025-10-01T12:00:00Z',
  },
  {
    id: 'metnorway/bris-malawi-0.05-n320-20250923',
    factoryId: 'bris/bris-metnorway-malawi-0.05-N320-20250923',
    name: 'bris-metnorway-malawi-0.05-N320-20250923.ckpt',
    description:
      'BRIS model for Malawi region at 0.05° resolution on N320 grid.',
    sourceType: 'model',
    pluginId: 'met-norway/bris',
    pluginName: 'Met Norway BRIS',
    author: 'Met Norway',
    version: '1.0.0',
    status: 'downloading',
    downloadProgress: 67,
    isEnabled: false,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/met-norway',
    registryId: 'met-norway-registry',
    size: '1.2 GB',
  },

  // ============================================
  // Regional Models (various organizations)
  // ============================================
  {
    id: 'regional/malawi-0.05-n320',
    factoryId: 'anemoi-inference/malawi-0.05-n320',
    name: 'malawi-0.05-n320',
    description:
      'Regional AI model for Malawi at 0.05° resolution on N320 grid.',
    sourceType: 'model',
    pluginId: 'ecmwf/anemoi-inference',
    pluginName: 'Anemoi Inference',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/ecmwf',
    registryId: 'ecmwf-fiab-registry',
    size: '980 MB',
    installedAt: '2025-09-10T09:00:00Z',
  },
  {
    id: 'regional/morocco-0.05-o96',
    factoryId: 'anemoi-inference/morocco-0.05-o96',
    name: 'morocco-0.05-o96',
    description:
      'Regional AI model for Morocco at 0.05° resolution on O96 grid.',
    sourceType: 'model',
    pluginId: 'ecmwf/anemoi-inference',
    pluginName: 'Anemoi Inference',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/ecmwf',
    registryId: 'ecmwf-fiab-registry',
    size: '850 MB',
    installedAt: '2025-09-12T11:30:00Z',
  },
  {
    id: 'regional/morocco-0.05-n320',
    factoryId: 'anemoi-inference/morocco-0.05-n320',
    name: 'morocco-0.05-n320',
    description:
      'Regional AI model for Morocco at 0.05° resolution on N320 grid.',
    sourceType: 'model',
    pluginId: 'ecmwf/anemoi-inference',
    pluginName: 'Anemoi Inference',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'available',
    isEnabled: false,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/ecmwf',
    registryId: 'ecmwf-fiab-registry',
    size: '920 MB',
  },
  {
    id: 'regional/easterncanada-0.05-o96',
    factoryId: 'anemoi-inference/easterncanada-0.05-o96',
    name: 'easterncanada-0.05-o96',
    description:
      'Regional AI model for Eastern Canada at 0.05° resolution on O96 grid.',
    sourceType: 'model',
    pluginId: 'ecmwf/anemoi-inference',
    pluginName: 'Anemoi Inference',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'available',
    isEnabled: false,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/ecmwf',
    registryId: 'ecmwf-fiab-registry',
    size: '1.1 GB',
  },
  {
    id: 'regional/canada-0.1-o96',
    factoryId: 'anemoi-inference/canada-0.1-o96',
    name: 'canada-0.1-o96',
    description: 'Regional AI model for Canada at 0.1° resolution on O96 grid.',
    sourceType: 'model',
    pluginId: 'ecmwf/anemoi-inference',
    pluginName: 'Anemoi Inference',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'error',
    downloadError: 'Checksum verification failed - please retry download',
    isEnabled: false,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/ecmwf',
    registryId: 'ecmwf-fiab-registry',
    size: '1.3 GB',
  },

  // ============================================
  // DWD AI Models (from dwd/aicon plugin)
  // ============================================
  {
    id: 'dwd/aicon-global',
    factoryId: 'aicon/aicon-global',
    name: 'DWD AICON Global',
    description: 'DWD AI-based ICON model for global weather prediction.',
    sourceType: 'model',
    pluginId: 'dwd/aicon',
    pluginName: 'DWD AICON',
    author: 'DWD',
    version: '2.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: false,
    iconName: 'Brain',
    registry: 'huggingface.co/dwd',
    registryId: 'dwd-registry',
    size: '2.8 GB',
    installedAt: '2025-09-01T10:00:00Z',
  },

  // ============================================
  // ECMWF Datasets (from ecmwf/aifs-dataset plugin)
  // ============================================
  {
    id: 'ecmwf/aifs-forecast',
    factoryId: 'aifs-dataset/forecast',
    name: 'AIFS Forecast Dataset',
    description:
      'Latest AIFS operational forecast data from ECMWF production system.',
    sourceType: 'dataset',
    pluginId: 'ecmwf/aifs-dataset',
    pluginName: 'AIFS Forecast Dataset',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: true,
    iconName: 'Database',
    registryId: 'ecmwf-fiab-registry',
    installedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'ecmwf/era5-reanalysis',
    factoryId: 'aifs-dataset/era5',
    name: 'ERA5 Reanalysis',
    description:
      'ECMWF ERA5 reanalysis dataset for historical weather data and model verification.',
    sourceType: 'dataset',
    pluginId: 'ecmwf/aifs-dataset',
    pluginName: 'AIFS Forecast Dataset',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: false,
    iconName: 'Database',
    registryId: 'ecmwf-fiab-registry',
    installedAt: '2025-03-10T14:20:00Z',
  },
  {
    id: 'ecmwf/ifs-hres',
    factoryId: 'aifs-dataset/ifs-hres',
    name: 'IFS HRES Dataset',
    description: 'ECMWF IFS High Resolution deterministic forecast dataset.',
    sourceType: 'dataset',
    pluginId: 'ecmwf/aifs-dataset',
    pluginName: 'AIFS Forecast Dataset',
    author: 'ECMWF',
    version: '1.0.0',
    status: 'available',
    isEnabled: false,
    isDefault: false,
    iconName: 'Database',
    registryId: 'ecmwf-fiab-registry',
  },

  // ============================================
  // DWD Datasets (from dwd/aicon-dataset plugin)
  // ============================================
  {
    id: 'dwd/icon-d2-forecast',
    factoryId: 'aicon-dataset/icon-d2',
    name: 'ICON-D2 Forecast',
    description:
      'DWD ICON-D2 high-resolution regional forecast dataset for Central Europe.',
    sourceType: 'dataset',
    pluginId: 'dwd/aicon-dataset',
    pluginName: 'DWD AICON Dataset',
    author: 'DWD',
    version: '1.0.0',
    status: 'ready',
    isEnabled: true,
    isDefault: false,
    iconName: 'Database',
    registryId: 'dwd-registry',
    installedAt: '2025-09-05T16:00:00Z',
  },
]

/**
 * Get sources by type
 */
export function getSourcesByType(type: 'model' | 'dataset'): Array<SourceInfo> {
  return mockSources.filter((s) => s.sourceType === type)
}

/**
 * Get sources by status
 */
export function getSourcesByStatus(
  status: SourceInfo['status'],
): Array<SourceInfo> {
  return mockSources.filter((s) => s.status === status)
}

/**
 * Get ready sources
 */
export function getReadySources(): Array<SourceInfo> {
  return mockSources.filter((s) => s.status === 'ready' && s.isEnabled)
}

/**
 * Get sources by plugin
 */
export function getSourcesByPlugin(pluginId: string): Array<SourceInfo> {
  return mockSources.filter((s) => s.pluginId === pluginId)
}

/**
 * Get sources by registry
 */
export function getSourcesByRegistry(registryId: string): Array<SourceInfo> {
  return mockSources.filter((s) => s.registryId === registryId)
}

/**
 * Get registry by ID
 */
export function getRegistryById(
  registryId: string,
): SourceRegistry | undefined {
  return mockRegistries.find((r) => r.id === registryId)
}
