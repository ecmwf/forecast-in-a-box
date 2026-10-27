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
import { useTranslation } from 'react-i18next'
import { SETTING_PREFIX, orderDims } from './dims'
import type { BlockSetting, BlockSettings } from './block-settings'
import type { OutputDim } from './dims'
import type { RunOutputs } from '@/api/types/job.types'
import type { ParamLabelVariant } from '@/components/base/fields/param-display'
import { useParamLabels } from '@/api/hooks/useFable'
import {
  listItems,
  paramLabel,
  paramListLabel,
} from '@/components/base/fields/param-display'

export interface DimFormat {
  /** Dimension name, e.g. "Parameter". */
  key: (key: string) => string
  /** One coordinate, e.g. "2t" or "step 6". */
  value: (key: string, value: string, variant: ParamLabelVariant) => string
  /** One coordinate without its dimension name, e.g. "2t" or "6". */
  short: (key: string, value: string) => string
  /** All coordinates, outer to inner. */
  dims: (dims: ReadonlyArray<OutputDim>, variant: ParamLabelVariant) => string
}

/** Coordinate and setting labels; param ids as GRIB names. */
export function useDimFormat(
  outputs: RunOutputs | null,
  blockSettings?: BlockSettings,
): DimFormat {
  const { t } = useTranslation('executions')
  /** Title and kind per setting key. */
  const settingByKey = useMemo(() => {
    const byKey = new Map<string, BlockSetting>()
    for (const setting of Object.values(blockSettings ?? {}).flat()) {
      const k = `${SETTING_PREFIX}${setting.key}`
      if (!byKey.has(k)) byKey.set(k, setting)
    }
    return byKey
  }, [blockSettings])
  const paramIds = useMemo(
    () => [
      ...Object.values(outputs ?? {}).flatMap((meta) =>
        (meta.dimension_kvs ?? [])
          .filter(([key]) => key === 'param')
          .map(([, value]) => value),
      ),
      ...Object.values(blockSettings ?? {})
        .flat()
        .flatMap((setting) =>
          setting.isParam ? listItems(setting.value) : [],
        ),
    ],
    [outputs, blockSettings],
  )
  const labels = useParamLabels(paramIds)

  return useMemo(() => {
    const settingLabel = (
      setting: BlockSetting,
      v: string,
      variant: ParamLabelVariant,
    ): string => (setting.isParam ? paramListLabel(v, labels, variant) : v)
    const key = (k: string): string => {
      const setting = settingByKey.get(k)
      if (setting) return setting.title
      switch (k) {
        case 'param':
          return t('outputs.dims.param')
        case 'step':
          return t('outputs.dims.step')
        case 'number':
          return t('outputs.dims.number')
        case 'levelist':
          return t('outputs.dims.levelist')
        default:
          return k
      }
    }
    const value = (
      k: string,
      v: string,
      variant: ParamLabelVariant,
    ): string => {
      const setting = settingByKey.get(k)
      if (setting) {
        return t('outputs.dims.otherValue', {
          key: setting.title.toLowerCase(),
          value: settingLabel(setting, v, variant),
        })
      }
      switch (k) {
        case 'param':
          return paramLabel(v, labels, variant)
        case 'step':
          return t('outputs.dims.stepValue', { value: v })
        case 'number':
          return t('outputs.dims.numberValue', { value: v })
        case 'levelist':
          return t('outputs.dims.levelistValue', { value: v })
        default:
          return t('outputs.dims.otherValue', { key: k, value: v })
      }
    }
    return {
      key,
      value,
      short: (k, v) => {
        const setting = settingByKey.get(k)
        if (setting) return settingLabel(setting, v, 'compact')
        return k === 'param' ? paramLabel(v, labels, 'compact') : v
      },
      dims: (dims, variant) =>
        orderDims(dims)
          .map(([k, v]) => value(k, v, variant))
          .join(' · '),
    }
  }, [t, labels, settingByKey])
}
