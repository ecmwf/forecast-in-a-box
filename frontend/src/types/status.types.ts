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
 * Status-related types and schemas for the FIAB application
 * Matches the backend API response model
 * Uses Zod for runtime validation
 */

import { z } from 'zod'

/**
 * Known component status values
 */
export type ComponentStatus = 'up' | 'down' | 'off'

/**
 * Traffic light status for overall system health
 * - unknown: Status not yet determined (initial loading state)
 * - green: All active components are up
 * - orange: Some (but not all) active components are down
 * - red: All active components are down
 */
export type TrafficLightStatus = 'unknown' | 'green' | 'orange' | 'red'

/**
 * Zod schema for status values
 * Allows known status values and any other string (for future extensibility)
 */
export const statusValueSchema = z.string()

/**
 * Zod schema for status response from the API
 * GET /api/v1/status
 */
export const statusResponseSchema = z.object({
  api: statusValueSchema,
  cascade: statusValueSchema,
  ecmwf: statusValueSchema,
  scheduler: statusValueSchema,
  version: z.string(),
})

/**
 * Zod schema for individual service status
 */
export const serviceStatusSchema = z.object({
  name: z.string(),
  status: statusValueSchema,
  label: z.string(),
})

/**
 * TypeScript types inferred from Zod schemas
 */
export type StatusValue = z.infer<typeof statusValueSchema>
export type StatusResponse = z.infer<typeof statusResponseSchema>
export type ServiceStatus = z.infer<typeof serviceStatusSchema>

/**
 * Component names in the status response (excluding version)
 */
export const STATUS_COMPONENTS = [
  'api',
  'cascade',
  'ecmwf',
  'scheduler',
] as const
export type StatusComponent = (typeof STATUS_COMPONENTS)[number]

/**
 * Computes the traffic light status from a status response
 * Components with status 'off' are excluded from calculation
 *
 * @param status - The status response from the API
 * @returns The traffic light status (green, orange, or red)
 */
export function computeTrafficLightStatus(
  status: StatusResponse | null | undefined,
): TrafficLightStatus {
  if (!status) {
    return 'unknown' // Status not yet determined
  }

  // Get statuses for all components (excluding version)
  const componentStatuses = STATUS_COMPONENTS.map(
    (component) => status[component] as ComponentStatus,
  )

  // Filter out components that are 'off' - they don't count
  const activeStatuses = componentStatuses.filter((s) => s !== 'off')

  // If no active components, consider it green (nothing to monitor)
  if (activeStatuses.length === 0) {
    return 'green'
  }

  const upCount = activeStatuses.filter((s) => s === 'up').length
  const totalActive = activeStatuses.length

  if (upCount === totalActive) {
    return 'green' // All active components are up
  }

  if (upCount === 0) {
    return 'red' // All active components are down
  }

  return 'orange' // Some are up, some are down
}

/**
 * Get the label for a traffic light status
 */
export function getTrafficLightLabel(status: TrafficLightStatus): string {
  switch (status) {
    case 'unknown':
      return 'Checking...'
    case 'green':
      return 'All Systems Normal'
    case 'orange':
      return 'Partial Outage'
    case 'red':
      return 'System Outage'
  }
}

/**
 * Get detailed component status information
 * Returns empty array when status is not yet determined
 */
export function getComponentStatusDetails(
  status: StatusResponse | null | undefined,
): Array<{
  component: StatusComponent
  status: ComponentStatus
  isActive: boolean
}> {
  if (!status) {
    return [] // Status not yet determined
  }

  return STATUS_COMPONENTS.map((component) => {
    const componentStatus = status[component] as ComponentStatus
    return {
      component,
      status: componentStatus,
      isActive: componentStatus !== 'off',
    }
  })
}
