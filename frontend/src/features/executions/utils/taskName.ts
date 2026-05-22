/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Cascade emits task IDs like `module.path.func:HEXHASH` (or `take:HEXHASH`,
 * `_private_func:HEXHASH`). We split the trailing hash, title-case the
 * function name, and keep the hash as a chip so structural duplicates
 * remain distinguishable. */

export interface HumanisedTaskName {
  /** Primary label — the function or operation name, snake → Title Case. */
  headline: string
  /** Optional module path shown beneath the headline, or undefined for bare names. */
  modulePath: string | undefined
  /** First 8 chars of the content-hash, or undefined when the id has no hash. */
  hashChip: string | undefined
}

const HEX_HASH = /^[0-9a-f]{8,}$/i

/** `snake_case` → `Title Case`. Leading underscores (Python "private"
 * convention) are stripped so they don't show in the UI. */
function titleCase(token: string): string {
  const cleaned = token.replace(/^_+/, '')
  if (!cleaned) return token
  return cleaned
    .split('_')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ')
}

/** Split at the *last* colon — Cascade IDs end with `:HASH`. Trailing
 * segments that don't look hex-shaped aren't treated as hashes. */
function splitHashSuffix(taskId: string): {
  name: string
  hash: string | undefined
} {
  const idx = taskId.lastIndexOf(':')
  if (idx === -1) return { name: taskId, hash: undefined }
  const candidate = taskId.slice(idx + 1)
  if (!HEX_HASH.test(candidate)) return { name: taskId, hash: undefined }
  return { name: taskId.slice(0, idx), hash: candidate }
}

export function humaniseTaskName(taskId: string): HumanisedTaskName {
  const { name, hash } = splitHashSuffix(taskId)
  const hashChip = hash ? hash.slice(0, 8) : undefined

  // Dotted module path → last segment is the function, rest is the path.
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx !== -1) {
    return {
      headline: titleCase(name.slice(dotIdx + 1)),
      modulePath: name.slice(0, dotIdx),
      hashChip,
    }
  }

  // Bare name (e.g. `take`, `_empty_payload`).
  return {
    headline: titleCase(name),
    modulePath: undefined,
    hashChip,
  }
}
