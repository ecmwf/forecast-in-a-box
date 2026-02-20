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
import type { NavigateFn } from '@tanstack/react-router'
import type { Command } from './index'

/**
 * Create navigation commands with the router navigate function
 */
export function navigationCommands(navigate: NavigateFn): Array<Command> {
  return [
    // Getting Started presets
    {
      id: 'preset-quick-start',
      label: 'Quick Start',
      description: 'Start with AIFS model preset',
      icon: <PlayCircle className="h-4 w-4 text-primary" />,
      category: 'Getting Started',
      keywords: ['quick', 'start', 'aifs', 'preset', 'recommended'],
      action: () =>
        navigate({ to: '/configure', search: { preset: 'quick-start' } }),
    },
    {
      id: 'preset-standard',
      label: 'Standard Forecast',
      description: 'Choose model, 120h forecast',
      icon: <BarChart3 className="h-4 w-4 text-blue-500" />,
      category: 'Getting Started',
      keywords: ['standard', 'forecast', 'model', 'configurable'],
      action: () =>
        navigate({ to: '/configure', search: { preset: 'standard' } }),
    },
    {
      id: 'preset-custom-model',
      label: 'Custom Model Forecast',
      description: 'Blank canvas, full control',
      icon: <Layers className="h-4 w-4 text-emerald-500" />,
      category: 'Getting Started',
      keywords: ['custom', 'model', 'blank', 'canvas', 'advanced'],
      action: () =>
        navigate({ to: '/configure', search: { preset: 'custom-model' } }),
    },
    {
      id: 'preset-dataset',
      label: 'Dataset Forecast',
      description: 'Use AIFS data from external source',
      icon: <Database className="h-4 w-4 text-purple-500" />,
      category: 'Getting Started',
      keywords: ['dataset', 'data', 'external', 'source'],
      action: () =>
        navigate({ to: '/configure', search: { preset: 'dataset' } }),
    },

    // Navigation
    {
      id: 'nav-dashboard',
      label: 'Dashboard',
      description: 'Go to dashboard',
      icon: <Home className="h-4 w-4" />,
      category: 'Navigation',
      keywords: ['home', 'dashboard', 'main'],
      action: () => navigate({ to: '/dashboard' }),
    },
    {
      id: 'nav-configure',
      label: 'Configure',
      description: 'Create a new forecast configuration',
      icon: <Wrench className="h-4 w-4" />,
      category: 'Navigation',
      keywords: ['configure', 'fable', 'builder', 'new'],
      action: () => navigate({ to: '/configure' }),
    },
    {
      id: 'nav-executions',
      label: 'Executions',
      description: 'Monitor forecast job executions',
      icon: <History className="h-4 w-4" />,
      category: 'Navigation',
      keywords: ['executions', 'history', 'past', 'runs', 'journal', 'jobs'],
      action: () => navigate({ to: '/executions' }),
    },
    {
      id: 'nav-admin',
      label: 'Admin',
      description: 'Manage plugins and models',
      icon: <Settings className="h-4 w-4" />,
      category: 'Navigation',
      keywords: ['admin', 'settings', 'plugins', 'models'],
      action: () => navigate({ to: '/admin' }),
    },
  ]
}
