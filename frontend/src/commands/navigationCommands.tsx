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
 * Commands for navigating to different pages and starting a new configuration.
 */

import { Earth, History, Home, Layers, Settings, Wrench } from 'lucide-react'
import i18n from 'i18next'
import type { NavigateFn } from '@tanstack/react-router'
import type { Command } from './registry'

/**
 * Create navigation commands with the router navigate function
 */
export function navigationCommands(navigate: NavigateFn): Array<Command> {
  return [
    {
      id: 'new-configuration',
      label: i18n.t('common:commands.newConfiguration.label'),
      description: i18n.t('common:commands.newConfiguration.description'),
      icon: <Layers className="h-4 w-4 text-primary" />,
      category: 'Getting Started',
      keywords: ['new', 'blank', 'canvas', 'configure', 'forecast'],
      action: () => navigate({ to: '/configure' }),
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
      action: () => navigate({ to: '/overview' }),
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
      action: () => navigate({ to: '/runs' }),
    },
    {
      id: 'nav-visualise',
      label: i18n.t('common:commands.visualise.label'),
      description: i18n.t('common:commands.visualise.description'),
      icon: <Earth className="h-4 w-4" />,
      category: 'Navigation',
      keywords: ['visualise', 'visualize', 'map', 'compare', 'wms', 'viewer'],
      hotkey: ['G', 'V'],
      action: () => navigate({ to: '/visualise' }),
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
