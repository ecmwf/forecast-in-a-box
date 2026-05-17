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

export interface ModelInfo {
  name: string
  version: string
  releasedAt: string
  isNew?: boolean
}

export interface ForumTopic {
  title: string
  author: string
  postedAt: string
}

export const mockModels: Array<ModelInfo> = [
  {
    name: 'AIFS',
    version: 'v2.1',
    releasedAt: '3 days ago',
    isNew: true,
  },
  {
    name: 'MetNorway-ML',
    version: 'v1.8',
    releasedAt: '1 week ago',
  },
  {
    name: 'AICON',
    version: 'v2.5',
    releasedAt: '3 weeks ago',
  },
  {
    name: 'Neural Forecast Model',
    version: 'v3.0',
    releasedAt: '2 weeks ago',
  },
]

export const mockForumTopics: Array<ForumTopic> = [
  {
    title: 'Best practices for extreme weather forecasting',
    author: '@weatherpro',
    postedAt: '2h ago',
  },
  {
    title: 'Comparing forecast model accuracy',
    author: '@mlweather',
    postedAt: '5h ago',
  },
  {
    title: 'Tips for optimizing forecast runtime',
    author: '@fastforecast',
    postedAt: '1d ago',
  },
  {
    title: 'Regional model recommendations',
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
