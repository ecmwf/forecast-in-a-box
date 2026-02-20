/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useUiStore } from '@/stores/uiStore'

describe('uiStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useUiStore.getState().reset()
  })

  describe('theme', () => {
    it('starts with system theme', () => {
      expect(useUiStore.getState().theme).toBe('system')
    })

    it('sets light theme', () => {
      useUiStore.getState().setTheme('light')
      expect(useUiStore.getState().theme).toBe('light')
      expect(useUiStore.getState().resolvedTheme).toBe('light')
    })

    it('sets dark theme', () => {
      useUiStore.getState().setTheme('dark')
      expect(useUiStore.getState().theme).toBe('dark')
      expect(useUiStore.getState().resolvedTheme).toBe('dark')
    })

    it('toggles between light and dark', () => {
      useUiStore.getState().setTheme('light')
      useUiStore.getState().toggleTheme()
      expect(useUiStore.getState().resolvedTheme).toBe('dark')

      useUiStore.getState().toggleTheme()
      expect(useUiStore.getState().resolvedTheme).toBe('light')
    })
  })

  describe('layout', () => {
    it('starts with fluid layout mode', () => {
      expect(useUiStore.getState().layoutMode).toBe('fluid')
    })

    it('sets layout mode', () => {
      useUiStore.getState().setLayoutMode('boxed')
      expect(useUiStore.getState().layoutMode).toBe('boxed')
    })

    it('starts with gradient dashboard variant', () => {
      expect(useUiStore.getState().dashboardVariant).toBe('gradient')
    })

    it('sets dashboard variant', () => {
      useUiStore.getState().setDashboardVariant('modern')
      expect(useUiStore.getState().dashboardVariant).toBe('modern')
    })

    it('starts with no panel shadow', () => {
      expect(useUiStore.getState().panelShadow).toBe('none')
    })

    it('sets panel shadow', () => {
      useUiStore.getState().setPanelShadow('md')
      expect(useUiStore.getState().panelShadow).toBe('md')
    })

    it('sets panel shadow to all variants', () => {
      useUiStore.getState().setPanelShadow('sm')
      expect(useUiStore.getState().panelShadow).toBe('sm')

      useUiStore.getState().setPanelShadow('lg')
      expect(useUiStore.getState().panelShadow).toBe('lg')

      useUiStore.getState().setPanelShadow('none')
      expect(useUiStore.getState().panelShadow).toBe('none')
    })
  })

  describe('admin view modes', () => {
    it('has correct default view modes', () => {
      expect(useUiStore.getState().pluginsViewMode).toBe('table')
      expect(useUiStore.getState().modelsViewMode).toBe('table')
      expect(useUiStore.getState().sourcesViewMode).toBe('card')
    })

    it('sets plugins view mode', () => {
      useUiStore.getState().setPluginsViewMode('card')
      expect(useUiStore.getState().pluginsViewMode).toBe('card')
    })

    it('sets models view mode', () => {
      useUiStore.getState().setModelsViewMode('card')
      expect(useUiStore.getState().modelsViewMode).toBe('card')

      useUiStore.getState().setModelsViewMode('table')
      expect(useUiStore.getState().modelsViewMode).toBe('table')
    })

    it('sets sources view mode', () => {
      useUiStore.getState().setSourcesViewMode('table')
      expect(useUiStore.getState().sourcesViewMode).toBe('table')
    })
  })

  describe('setResolvedTheme', () => {
    it('sets resolved theme directly', () => {
      useUiStore.getState().setResolvedTheme('dark')
      expect(useUiStore.getState().resolvedTheme).toBe('dark')

      useUiStore.getState().setResolvedTheme('light')
      expect(useUiStore.getState().resolvedTheme).toBe('light')
    })

    it('does not change theme preference when setting resolved theme', () => {
      useUiStore.getState().setTheme('system')
      useUiStore.getState().setResolvedTheme('dark')

      expect(useUiStore.getState().theme).toBe('system')
      expect(useUiStore.getState().resolvedTheme).toBe('dark')
    })
  })

  describe('initialization', () => {
    it('starts as not initialized', () => {
      expect(useUiStore.getState().isInitialized).toBe(false)
    })

    it('sets initialized state', () => {
      useUiStore.getState().setIsInitialized(true)
      expect(useUiStore.getState().isInitialized).toBe(true)
    })
  })

  describe('reset', () => {
    it('resets all state to initial values', () => {
      // Modify some state
      useUiStore.getState().setTheme('dark')
      useUiStore.getState().setLayoutMode('boxed')
      useUiStore.getState().setIsInitialized(true)

      // Reset
      useUiStore.getState().reset()

      // Verify initial state is restored
      expect(useUiStore.getState().theme).toBe('system')
      expect(useUiStore.getState().layoutMode).toBe('fluid')
      expect(useUiStore.getState().isInitialized).toBe(false)
    })
  })
})
