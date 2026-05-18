import * as React from 'react'
import { Autocomplete } from '@base-ui/react/autocomplete'
import { useTranslation } from 'react-i18next'

import { SearchIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { InputGroup, InputGroupAddon } from '@/components/ui/input-group'

/**
 * Command palette primitives built on Base UI Autocomplete.
 *
 * `Command` is the Autocomplete root — render it with `open` and `inline` so
 * the list is embedded directly in the dialog instead of a floating popup.
 * `CommandList` takes a render function over groups; `CommandCollection`
 * renders the filtered items inside each group.
 */
const Command = Autocomplete.Root

const CommandCollection = Autocomplete.Collection

function CommandDialog({
  title,
  description,
  className,
  showCloseButton = false,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, 'children'> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  children: React.ReactNode
}) {
  const { t } = useTranslation('common')
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn(
          'top-1/3 translate-y-0 gap-0 overflow-hidden rounded-xl! p-0',
          className,
        )}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title ?? t('commandPalette.title')}</DialogTitle>
          <DialogDescription>
            {description ?? t('commandPalette.description')}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof Autocomplete.Input>) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="h-8! rounded-lg! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
        <Autocomplete.Input
          data-slot="command-input"
          className={cn(
            'w-full bg-transparent text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof Autocomplete.List>) {
  return (
    <Autocomplete.List
      data-slot="command-list"
      className={cn(
        'no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto p-1 outline-none',
        className,
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Autocomplete.Empty>) {
  // Autocomplete.Empty keeps its root element mounted for screen readers and
  // only renders children while the list is empty — so put visible styling on
  // the inner node, leaving the root zero-height when results exist.
  return (
    <Autocomplete.Empty data-slot="command-empty" {...props}>
      <div
        className={cn(
          'py-6 text-center text-sm text-muted-foreground',
          className,
        )}
      >
        {children}
      </div>
    </Autocomplete.Empty>
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof Autocomplete.Group>) {
  return (
    <Autocomplete.Group
      data-slot="command-group"
      className={cn('overflow-hidden p-1 text-foreground', className)}
      {...props}
    />
  )
}

function CommandGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof Autocomplete.GroupLabel>) {
  return (
    <Autocomplete.GroupLabel
      data-slot="command-group-label"
      className={cn(
        'px-2 py-1.5 text-xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof Autocomplete.Item>) {
  return (
    <Autocomplete.Item
      data-slot="command-item"
      className={cn(
        "flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-hidden select-none data-highlighted:bg-muted data-highlighted:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

/** A single keycap chip, shared by the shortcut hints and the footer. */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-sm border bg-muted px-1 font-sans text-xs font-medium text-muted-foreground">
      {children}
    </kbd>
  )
}

function CommandShortcut({
  keys,
  className,
}: {
  /** Pre-formatted key labels, one keycap each (e.g. ['G', 'D']). */
  keys: Array<string>
  className?: string
}) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('ml-auto flex items-center gap-1', className)}
    >
      {keys.map((key, index) => (
        <Kbd key={`${index}-${key}`}>{key}</Kbd>
      ))}
    </span>
  )
}

/** Bottom hint bar making the palette's own keyboard controls explicit. */
function CommandFooter({ className }: { className?: string }) {
  const { t } = useTranslation('common')
  return (
    <div
      data-slot="command-footer"
      className={cn(
        'flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground',
        className,
      )}
    >
      <span className="flex items-center gap-1">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        {t('commandPalette.navigate')}
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd>
        {t('commandPalette.select')}
      </span>
      <span className="flex items-center gap-1">
        <Kbd>{t('commandPalette.esc')}</Kbd>
        {t('commandPalette.close')}
      </span>
    </div>
  )
}

export {
  Command,
  CommandCollection,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
}
