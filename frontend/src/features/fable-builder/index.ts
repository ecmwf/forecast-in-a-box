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
 * Fable Builder Feature
 *
 * Feature module for building forecast configurations.
 */

// Components
export { FableBuilderPage } from './components/FableBuilderPage'
export { FableBuilderHeader } from './components/FableBuilderHeader'

// Store
export { useFableBuilderStore } from './stores/fableBuilderStore'
export type { BuilderMode, BuilderStep } from './stores/fableBuilderStore'
