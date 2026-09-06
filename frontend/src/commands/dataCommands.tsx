/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import { Bookmark, History } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NavigateFn } from '@tanstack/react-router'
import type { Command } from './registry'
import { useJobsStatus } from '@/api/hooks/useJobs'
import { useBlockCatalogue } from '@/api/hooks/useFable'
import {
  factoryIdToKey,
  flattenCatalogue,
  getBlockKindIcon,
  parseDisplayPluginId,
} from '@/api/types/fable.types'
import { useConfigPresets } from '@/features/dashboard/hooks/useConfigPresets'
import {
  templateConfigureSearch,
  useTemplatePresets,
} from '@/features/dashboard/hooks/useTemplatePresets'
import { useForecastRuns } from '@/features/journal/data/useForecastRuns'
import {
  isFactoryAvailable,
  useAvailableFactoryIds,
} from '@/features/fable-builder/hooks/useAvailableFactoryIds'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'

const RECENT_RUN_COUNT = 6

/** Saved presets and plugin templates, each opening in Configure. */
export function usePresetCommands(navigate: NavigateFn): Array<Command> {
  const { t } = useTranslation(['common', 'journal'])
  const { presets } = useConfigPresets()
  const { templates } = useTemplatePresets()

  return useMemo<Array<Command>>(() => {
    const saved = presets.map((preset): Command => ({
      id: `preset-${preset.blueprintId}`,
      label: preset.displayName || t('journal:item.untitled'),
      description: t('common:commands.preset.description'),
      icon: <Bookmark className="h-4 w-4" />,
      category: 'Presets',
      keywords: ['preset', ...preset.tags, preset.modelLabel ?? ''],
      action: () =>
        navigate({
          to: '/configure',
          search: { fableId: preset.blueprintId },
        }),
    }))
    const plugin = templates.map((template): Command => ({
      id: `template-${template.blueprintId}`,
      label: template.displayName || t('journal:item.untitled'),
      description: t('common:commands.template.description'),
      icon: <Bookmark className="h-4 w-4" />,
      category: 'Presets',
      keywords: ['template', 'preset', ...template.tags],
      action: () =>
        navigate({
          to: '/configure',
          search: templateConfigureSearch(template),
        }),
    }))
    return [...saved, ...plugin]
  }, [presets, templates, navigate, t])
}

/** The most recent runs, each opening its detail page. */
export function useRunCommands(navigate: NavigateFn): Array<Command> {
  const { t } = useTranslation(['common', 'journal'])
  const { data } = useJobsStatus(1, RECENT_RUN_COUNT)
  const { runs } = useForecastRuns(data?.runs ?? [])

  return useMemo<Array<Command>>(
    () =>
      runs.map((run) => ({
        id: `run-${run.runId}`,
        label: run.displayName || t('common:commands.run.untitled'),
        description: t(`journal:status.${run.status}`),
        icon: <History className="h-4 w-4" />,
        category: 'Runs',
        keywords: ['run', run.status, run.modelLabel ?? '', ...run.tags],
        action: () =>
          navigate({ to: '/execute/$jobId', params: { jobId: run.runId } }),
      })),
    [runs, navigate, t],
  )
}

/** Catalogue blocks the canvas can take right now; listed only while searching. */
export function useBlockCommands(active: boolean): Array<Command> {
  const { t } = useTranslation('common')
  const { data: catalogue } = useBlockCatalogue()
  const available = useAvailableFactoryIds()
  const addBlock = useFableBuilderStore((state) => state.addBlock)

  return useMemo<Array<Command>>(() => {
    if (!active || !catalogue) return []
    const commands: Array<Command> = []
    for (const { pluginId, factoryId, factory } of flattenCatalogue(
      catalogue,
    )) {
      const id = { plugin: parseDisplayPluginId(pluginId), factory: factoryId }
      const key = factoryIdToKey(id)
      if (!isFactoryAvailable(available, factory, key)) continue
      const Icon = getBlockKindIcon(factory.kind)
      commands.push({
        id: `block-${key}`,
        label: factory.title,
        description: t('commands.addBlock.description'),
        icon: <Icon className="h-4 w-4" />,
        category: 'Blocks',
        keywords: ['add', 'block', factory.kind, factory.description],
        searchOnly: true,
        action: () => addBlock(id, factory),
      })
    }
    return commands
  }, [active, catalogue, available, addBlock, t])
}
