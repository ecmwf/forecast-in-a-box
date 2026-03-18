import * as React from 'react'

import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { cn } from '@/lib/utils'

const variantStyles: Record<DashboardVariant, string> = {
  default: 'bg-card border shadow-sm',
  flat: 'bg-muted/50 border-0 shadow-none',
  modern: 'bg-card/80 backdrop-blur-sm border border-border/50 shadow-md',
  gradient:
    'bg-gradient-to-br from-primary/5 via-card to-card border border-primary/10 shadow-sm',
}

const shadowStyles: Record<PanelShadow, string> = {
  none: 'shadow-none',
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg',
}

interface CardProps extends React.ComponentProps<'div'> {
  variant?: DashboardVariant
  shadow?: PanelShadow
}

function Card({
  className,
  variant = 'default',
  shadow = 'sm',
  ...props
}: CardProps) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-6 rounded-xl py-6 text-card-foreground',
        variantStyles[variant],
        shadowStyles[shadow],
        className,
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className,
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('leading-none font-semibold', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className,
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-6', className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6 [.border-t]:pt-6', className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
