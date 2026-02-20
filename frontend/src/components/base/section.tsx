/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/* -------------------------------------------------------------------------- */
/*                                1. SECTION                                  */
/* -------------------------------------------------------------------------- */

const sectionVariants = cva('w-full relative', {
  variants: {
    variant: {
      default: 'bg-background text-foreground',
      muted: 'bg-muted text-muted-foreground',
      primary: 'bg-primary text-primary-foreground',
      secondary: 'bg-secondary text-secondary-foreground',
    },
    padding: {
      none: 'py-0',
      sm: 'py-8 md:py-12',
      default: 'py-12 md:py-24', // Standard section spacing
      lg: 'py-24 md:py-32', // Hero section spacing
    },
  },
  defaultVariants: {
    variant: 'default',
    padding: 'default',
  },
})

interface SectionProps
  extends
    React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof sectionVariants> {
  as?: React.ElementType
}

function Section({
  className,
  variant,
  padding,
  as: Component = 'section',
  ...props
}: SectionProps) {
  return (
    <Component
      className={cn(sectionVariants({ variant, padding }), className)}
      {...props}
    />
  )
}

/* -------------------------------------------------------------------------- */
/*                                2. CONTAINER                                */
/* -------------------------------------------------------------------------- */

const containerVariants = cva('mx-auto px-4 md:px-6', {
  variants: {
    size: {
      default: 'max-w-6xl', // 1152px - Good balance
      sm: 'max-w-4xl', // For text-heavy content (blogs)
      lg: 'max-w-7xl', // For grid-heavy content (dashboards/features)
      full: 'max-w-full', // Edge to edge
    },
  },
  defaultVariants: {
    size: 'default',
  },
})

interface ContainerProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof containerVariants> {}

function Container({ className, size, ...props }: ContainerProps) {
  return (
    <div className={cn(containerVariants({ size }), className)} {...props} />
  )
}

/* -------------------------------------------------------------------------- */
/*                             3. SECTION HEADER                              */
/* -------------------------------------------------------------------------- */

// Holds the Title, Badge, and Description together with correct spacing
function SectionHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mb-8 flex flex-col gap-2 md:mb-12', className)}
      {...props}
    />
  )
}

/* -------------------------------------------------------------------------- */
/*                             4. HEADER TEXT                                 */
/* -------------------------------------------------------------------------- */

// We explicitly separate these so they don't clash with the global H1/H2
// but default to looking like them.

function SectionTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'text-3xl leading-tight font-semibold tracking-tight md:text-4xl',
        className,
      )}
      {...props}
    />
  )
}

function SectionDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        'max-w-200 text-lg text-muted-foreground md:text-xl',
        className,
      )}
      {...props}
    />
  )
}

export {
  Section,
  Container,
  SectionHeader,
  SectionTitle,
  SectionDescription,
  sectionVariants,
  containerVariants,
}
