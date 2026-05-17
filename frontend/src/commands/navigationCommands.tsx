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
 * Navigation Commands
 *
 * Commands for navigating to different pages and Getting Started presets.
 */

import {
  BarChart3,
  Database,
  History,
  Home,
  Layers,
  PlayCircle,
  Settings,
  Wrench,
} from 'lucide-react'
import i18n from 'i18next'
import type { NavigateFn } from '@tanstack/react-router'
import type { Command } from './registry'

/**
 * Create navigation commands with the router navigate function
 */
export function navigationCommands(navigate: NavigateFn): Array<Command> {
  return [
    // Getting Started presets
    {
      id: 'preset-quick-start',
      label: i18n.t('common:commands.quickStart.label'),
      description: i18n.t('common:commands.quickStart.description'),
      icon: <PlayCircle className="h-4 w-4 text-primary" />,
      category: 'Getting Started',
      keywords: ['quick', 'start', 'aifs', 'preset', 'recommended'],
      action: () =>
        navigate({ to: '/configure', search: { preset: 'quick-start' } }),
    },
    {
      id: 'preset-standard',
      label: i18n.t('common:commands.standard.label'),
      description: i18n.t('common:commands.standard.description'),
      icon: <BarChart3 className="h-4 w-4 text-blue-500" />,
      category: 'Getting Started',
      keywords: ['standard', 'forecast', 'model', 'configurable'],
      action: () =>
        navigate({ to: '/configure', search: { preset: 'standard' } }),
    },
    {
      id: 'preset-custom-model',
      label: i18n.t('common:commands.customModel.label'),
      description: i18n.t('common:commands.customModel.description'),
      icon: <Layers className="h-4 w-4 text-emerald-500" />,
      category: 'Getting Started',
      keywords: ['custom', 'model', 'blank', 'canvas', 'advanced'],
      action: () =>
        navigate({ to: '/configure', search: { preset: 'custom-model' } }),
    },
    {
      id: 'preset-dataset',
      label: i18n.t('common:commands.dataset.label'),
      description: i18n.t('common:commands.dataset.description'),
      icon: <Database className="h-4 w-4 text-purple-500" />,
      category: 'Getting Started',
      keywords: ['dataset', 'data', 'external', 'source'],
      action: () =>
        navigate({ to: '/configure', search: { preset: 'dataset' } }),
    },

    // Navigation
    {
      id: 'nav-dashboard',
      label: i18n.t('common:commands.dashboard.label'),
      description: i18n.t('common:commands.dashboard.description'),
      icon: <Home className="h-4 w-4" />,
      category: 'Navigation',
      keywords: ['home', 'dashboard', 'main'],
      hotkey: ['G', 'D'],
      action: () => navigate({ to: '/dashboard' }),
    },
    {
      id: 'nav-configure',
      label: i18n.t('common:commands.configure.label'),
      description: i18n.t('common:commands.configure.description'),
      icon: <Wrench className="h-4 w-4" />,
      category: 'Navigation',
      keywords: ['configure', 'fable', 'builder', 'new'],
      hotkey: ['G', 'C'],
      action: () => navigate({ to: '/configure' }),
    },
    {
      id: 'nav-executions',
      label: i18n.t('common:commands.executions.label'),
      description: i18n.t('common:commands.executions.description'),
      icon: <History className="h-4 w-4" />,
      category: 'Navigation',
      keywords: ['executions', 'history', 'past', 'runs', 'journal', 'jobs'],
      hotkey: ['G', 'E'],
      action: () => navigate({ to: '/executions' }),
    },
    {
      id: 'nav-admin',
      label: i18n.t('common:commands.admin.label'),
      description: i18n.t('common:commands.admin.description'),
      icon: <Settings className="h-4 w-4" />,
      category: 'Navigation',
      keywords: ['admin', 'settings', 'plugins', 'models'],
      hotkey: ['G', 'A'],
      action: () => navigate({ to: '/admin' }),
    },
  ]
}
