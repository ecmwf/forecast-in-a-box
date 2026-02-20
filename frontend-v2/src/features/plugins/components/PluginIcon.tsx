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
 * PluginIcon Component
 *
 * Displays an icon for a plugin based on its capabilities
 */

import { Cloud, Cog, Download, Puzzle, Shuffle } from 'lucide-react'
import type { ComponentType } from 'react'
import type { PluginCapability, PluginInfo } from '@/api/types/plugins.types'
import { cn } from '@/lib/utils'

interface PluginIconProps {
  plugin: PluginInfo
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

// Icons mapped to capabilities (matching BLOCK_KIND_METADATA)
const capabilityIcons: Record<
  PluginCapability,
  ComponentType<{ className?: string }>
> = {
  source: Cloud,
  transform: Shuffle,
  product: Cog,
  sink: Download,
}

const capabilityColors: Record<PluginCapability, string> = {
  source: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  transform:
    'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  product:
    'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
  sink: 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
}

const defaultColor =
  'bg-gray-100 dark:bg-gray-900/30 text-gray-600 dark:text-gray-400'

const sizeClasses = {
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12',
}

const iconSizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
}

export function PluginIcon({
  plugin,
  size = 'md',
  className,
}: PluginIconProps) {
  // Use primary capability (first in array) for icon and color, fallback to Puzzle
  const primaryCapability =
    plugin.capabilities.length > 0 ? plugin.capabilities[0] : null

  const IconComponent: ComponentType<{ className?: string }> = primaryCapability
    ? capabilityIcons[primaryCapability]
    : Puzzle

  const colorClass = primaryCapability
    ? capabilityColors[primaryCapability]
    : defaultColor

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg',
        sizeClasses[size],
        colorClass,
        className,
      )}
    >
      <IconComponent className={iconSizeClasses[size]} />
    </div>
  )
}
