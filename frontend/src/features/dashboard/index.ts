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
 * Dashboard Feature
 *
 * Main dashboard page components and utilities
 */

// Components
export { WelcomeCard } from './components/WelcomeCard'
export { CommunityNewsCard } from './components/CommunityNewsCard'
export { ConfigPresetsSection } from './components/ConfigPresetsSection'
export { GettingStartedSection } from './components/GettingStartedSection'
export { GettingStartedCard } from './components/GettingStartedCard'
export { ForecastJournal } from './components/ForecastJournal'
export { StatCard } from './components/StatCard'
export { QuickActionButton } from './components/QuickActionButton'

// Types
export type {
  ModelInfo,
  ForumTopic,
  ForecastJob,
  ForecastStatus,
  DashboardStats,
} from './data/mockData'
