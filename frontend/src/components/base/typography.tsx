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
import { Link as RouterLink } from '@tanstack/react-router'
import type { LinkProps } from '@tanstack/react-router'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * TYPOGRAPHY VARIANTS
 */
const typographyVariants = cva('text-foreground', {
  variants: {
    variant: {
      h1: 'scroll-m-20 text-3xl font-semibold tracking-tight',
      h2: 'scroll-m-20 text-xl font-semibold tracking-tight',
      h3: 'scroll-m-20 text-lg font-semibold tracking-tight',
      h4: 'scroll-m-20 text-base font-semibold tracking-tight',
      p: 'text-sm',
      blockquote: 'mt-6 border-l-2 pl-6 italic',
      list: 'my-6 ml-6 list-disc [&>li]:mt-2',
      lead: 'text-xl text-muted-foreground',
      large: 'text-lg font-semibold',
      small: 'text-sm font-medium leading-none',
      muted: 'text-sm text-muted-foreground',
    },
  },
  defaultVariants: {
    variant: 'p',
  },
})

/**
 * LINK VARIANTS
 */
const linkVariants = cva('font-normal transition-all cursor-pointer', {
  variants: {
    underline: {
      true: 'decoration-1 underline-offset-4 underline',
      false: '',
    },
    color: {
      primary: 'text-primary hover:text-primary/80',
      muted: 'text-muted-foreground hover:text-muted-foreground/80',
    },
  },
  compoundVariants: [
    {
      underline: true,
      color: 'primary',
      className: 'decoration-primary/20 hover:decoration-primary/50',
    },
    {
      underline: true,
      color: 'muted',
      className:
        'decoration-muted-foreground/20 hover:decoration-muted-foreground/50',
    },
  ],
  defaultVariants: {
    underline: true,
    color: 'primary',
  },
})

// Extract the variant type for TS support
type TypographyCvaProps = VariantProps<typeof typographyVariants>
type LinkCvaProps = VariantProps<typeof linkVariants>

/**
 * GENERIC COMPONENT
 * Useful if you want to swap tags dynamically, e.g. <Typography as="span" variant="h1">
 */
interface TypographyProps
  extends React.HTMLAttributes<HTMLElement>, TypographyCvaProps {
  as?: React.ElementType
}

const Typography = React.forwardRef<HTMLElement, TypographyProps>(
  ({ className, variant, as: Component = 'p', ...props }, ref) => {
    return (
      <Component
        className={cn(typographyVariants({ variant }), className)}
        ref={ref}
        {...props}
      />
    )
  },
)
Typography.displayName = 'Typography'

/**
 * EXPORTED NAMED COMPONENTS
 * This makes usage heavily semantically correct: <H1>Title</H1>
 */

export function H1({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      className={cn(typographyVariants({ variant: 'h1' }), className)}
      {...props}
    />
  )
}

export function H2({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(typographyVariants({ variant: 'h2' }), className)}
      {...props}
    />
  )
}

export function H3({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(typographyVariants({ variant: 'h3' }), className)}
      {...props}
    />
  )
}

export function H4({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h4
      className={cn(typographyVariants({ variant: 'h4' }), className)}
      {...props}
    />
  )
}

export function P({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(typographyVariants({ variant: 'p' }), className)}
      {...props}
    />
  )
}

export function Blockquote({
  className,
  ...props
}: React.HTMLAttributes<HTMLQuoteElement>) {
  return (
    <blockquote
      className={cn(typographyVariants({ variant: 'blockquote' }), className)}
      {...props}
    />
  )
}

export function List({
  className,
  ...props
}: React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className={cn(typographyVariants({ variant: 'list' }), className)}
      {...props}
    />
  )
}

/**
 * SPECIAL CASE: LINK COMPONENT
 * Handles external vs internal links automatically while using the CVA style.
 */
interface TypographyLinkProps
  extends Omit<LinkProps, 'className'>, LinkCvaProps {
  external?: boolean
  href?: string // Allow standard href for external links
  className?: string
}

export function Link({
  className,
  external,
  to,
  href,
  children,
  underline,
  color,
  ...props
}: TypographyLinkProps) {
  // Determine if it's an external link
  const isExternal = external || (href && href.startsWith('http'))

  // Resolve children - handle both ReactNode and render function
  const resolvedChildren =
    typeof children === 'function'
      ? children({ isActive: false, isTransitioning: false })
      : children

  if (isExternal) {
    const targetLink = href || (typeof to === 'string' ? to : '#')
    return (
      <a
        href={targetLink}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(linkVariants({ underline, color }), className)}
      >
        {resolvedChildren}
      </a>
    )
  }

  // For internal links, use TanStack Router's Link component
  return (
    <RouterLink
      to={to || '/'}
      className={cn(linkVariants({ underline, color }), className)}
      {...props}
    >
      {resolvedChildren}
    </RouterLink>
  )
}

export { Typography, typographyVariants, linkVariants }
