/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { WelcomeIllustration } from './WelcomeIllustration'
import { useOnboardingStore } from '@/stores/onboardingStore'
import { useTutorialsStore } from '@/stores/tutorialsStore'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog'

/** Welcome card; "Take the tour" hands over to the guided tour. */
export function WelcomeDialog() {
  const { t } = useTranslation('onboarding')
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const status = useOnboardingStore((state) => state.status)
  // A reopen from a decided state cannot resurrect auto-reshow, so the
  // checkbox would be inert — show the Help-reopen note instead.
  const firstVisit = status === 'not-started' || status === 'snoozed'

  const close = () => useOnboardingStore.getState().closeWelcome(dontShowAgain)

  // The card's snooze/skip is decided now; the tour runs independently.
  const takeTour = () => {
    close()
    useTutorialsStore.getState().start('welcome-tour')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-155">
        <div className="relative h-58 shrink-0 overflow-hidden border-b bg-gradient-to-b from-[#eaf3f9] to-[#f6fafc] dark:from-primary/15 dark:to-muted/20">
          <WelcomeIllustration />
        </div>

        <div className="flex flex-col gap-2 px-7 pt-6 pb-5">
          <DialogTitle className="text-xl font-semibold tracking-[-0.01em]">
            {t('steps.welcome.title')}
          </DialogTitle>
          <DialogDescription className="text-sm leading-[1.55] text-pretty">
            {t('steps.welcome.body')}
          </DialogDescription>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-3 border-t px-7 py-4 sm:justify-between">
          {firstVisit ? (
            <Label className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
              <Checkbox
                checked={dontShowAgain}
                onCheckedChange={(checked) =>
                  setDontShowAgain(checked === true)
                }
              />
              {t('welcome.dontShowAgain')}
            </Label>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t('welcome.reopened')}
            </span>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={close}
            >
              {firstVisit ? t('welcome.skip') : t('welcome.close')}
            </Button>
            <Button size="sm" onClick={takeTour}>
              {t('welcome.takeTour')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
