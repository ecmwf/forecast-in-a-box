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
 * Dynamic Fields Utilities
 *
 * Utilities for finding matching field values in compiled exec_spec JSON
 * and building the nested dynamic_expr structure for the schedule API.
 */

/**
 * Recursively walk a JSON tree and return all paths where a leaf matches the target value.
 */
export function findFieldPaths(
  obj: unknown,
  targetValue: string,
  currentPath: Array<string> = [],
): Array<Array<string>> {
  const results: Array<Array<string>> = []

  if (obj === null || obj === undefined) return results

  if (typeof obj === 'string' && obj === targetValue) {
    results.push([...currentPath])
    return results
  }

  if (typeof obj === 'object') {
    const entries = Array.isArray(obj)
      ? obj.map((v, i) => [String(i), v] as const)
      : Object.entries(obj as Record<string, unknown>)

    for (const [key, value] of entries) {
      results.push(...findFieldPaths(value, targetValue, [...currentPath, key]))
    }
  }

  return results
}

/**
 * Convert an array of JSON paths into a nested object structure.
 * E.g., [["job", "config", "date"]] with expression "$execution_time" produces:
 * { job: { config: { date: "$execution_time" } } }
 */
export function buildNestedDynExpr(
  paths: Array<Array<string>>,
  expression: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const path of paths) {
    let current: Record<string, unknown> = result
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {}
      }
      current = current[key] as Record<string, unknown>
    }
    const lastKey = path[path.length - 1]
    current[lastKey] = expression
  }

  return result
}

/**
 * Flatten a nested dynamic_expr back into a list of { path, expression } entries
 * for display and toggling in the UI.
 */
export function flattenDynExpr(
  obj: Record<string, unknown>,
  currentPath: Array<string> = [],
): Array<{ path: Array<string>; expression: string }> {
  const results: Array<{ path: Array<string>; expression: string }> = []

  for (const [key, value] of Object.entries(obj)) {
    const fullPath = [...currentPath, key]
    if (typeof value === 'string') {
      results.push({ path: fullPath, expression: value })
    } else if (typeof value === 'object' && value !== null) {
      results.push(
        ...flattenDynExpr(value as Record<string, unknown>, fullPath),
      )
    }
  }

  return results
}
