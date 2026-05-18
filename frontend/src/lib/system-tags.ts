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
 * Internal "system" tags marking a blueprint created by running or scheduling
 * a forecast, rather than one explicitly saved as a preset.
 *
 * Workaround: the backend derives blueprint `source` from whether a
 * `display_name` was set, so it can't tell a named one-off run from a saved
 * preset. Until it exposes an explicit `source`, run/schedule submissions tag
 * their blueprint with `ONEOFF_TAG`; presets filter it out, tag displays strip
 * it. Drop this module once the backend `source` field exists.
 */

/** Prefix identifying an internal, non-user-facing tag. */
export const SYSTEM_TAG_PREFIX = '__fiab:'

/** Marks a blueprint created for a one-off run or schedule, not a saved preset. */
export const ONEOFF_TAG = `${SYSTEM_TAG_PREFIX}oneoff__`

/** Drop internal system markers, leaving only user-facing tags. */
export function stripSystemTags(
  tags: ReadonlyArray<string> | null | undefined,
): Array<string> {
  if (!tags) return []
  return tags.filter((tag) => !tag.startsWith(SYSTEM_TAG_PREFIX))
}

/** True when the blueprint was created by a run/schedule, not explicitly saved. */
export function isOneoffBlueprint(
  tags: ReadonlyArray<string> | null | undefined,
): boolean {
  return tags != null && tags.includes(ONEOFF_TAG)
}

/** Append the one-off marker to a tag list. Idempotent. */
export function withOneoffTag(
  tags: ReadonlyArray<string> | null | undefined,
): Array<string> {
  const base = tags ? [...tags] : []
  return base.includes(ONEOFF_TAG) ? base : [...base, ONEOFF_TAG]
}

/** Drop the one-off marker — promotes a one-off run blueprint to a saved preset. */
export function withoutOneoffTag(
  tags: ReadonlyArray<string> | null | undefined,
): Array<string> {
  return tags ? tags.filter((tag) => tag !== ONEOFF_TAG) : []
}
