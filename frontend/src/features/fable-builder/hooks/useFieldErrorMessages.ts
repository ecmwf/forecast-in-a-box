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
import type { FieldErrorMessages } from '@/features/fable-builder/utils/map-block-errors-to-fields'

export function useFieldErrorMessages(): FieldErrorMessages {
  const { t } = useTranslation('configure')
  return useMemo<FieldErrorMessages>(
    () => ({
      unknownConfigKey: t('fieldErrors.unknownConfigKey'),
      missingRequiredValue: t('fieldErrors.missingRequiredValue'),
      unknownGlyph: (name) =>
        t('fieldErrors.unknownGlyph', { glyph: `\${${name}}` }),
    }),
    [t],
  )
}
