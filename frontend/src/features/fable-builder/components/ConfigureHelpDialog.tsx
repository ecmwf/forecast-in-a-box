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
 * Feature guide + shortcut reference for the configuration canvas (header
 * help button); also the guided tour's second launch surface.
 */

import { GraduationCap } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { BLOCK_KIND_METADATA } from '@/api/types/fable.types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { P } from '@/components/base/typography'
import { useTutorialsStore } from '@/stores/tutorialsStore'

const SECTIONS = [
  'canvas',
  'palette',
  'configure',
  'validation',
  'run',
] as const

/** Kind tags in copy (`<sourceKind>` …) take the palette colours. */
const KIND_MARKUP = {
  sourceKind: (
    <span className={`font-medium ${BLOCK_KIND_METADATA.source.color}`} />
  ),
  transformKind: (
    <span className={`font-medium ${BLOCK_KIND_METADATA.transform.color}`} />
  ),
  productKind: (
    <span className={`font-medium ${BLOCK_KIND_METADATA.product.color}`} />
  ),
  outputKind: (
    <span className={`font-medium ${BLOCK_KIND_METADATA.sink.color}`} />
  ),
}

const SHORTCUTS = [
  { keys: formatForDisplay('Mod+Z'), id: 'undo' },
  { keys: formatForDisplay('Mod+Shift+Z'), id: 'redo' },
] as const

export function ConfigureHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('configure')
  const { t: tTut } = useTranslation('tutorials')
  const tourStatus = useTutorialsStore((s) => s.statuses['configure-first-run'])
  const startTour = () => {
    onOpenChange(false)
    useTutorialsStore.getState().start('configure-first-run')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('help.title')}</DialogTitle>
          <DialogDescription>{t('help.intro')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {SECTIONS.map((id) => (
            <section key={id}>
              <P className="text-sm font-semibold">
                {t(`help.sections.${id}.title`)}
              </P>
              <P className="mt-0.5 text-sm text-muted-foreground">
                <Trans
                  t={t}
                  i18nKey={`help.sections.${id}.body`}
                  components={KIND_MARKUP}
                />
              </P>
            </section>
          ))}

          <section>
            <P className="text-sm font-semibold">
              {tTut('launch.sectionTitle')}
            </P>
            <P className="mt-0.5 text-sm text-muted-foreground">
              {tTut('firstRun.title')} — {tTut('firstRun.description')}
              {tourStatus === 'completed' && (
                <span className="ml-1 text-xs">
                  · {tTut('launch.completed')}
                </span>
              )}
            </P>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 gap-1.5"
              onClick={startTour}
            >
              <GraduationCap className="h-3.5 w-3.5" />
              {tTut('launch.take')}
            </Button>
          </section>

          <section>
            <P className="text-sm font-semibold">{t('help.shortcuts.title')}</P>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {SHORTCUTS.map(({ keys, id }) => (
                  <tr key={id} className="border-b border-border/60">
                    <td className="w-24 py-1 pr-3 whitespace-nowrap">
                      <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {keys}
                      </kbd>
                    </td>
                    <td className="py-1 text-muted-foreground">
                      {t(`help.shortcuts.${id}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
