/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Helpers for the activity records that track plugin operations. */

import i18n from 'i18next'

/** Failed-activity description carrying the backend's `detail`; the toast is transient, this record is not. */
export function pluginFailureDescription(
  error: unknown,
  failureLabel: string,
): string {
  const reason = error instanceof Error ? error.message.trim() : ''
  if (!reason) return failureLabel
  return i18n.t('plugins:activity.failedWithReason', {
    label: failureLabel,
    reason,
  })
}
