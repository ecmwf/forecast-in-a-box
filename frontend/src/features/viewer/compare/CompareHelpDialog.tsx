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
 * Feature guide + shortcut reference for the compare viewer, opened from
 * the toolbar info icon or `?`. Content lives in the `compare` i18n
 * namespace under `help.*`.
 */

import { useTranslation } from 'react-i18next'
import { COMPARE_KEYS, keyLabel } from './useCompareShortcuts'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { P } from '@/components/base/typography'

const SECTIONS = ['modes', 'layers', 'time', 'tools', 'export'] as const

type ShortcutId =
  | 'sidebars'
  | 'modes'
  | 'pan'
  | 'annotate'
  | 'fit'
  | 'copy'
  | 'export'
  | 'flicker'
  | 'loupe'
  | 'swipe'
  | 'help'

const SHORTCUTS: ReadonlyArray<{
  keys: ReadonlyArray<string>
  id: ShortcutId
}> = [
  { keys: [keyLabel(COMPARE_KEYS.sidebars)], id: 'sidebars' },
  {
    keys: [
      keyLabel(COMPARE_KEYS.modes[0]),
      '…',
      keyLabel(COMPARE_KEYS.modes[4]),
    ],
    id: 'modes',
  },
  { keys: COMPARE_KEYS.pan.map(keyLabel), id: 'pan' },
  { keys: [keyLabel(COMPARE_KEYS.annotate)], id: 'annotate' },
  { keys: [keyLabel(COMPARE_KEYS.fit)], id: 'fit' },
  { keys: [keyLabel(COMPARE_KEYS.copy)], id: 'copy' },
  { keys: [keyLabel(COMPARE_KEYS.export)], id: 'export' },
  { keys: [keyLabel('Space')], id: 'flicker' },
  { keys: ['Z'], id: 'loupe' },
  { keys: [keyLabel('ArrowLeft'), keyLabel('ArrowRight')], id: 'swipe' },
  { keys: [keyLabel(COMPARE_KEYS.help)], id: 'help' },
]

export function CompareHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('compare')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('help.title')}</DialogTitle>
          <DialogDescription>{t('help.intro')}</DialogDescription>
        </DialogHeader>

        {/* Two-column flow: five feature sections + the shortcut table
            as the sixth block — keeps the dialog page-shaped instead of
            a scroll tunnel. */}
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {SECTIONS.map((id) => (
            <section key={id}>
              <P className="text-sm font-semibold">
                {t(`help.sections.${id}.title`)}
              </P>
              <P className="mt-0.5 text-sm text-muted-foreground">
                {t(`help.sections.${id}.body`)}
              </P>
            </section>
          ))}

          <section>
            <P className="text-sm font-semibold">{t('help.shortcuts.title')}</P>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {SHORTCUTS.map(({ keys, id }) => (
                  <tr key={id} className="border-b border-border/60">
                    <td className="w-16 py-1 pr-3 whitespace-nowrap">
                      {keys.map((k, i) => (
                        <span key={i}>
                          {i > 0 && k !== '…' && keys[i - 1] !== '…' && (
                            <span className="text-muted-foreground"> </span>
                          )}
                          {k === '…' ? (
                            <span className="px-0.5 text-muted-foreground">
                              …
                            </span>
                          ) : (
                            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                              {k}
                            </kbd>
                          )}
                        </span>
                      ))}
                    </td>
                    <td className="py-1 text-muted-foreground">
                      {t(`help.shortcuts.${id}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <P className="mt-1.5 text-xs text-muted-foreground">
              {t('help.shortcuts.revealHint', { key: keyLabel('Mod') })}
            </P>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
