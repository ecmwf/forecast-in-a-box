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

export type ForecastStatus = 'running' | 'completed' | 'error'

export interface ForecastJob {
  id: string
  name: string
  model: string
  startedAt: string
  productCount: number
  status: ForecastStatus
  progress?: number
  tags: Array<string>
  isScheduled?: boolean
  isBookmarked?: boolean
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

export const mockForecastJobs: Array<ForecastJob> = [
  {
    id: 'a3f7c2d',
    name: 'Europe Weather - 72h',
    model: 'AIFS Global',
    startedAt: '2025-10-02 09:30',
    productCount: 4,
    status: 'running',
    progress: 65,
    tags: ['high-priority', 'wind-analysis'],
    isBookmarked: false,
  },
  {
    id: '8k9m2p1',
    name: 'North America - 120h',
    model: 'IFS ENS',
    startedAt: '2025-10-02 08:15',
    productCount: 6,
    status: 'completed',
    tags: ['production', 'daily-forecast'],
    isScheduled: true,
    isBookmarked: false,
  },
  {
    id: 'f2d8a1c',
    name: 'Asia Pacific - 48h',
    model: 'COSMO Alpine',
    startedAt: '2025-10-01 14:20',
    productCount: 3,
    status: 'completed',
    tags: ['research', 'temperature'],
    isBookmarked: false,
  },
  {
    id: 'b7k3n9x',
    name: 'Global Forecast - 240h',
    model: 'AIFS Global',
    startedAt: '2025-10-01 11:00',
    productCount: 8,
    status: 'error',
    tags: ['high-priority', 'emergency'],
    isBookmarked: false,
  },
  {
    id: 'c5m8q4r',
    name: 'Mediterranean Sea - 96h',
    model: 'AIFS Global',
    startedAt: '2025-10-01 09:45',
    productCount: 5,
    status: 'completed',
    tags: ['marine', 'operational'],
    isScheduled: true,
    isBookmarked: false,
  },
  {
    id: 'd1p6v2w',
    name: 'Arctic Region - 168h',
    model: 'AIFS Global',
    startedAt: '2025-10-02 10:15',
    productCount: 4,
    status: 'running',
    progress: 23,
    tags: ['climate', 'ice-analysis'],
    isBookmarked: false,
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
