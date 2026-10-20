/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Fragment, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { outputTitle } from '../dims'
import type { OutputAdapter, OutputItem } from '../types'
import { cn } from '@/lib/utils'

interface FilmstripProps {
  items: ReadonlyArray<OutputItem>
  activeTaskId: string
  adapterFor: (item: OutputItem) => OutputAdapter
  onSelect: (item: OutputItem) => void
  /** Section of an item; a divider marks each change. */
  sectionOf?: (item: OutputItem) => string
  /** Badge text; defaults to the subtitle, else the position. */
  badgeOf?: (item: OutputItem) => string
}

/** Thumbnails of every viewable output; the active one stays in view. */
export function Filmstrip({
  items,
  activeTaskId,
  adapterFor,
  onSelect,
  sectionOf,
  badgeOf,
}: FilmstripProps) {
  const { t } = useTranslation('executions')
  const activeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
      behavior: 'smooth',
    })
  }, [activeTaskId])

  return (
    <nav
      aria-label={t('outputs.viewer.filmstrip')}
      className="shrink-0 border-t border-white/10 bg-neutral-950"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex [scrollbar-width:thin] [scrollbar-color:rgb(255_255_255/0.2)_transparent] gap-2 overflow-x-auto px-4 py-2.5">
        {items.map((item, index) => {
          const adapter = adapterFor(item)
          const { Thumbnail, icon: Icon } = adapter
          const active = item.taskId === activeTaskId
          const prev = index > 0 ? items[index - 1] : undefined
          const breaks =
            !!sectionOf && !!prev && sectionOf(prev) !== sectionOf(item)
          return (
            <Fragment key={item.taskId}>
              {breaks && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  className="mx-1 w-px shrink-0 self-stretch bg-white/20"
                />
              )}
              <button
                ref={active ? activeRef : undefined}
                type="button"
                aria-current={active || undefined}
                aria-label={t('outputs.viewer.filmstripItem', {
                  index: index + 1,
                  name: outputTitle(item),
                })}
                onClick={() => onSelect(item)}
                className={cn(
                  'relative w-28 shrink-0 overflow-hidden rounded-md outline-offset-2 transition-opacity focus-visible:outline-2 focus-visible:outline-white',
                  active ? 'ring-2 ring-white' : 'opacity-55 hover:opacity-100',
                )}
              >
                {Thumbnail ? (
                  <Thumbnail item={item} adapter={adapter} />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-white/5">
                    <Icon className="h-6 w-6 text-white/60" />
                  </div>
                )}
                <span className="absolute right-1 bottom-1 max-w-[calc(100%-0.5rem)] truncate rounded-sm bg-black/65 px-1 font-mono text-xs text-white tabular-nums">
                  {badgeOf?.(item) ?? item.subtitle ?? index + 1}
                </span>
              </button>
            </Fragment>
          )
        })}
      </div>
    </nav>
  )
}
