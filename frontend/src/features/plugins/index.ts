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
 * Plugins Feature
 *
 * Plugin management components for the admin section.
 */

export { UninstalledPluginsSection } from './components/UninstalledPluginsSection'
export { BlockFactoryCard } from './components/BlockFactoryCard'
export { BlockFactoryList } from './components/BlockFactoryList'
export { CapabilityBadges } from './components/CapabilityBadges'
export { PluginCard } from './components/PluginCard'
export { PluginDetailPage } from './components/PluginDetailPage'
export { PluginIcon } from './components/PluginIcon'
export { PluginRow } from './components/PluginRow'
export {
  PluginsFilters,
  type CapabilityFilter,
  type StatusFilter,
} from './components/PluginsFilters'
export { PluginsList } from './components/PluginsList'
export { PluginsPageHeader } from './components/PluginsPageHeader'
export { PluginStatusBadge } from './components/PluginStatusBadge'
export { UpdatesAvailableSection } from './components/UpdatesAvailableSection'

// Utils
export {
  generatePluginPipeline,
  createSingleBlockFable,
  getDefaultValue,
} from './utils/pipeline-generator'
