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
 * Mock data for dashboard components
 */

/** i18n key (dashboard namespace) for a mock model name. */
type ModelNameKey =
  | 'mock.models.aifs'
  | 'mock.models.metNorwayMl'
  | 'mock.models.aicon'
  | 'mock.models.neuralForecastModel'

/** i18n key (dashboard namespace) for a mock forum-topic title. */
type ForumTopicKey =
  | 'mock.topics.extremeWeather'
  | 'mock.topics.modelAccuracy'
  | 'mock.topics.optimizingRuntime'
  | 'mock.topics.regionalModels'

export interface ModelInfo {
  nameKey: ModelNameKey
  version: string
  releasedAt: string
  isNew?: boolean
}

export interface ForumTopic {
  titleKey: ForumTopicKey
  author: string
  postedAt: string
}

export const mockModels: Array<ModelInfo> = [
  {
    nameKey: 'mock.models.aifs',
    version: 'v2.1',
    releasedAt: '3 days ago',
    isNew: true,
  },
  {
    nameKey: 'mock.models.metNorwayMl',
    version: 'v1.8',
    releasedAt: '1 week ago',
  },
  {
    nameKey: 'mock.models.aicon',
    version: 'v2.5',
    releasedAt: '3 weeks ago',
  },
  {
    nameKey: 'mock.models.neuralForecastModel',
    version: 'v3.0',
    releasedAt: '2 weeks ago',
  },
]

export const mockForumTopics: Array<ForumTopic> = [
  {
    titleKey: 'mock.topics.extremeWeather',
    author: '@weatherpro',
    postedAt: '2h ago',
  },
  {
    titleKey: 'mock.topics.modelAccuracy',
    author: '@mlweather',
    postedAt: '5h ago',
  },
  {
    titleKey: 'mock.topics.optimizingRuntime',
    author: '@fastforecast',
    postedAt: '1d ago',
  },
  {
    titleKey: 'mock.topics.regionalModels',
    author: '@euroweather',
    postedAt: '2d ago',
  },
]

export interface DashboardStats {
  systemStatus: 'ok' | 'warning' | 'error'
  runningForecasts: number
  availableModels: number
  totalModels: number
  totalForecasts: number
  forecastTrend: number // percentage change
}

export const mockDashboardStats: DashboardStats = {
  systemStatus: 'ok',
  runningForecasts: 2,
  availableModels: 8,
  totalModels: 12,
  totalForecasts: 1247,
  forecastTrend: 12,
}
