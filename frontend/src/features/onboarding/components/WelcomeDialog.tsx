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
import { useNavigate } from '@tanstack/react-router'
import { PresetPicker } from './PresetPicker'
import {
  BlocksIllustration,
  DashboardIllustration,
  ExecutionIllustration,
  ViewerIllustration,
  WelcomeIllustration,
} from './StepIllustrations'
import { useStarterTemplates } from '@/features/dashboard/hooks/useStarterTemplates'
import { templateConfigureSearch } from '@/features/dashboard/hooks/useTemplatePresets'
import { useOnboardingStore } from '@/stores/onboardingStore'
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
import { cn } from '@/lib/utils'

const STEPS = [
  'welcome',
  'dashboard',
  'blocks',
  'execution',
  'viewer',
  'activate',
] as const

/** Six-step welcome tour: what FIAB is, how it works, and a real start. */
export function WelcomeDialog() {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const { starters, isLoading } = useStarterTemplates()

  const [step, setStep] = useState(0)
  const [selectedPreset, setSelectedPreset] = useState(0)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const status = useOnboardingStore((state) => state.status)
  // A reopen from a decided state cannot resurrect auto-reshow, so the
  // checkbox would be inert — show the Help-reopen note instead.
  const firstVisit = status === 'not-started' || status === 'snoozed'

  const close = () => useOnboardingStore.getState().closeWelcome(dontShowAgain)

  const stepId = STEPS[step]
  const isLast = step === STEPS.length - 1

  const primaryLabel = !isLast
    ? step === 0
      ? t('welcome.takeTour')
      : t('welcome.continue')
    : t('activate.openConfigure')

  const primaryAction = () => {
    if (!isLast) {
      setStep(step + 1)
      return
    }
    useOnboardingStore.getState().startForecast()
    if (starters.length === 0) {
      void navigate({ to: '/configure', search: { fresh: true } })
      return
    }
    const template = starters[Math.min(selectedPreset, starters.length - 1)]
    void navigate({
      to: '/configure',
      search: templateConfigureSearch(template),
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-155">
        {/* Illustration area — only this frame swaps between steps */}
        <div className="relative h-58 shrink-0 overflow-hidden border-b bg-gradient-to-b from-[#eaf3f9] to-[#f6fafc] dark:from-primary/15 dark:to-muted/20">
          <div
            key={stepId}
            className="absolute inset-0 animate-in duration-300 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none"
          >
            {stepId === 'welcome' && <WelcomeIllustration />}
            {stepId === 'dashboard' && <DashboardIllustration />}
            {stepId === 'blocks' && <BlocksIllustration />}
            {stepId === 'execution' && <ExecutionIllustration />}
            {stepId === 'viewer' && <ViewerIllustration />}
            {stepId === 'activate' && (
              <PresetPicker
                starters={starters}
                isLoading={isLoading}
                selected={selectedPreset}
                onSelect={setSelectedPreset}
              />
            )}
          </div>
        </div>

        {/* Text area — fixed height so the dialog never resizes between steps */}
        <div className="flex min-h-47 flex-col gap-2 px-7 pt-6 pb-5">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[11px] text-muted-foreground">
              {t('welcome.stepCounter', {
                current: step + 1,
                total: STEPS.length,
              })}
            </span>
            <div className="flex gap-[5px]">
              {STEPS.map((id, index) => (
                <button
                  key={id}
                  type="button"
                  aria-label={t('dots.goTo', { step: index + 1 })}
                  aria-current={index === step ? 'step' : undefined}
                  onClick={() => setStep(index)}
                  className={cn(
                    'h-1.5 rounded-full transition-all duration-200',
                    index === step
                      ? 'w-[18px] bg-primary'
                      : 'w-1.5 bg-border hover:bg-muted-foreground/50',
                  )}
                />
              ))}
            </div>
          </div>

          <DialogTitle className="mt-1 text-xl font-semibold tracking-[-0.01em]">
            {t(`steps.${stepId}.title`)}
          </DialogTitle>
          <DialogDescription className="text-sm leading-[1.55] text-pretty">
            {t(`steps.${stepId}.body`)}
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
            {!isLast && (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={close}
              >
                {firstVisit ? t('welcome.skip') : t('welcome.close')}
              </Button>
            )}
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(step - 1)}
              >
                {t('welcome.back')}
              </Button>
            )}
            <Button size="sm" onClick={primaryAction}>
              {primaryLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
