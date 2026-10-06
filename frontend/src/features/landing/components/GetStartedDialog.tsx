/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Fragment, useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Link } from '@/components/base/typography'
import { useAuth } from '@/features/auth/AuthContext'
import { copyToClipboard } from '@/lib/utils'
import { showToast } from '@/lib/toast'

const REPO = 'https://github.com/ecmwf/forecast-in-a-box/blob/main'
const SCRIPT_URL =
  'https://raw.githubusercontent.com/ecmwf/forecast-in-a-box/main/scripts/fiab.sh'
// Saved, not piped: the launcher re-runs and upgrades itself in place.
export const INSTALL_COMMAND = `curl -fsSLo fiab.sh ${SCRIPT_URL} && bash fiab.sh`
// From sm up, wrap the URL only after a path slash, never at its hyphens.
const URL_PARTS = SCRIPT_URL.split(/(?<=[^/]\/)(?=[^/])/)

/** The whole box copies in one click; no trailing newline, so paste never runs it. */
function InstallCommand() {
  const { t } = useTranslation('landing')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      aria-label={t('getStarted.copy')}
      onClick={() => {
        void copyToClipboard(INSTALL_COMMAND).then((ok) => {
          if (ok) setCopied(true)
          else showToast.error(t('getStarted.copyFailed'), INSTALL_COMMAND)
        })
      }}
      className="group flex w-full items-start gap-3 rounded-lg border bg-muted/60 px-4 py-3 text-left font-mono text-[13px] leading-relaxed transition-colors outline-none hover:border-foreground/20 hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span aria-hidden className="text-muted-foreground select-none">
        $
      </span>
      <code className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="font-medium">curl</span>{' '}
        <span className="text-muted-foreground">-fsSLo</span> fiab.sh{' '}
        <span className="text-primary">
          {URL_PARTS.map((part, i) => (
            <Fragment key={part}>
              {i > 0 && <wbr />}
              <span className="sm:whitespace-nowrap">{part}</span>
            </Fragment>
          ))}
        </span>{' '}
        <span className="text-muted-foreground">&&</span>{' '}
        <span className="font-medium">bash</span> fiab.sh
      </code>
      {/* Fixed slot, so "Copied" never reflows the command. */}
      <span className="flex w-16 shrink-0 items-center justify-end gap-1 pt-0.5 font-sans text-xs text-muted-foreground group-hover:text-foreground">
        {copied ? (
          <>
            <Check className="h-3.5 w-3.5 text-success" />
            {t('getStarted.copied')}
          </>
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </span>
      <span aria-live="polite" className="sr-only">
        {copied ? t('getStarted.copiedAnnouncement') : ''}
      </span>
    </button>
  )
}

/** Install-first entry: everyone can run it locally; registered users sign in. */
export function GetStartedDialog({
  trigger,
  children,
}: {
  trigger: ReactElement
  children: ReactNode
}) {
  const { t } = useTranslation('landing')
  const { signIn } = useAuth()
  return (
    <Dialog>
      <DialogTrigger render={trigger}>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-lg">{t('getStarted.title')}</DialogTitle>
          <DialogDescription>{t('getStarted.description')}</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-3">
          <InstallCommand />
          <p className="text-xs text-muted-foreground">
            <Trans
              t={t}
              i18nKey="getStarted.nextTime"
              components={{
                code: <code className="font-mono text-foreground" />,
              }}
            />
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <Link href={`${REPO}/docs/userGuide.md`} color="muted">
              {t('getStarted.userGuide')}
            </Link>
            <Link href={`${REPO}/scripts/fiab.sh`} color="muted">
              {t('getStarted.viewScript')}
            </Link>
            <Link href={`${REPO}/docs/troubleshooting.md`} color="muted">
              {t('getStarted.troubleshooting')}
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-muted-foreground">{t('getStarted.registered')}</p>
          <Button variant="outline" size="sm" onClick={() => signIn()}>
            {t('getStarted.signIn')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
