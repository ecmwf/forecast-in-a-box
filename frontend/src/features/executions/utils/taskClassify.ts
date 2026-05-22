/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Classify a task by its id prefix. The kind drives an icon + colour so the
 * compilation graph reads at a glance without the full module path. */

import {
  ArrowRightFromLine,
  Box,
  Brain,
  CircleDashed,
  Filter,
  MapPin,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type TaskKind =
  | 'select'
  | 'inference'
  | 'payload'
  | 'plot'
  | 'transform'
  | 'unknown'

export interface TaskKindMeta {
  /** Lucide icon to render in the node header. */
  icon: LucideIcon
  /** Tailwind text-colour token applied to the icon. */
  iconColor: string
  /** Tailwind border-colour token applied to the node when highlighted. */
  accentBorder: string
  /** i18n key (under executions.compilation.taskKind) for the label. */
  labelKey:
    | 'select'
    | 'inference'
    | 'payload'
    | 'plot'
    | 'transform'
    | 'unknown'
}

// Hues aligned with BLOCK_KIND_METADATA so the compilation views share the
// source=blue / transform=amber / product=purple / sink=emerald palette.
export const TASK_KIND_META: Record<TaskKind, TaskKindMeta> = {
  select: {
    icon: Filter,
    iconColor: 'text-amber-500',
    accentBorder: 'border-amber-500',
    labelKey: 'select',
  },
  inference: {
    icon: Brain,
    iconColor: 'text-purple-500',
    accentBorder: 'border-purple-500',
    labelKey: 'inference',
  },
  payload: {
    icon: Box,
    iconColor: 'text-blue-500',
    accentBorder: 'border-blue-500',
    labelKey: 'payload',
  },
  plot: {
    icon: MapPin,
    iconColor: 'text-emerald-500',
    accentBorder: 'border-emerald-500',
    labelKey: 'plot',
  },
  transform: {
    icon: ArrowRightFromLine,
    iconColor: 'text-amber-500',
    accentBorder: 'border-amber-500',
    labelKey: 'transform',
  },
  unknown: {
    icon: CircleDashed,
    iconColor: 'text-muted-foreground',
    accentBorder: 'border-muted-foreground',
    labelKey: 'unknown',
  },
}

/**
 * The kind is derived purely from the task id, so it's stable across runs and
 * cheap to recompute. We look at the *name* portion (everything before the
 * final `:HASH`) and match on the segment that conveys intent.
 */
export function classifyTask(taskId: string): TaskKind {
  const idx = taskId.lastIndexOf(':')
  const name = idx === -1 ? taskId : taskId.slice(0, idx)

  if (name === 'take') return 'select'
  // The cascade `take` operation has no module path — it's a bare verb.
  if (name.endsWith('.take')) return 'select'

  if (name.includes('inference.run_as_earthkit')) return 'inference'
  if (name.endsWith('.run_as_earthkit_from_config')) return 'inference'

  if (name.endsWith('_get_initial_conditions_from_config')) return 'payload'
  if (name === '_empty_payload' || name.endsWith('._empty_payload'))
    return 'payload'

  if (name.includes('plots.map_plot') || name.endsWith('.map_plot'))
    return 'plot'
  if (name.includes('.plots.')) return 'plot'

  if (name.includes('.statistics.') || name.includes('.transform'))
    return 'transform'

  return 'unknown'
}
