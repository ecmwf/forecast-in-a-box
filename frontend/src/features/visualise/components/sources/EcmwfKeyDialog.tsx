/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Enter, check and remove the user's ECMWF API key. */

import { CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormEvent } from 'react'
import { Link, P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '@/components/ui/label'
import { CURATED_WMS_SERVERS } from '@/features/visualise/curated-wms'
import {
  ECMWF_KEY_PAGE_URL,
  keyTail,
  withEcmwfKey,
} from '@/features/visualise/ecmwf-key'
import { probeWmsEndpoint } from '@/features/visualise/wms-probe'
import { useEcmwfKeyStore } from '@/stores/ecmwfKeyStore'

const ECMWF_WMS_URL = CURATED_WMS_SERVERS.find((s) => s.name === 'ECMWF')!.url

type Check =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'error'; reason: 'rejected' | 'unreachable' }

export function EcmwfKeyDialog() {
  const { t } = useTranslation('visualise')
  const open = useEcmwfKeyStore((s) => s.dialogOpen)
  const close = useEcmwfKeyStore((s) => s.closeDialog)
  const current = useEcmwfKeyStore((s) => s.key)
  const setKey = useEcmwfKeyStore((s) => s.setKey)
  const clearKey = useEcmwfKeyStore((s) => s.clearKey)
  const [draft, setDraft] = useState('')
  const [check, setCheck] = useState<Check>({ state: 'idle' })
  const [revealed, setRevealed] = useState(false)
  const inputId = useId()

  const reset = () => {
    setDraft('')
    setCheck({ state: 'idle' })
    setRevealed(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const key = draft.trim()
    if (!key || check.state === 'checking') return
    setCheck({ state: 'checking' })
    // A keyed GetCapabilities is the check; it also seeds the layer cache.
    const result = await probeWmsEndpoint(withEcmwfKey(ECMWF_WMS_URL, key))
    if (result.ok) {
      setKey(key)
      reset()
      close()
      return
    }
    // ecCharts' 403 has no CORS headers, so a bad key reads as unreachable.
    const denied =
      result.reason === 'http' &&
      (result.status === 401 || result.status === 403)
    setCheck({ state: 'error', reason: denied ? 'rejected' : 'unreachable' })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        reset()
        close()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ecmwfKey.title')}</DialogTitle>
          <DialogDescription>{t('ecmwfKey.description')}</DialogDescription>
        </DialogHeader>
        {current !== null && (
          <P className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <CheckCircle2
              className="h-4 w-4 shrink-0 text-success"
              aria-hidden
            />
            <span className="font-medium">{t('ecmwfKey.activeTitle')}</span>
            <span className="text-muted-foreground">
              {t('ecmwfKey.activeTail', { tail: keyTail(current) })}
            </span>
          </P>
        )}
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={inputId}>
              {t(current === null ? 'ecmwfKey.label' : 'ecmwfKey.replaceLabel')}
            </Label>
            <InputGroup>
              <InputGroupInput
                id={inputId}
                type={revealed ? 'text' : 'password'}
                autoComplete="off"
                spellCheck={false}
                placeholder={t('ecmwfKey.placeholder')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-invalid={check.state === 'error' || undefined}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label={t(revealed ? 'ecmwfKey.hide' : 'ecmwfKey.show')}
                  aria-pressed={revealed}
                  onClick={() => setRevealed((v) => !v)}
                >
                  {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <Link href={ECMWF_KEY_PAGE_URL} external className="text-xs">
              {t('ecmwfKey.keyPage')}
            </Link>
          </div>
          {check.state === 'checking' && (
            <P className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t('ecmwfKey.checking')}
            </P>
          )}
          {check.state === 'error' && (
            <P role="alert" className="text-sm text-danger">
              {t(`ecmwfKey.${check.reason}`)}
            </P>
          )}
          <DialogFooter>
            {current !== null && (
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto"
                onClick={() => {
                  clearKey()
                  reset()
                  close()
                }}
              >
                {t('ecmwfKey.remove')}
              </Button>
            )}
            <Button
              type="submit"
              disabled={draft.trim() === '' || check.state === 'checking'}
            >
              {t(current === null ? 'ecmwfKey.save' : 'ecmwfKey.replace')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
