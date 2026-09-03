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
 * Drives the active guided tour: anchors the coachmark (satisfied work
 * presents as review), subscribes the advance condition, renders the
 * spotlight; both hide while a modal is open. Route-leave ends the run.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { CheckCircle2, X } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { TUTORIALS } from './registry'
import { findTourElement, tourSelector } from './anchors'
import { isPreSatisfied, stepProgress } from './engine/stepMachine'
import { useAdvanceCondition } from './engine/useAdvanceCondition'
import { useDomPresence, useTourAnchor } from './engine/useTourAnchor'
import { CoachmarkCard } from './components/CoachmarkCard'
import { SpotlightShade } from './components/SpotlightShade'
import type { ReactElement } from 'react'
import type {
  AdvanceWhen,
  SearchRecord,
  ShowMeAction,
  StepBlocker,
  TutorialId,
} from './engine/types'
import { useTutorialsStore } from '@/stores/tutorialsStore'
import { Button } from '@/components/ui/button'
import { requestOverlayClose } from '@/lib/overlay-requests'
import { showToast } from '@/lib/toast'

const NEXT_CLICK: AdvanceWhen = { kind: 'next-click' }

/** Step keys are dynamic; the typed-key overloads cannot express them. */
const TransDyn = Trans as unknown as (props: {
  t: (key: string, opts?: Record<string, unknown>) => string
  i18nKey: string
  values?: Record<string, unknown>
  components?: Record<string, ReactElement>
}) => ReactElement

/** `<v>…</v>` in any tour copy: a setting value the user must enter. */
const VALUE_MARKUP = { v: <strong className="font-semibold text-foreground" /> }

type PressAction = Extract<ShowMeAction, { within: string }>

/** Our own modal dialogs (shadcn slots); the coachmark itself is non-modal. */
const MODAL_SELECTOR =
  '[data-slot="dialog-content"], [data-slot="alert-dialog-content"]'
/** Matches nothing — for steps without a `yieldTo` menu. */
const NEVER_SELECTOR = '[data-tour-never]'

/** Presses the first matching control in the anchor; false = none found. */
function pressShowMe(action: PressAction): boolean {
  const scope = findTourElement(action.within, action.withinMatch)
  if (scope === null) return false
  const selectors =
    action.selector === undefined
      ? []
      : typeof action.selector === 'string'
        ? [action.selector]
        : action.selector
  const target =
    selectors.length === 0
      ? scope
      : selectors.reduce<Element | null>(
          (found, sel) => found ?? scope.querySelector(sel),
          null,
        )
  if (!(target instanceof HTMLElement)) return false
  target.click()
  return true
}

export function TutorialRunner() {
  const active = useTutorialsStore((s) => s.active)
  if (active === null) return null
  return (
    <ActiveTutorial
      key={active.id}
      id={active.id}
      stepIndex={active.stepIndex}
    />
  )
}

function ActiveTutorial({
  id,
  stepIndex,
}: {
  id: TutorialId
  stepIndex: number
}) {
  const { definition: def, useLaunchContext } = TUTORIALS[id]
  const { t } = useTranslation('tutorials')
  const tDyn = t as (key: string, opts?: Record<string, unknown>) => string

  const launch = useLaunchContext()
  // Raw-string selector is structural-sharing-safe; parse off the router.
  const router = useRouter()
  const searchStr = useRouterState({ select: (s) => s.location.searchStr })
  const search = useMemo(
    () => router.state.location.search as SearchRecord,
    [router, searchStr],
  )
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const setStep = useTutorialsStore((s) => s.setStep)
  const finish = useTutorialsStore((s) => s.finish)

  const step = stepIndex < def.steps.length ? def.steps[stepIndex] : null
  const stepKeyBase = `${id}:${stepIndex}`

  useEffect(() => {
    if (step === null) finish('completed')
  }, [step, finish])

  // Variant marker (e.g. the static-timeline notice).
  const { element: variantMarker } = useTourAnchor(
    step?.variant?.whenPresent,
    step?.variant?.whenPresentMatch,
  )
  const variant =
    step?.variant !== undefined && variantMarker !== null
      ? step.variant
      : undefined

  const anchorId = variant?.anchor ?? step?.anchor
  const { element, rect } = useTourAnchor(
    anchorId,
    variant?.anchor === undefined ? step?.anchorMatch : undefined,
  )
  const modalOpen = useDomPresence(MODAL_SELECTOR)
  const yielding = useDomPresence(
    step?.yieldTo === undefined ? NEVER_SELECTOR : tourSelector(step.yieldTo),
  )

  // Per-step-entry snapshots; satisfied-at-entry = review mode.
  const baseAdvance = variant?.advance ?? step?.advance ?? NEXT_CLICK
  const entrySnapRef = useRef<{
    key: string
    search: SearchRecord
    reviewing: boolean
  }>({ key: '', search, reviewing: false })
  if (entrySnapRef.current.key !== stepKeyBase) {
    entrySnapRef.current = {
      key: stepKeyBase,
      search,
      reviewing: step !== null && isPreSatisfied(baseAdvance, search),
    }
  }
  const reviewing = step !== null && entrySnapRef.current.reviewing
  const advance = reviewing ? NEXT_CLICK : baseAdvance
  const stepKey = `${stepKeyBase}:${variant?.key ?? 'base'}`

  // Route-leave ends the run — unless the step expects it (then completes).
  useEffect(() => {
    if (pathname === def.route) return
    if (advance.kind === 'route' && advance.match(pathname)) return
    showToast.info(t('common.endedToast'))
    finish(null)
  }, [pathname, def.route, advance, finish, t])

  const goNext = () => {
    if (stepIndex + 1 >= def.steps.length) finish('completed')
    else setStep(stepIndex + 1)
  }
  const goNextRef = useRef(goNext)
  goNextRef.current = goNext

  // Why a signal step is still open; cleared on every step change.
  const [blocker, setBlocker] = useState<StepBlocker | null>(null)
  useEffect(() => setBlocker(null), [stepKey])

  useAdvanceCondition({
    advance,
    stepKey,
    searchAtEntry: entrySnapRef.current.search,
    onBlocker: setBlocker,
    onMet: () => {
      // A route step is terminal: the card is gone, so say it out loud.
      if (advance.kind === 'route')
        showToast.success(t('common.completedToast'))
      goNextRef.current()
    },
  })

  // Anchor hidden inside a collapsed panel: press the real expand handle.
  const expandedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (step?.expandVia === undefined || element !== null) return
    if (expandedForRef.current === stepKey) return
    const handle = findTourElement(step.expandVia)
    if (handle instanceof HTMLElement) {
      expandedForRef.current = stepKey
      handle.click()
    }
  }, [step, element, stepKey])

  // Step entered while a page dialog may be open: ask the page to close it.
  const closedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (step?.closeDialog !== true || closedForRef.current === stepKey) return
    closedForRef.current = stepKey
    requestOverlayClose()
  }, [step, stepKey])

  // A pending Show me follow-up never outlives its step (or the run).
  const followUpTimerRef = useRef<number | null>(null)
  const cancelFollowUp = useCallback(() => {
    if (followUpTimerRef.current !== null) {
      window.clearInterval(followUpTimerRef.current)
      followUpTimerRef.current = null
    }
  }, [])
  useEffect(() => cancelFollowUp, [stepKey, cancelFollowUp])

  // Missing-anchor grace: brief blanks render nothing, then a waiting card.
  const [seeking, setSeeking] = useState(false)
  useEffect(() => {
    if (anchorId === undefined || element !== null) {
      setSeeking(false)
      return
    }
    const timer = window.setTimeout(() => setSeeking(true), 500)
    return () => window.clearTimeout(timer)
  }, [anchorId, element])

  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [stepKey])

  if (launch === null || step === null) return null

  const progress = stepProgress(def.steps.length, stepIndex)
  const keyPrefix = `${def.i18nKey}.steps.${step.id}`
  const copyValues = def.copyValues?.(launch) ?? {}
  const markup = { ...VALUE_MARKUP, ...def.markup }
  const title = tDyn(
    variant ? `${keyPrefix}.${variant.key}Title` : `${keyPrefix}.title`,
    copyValues,
  )
  const bodyKey = variant
    ? `${keyPrefix}.${variant.key}Body`
    : `${keyPrefix}.body`

  const quit = () => finish('dismissed')
  const goBack = () => setStep(stepIndex - 1)
  const hasBack = stepIndex > 0
  const onShowMe = () => {
    if (step.showMe === undefined) return
    const action =
      typeof step.showMe === 'function' ? step.showMe({ launch }) : step.showMe
    if ('search' in action) {
      // The URL is page state — apply what the real control would.
      void router.navigate({
        to: '.',
        search: (prev: SearchRecord) => action.search(prev),
        replace: true,
      } as never)
      return
    }
    if ('apply' in action) {
      if (!action.apply()) showToast.info(t('common.showMeUnavailable'))
      return
    }
    if (!pressShowMe(action)) {
      showToast.info(t('common.showMeUnavailable'))
      return
    }
    const followUp = action.then
    if (followUp === undefined || !('within' in followUp)) return
    // Poll briefly for the follow-up target (e.g. a dialog just opened).
    cancelFollowUp()
    let tries = 0
    followUpTimerRef.current = window.setInterval(() => {
      if (pressShowMe(followUp) || ++tries >= 20) cancelFollowUp()
    }, 100)
  }

  const isAction = advance.kind !== 'next-click'
  const isLast = progress.current === progress.total
  const primaryLabel = !isAction
    ? reviewing
      ? t('common.continue')
      : isLast
        ? t('common.done')
        : progress.current === 1
          ? t('common.start')
          : t('common.next')
    : step.allowNext === true
      ? t('common.next')
      : null

  // Review steps show immediately even anchorless (their UI may be gone).
  const showCard =
    !modalOpen &&
    !yielding &&
    (element !== null || anchorId === undefined || seeking || reviewing)

  return (
    <>
      <SpotlightShade
        rect={element !== null && !modalOpen ? rect : null}
        padding={step.spotlightPadding}
      />
      {showCard && (
        <CoachmarkCard
          key={stepKey}
          element={element}
          side={step.side}
          align={step.align}
          labelledBy={headingId}
        >
          <div
            className="flex flex-col gap-2"
            onKeyDown={(e) => {
              if (e.key === 'Escape') quit()
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {t('common.stepOf', {
                  current: progress.current,
                  total: progress.total,
                })}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground"
                aria-label={t('common.close')}
                onClick={quit}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <h2
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className="text-sm font-semibold outline-none"
            >
              {title}
            </h2>
            <p className="text-sm text-muted-foreground">
              <TransDyn
                t={tDyn}
                i18nKey={bodyKey}
                values={copyValues}
                components={markup}
              />
            </p>
            {blocker !== null && !reviewing && (
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                <TransDyn
                  t={tDyn}
                  i18nKey={`${def.i18nKey}.${blocker.key}`}
                  values={{ ...copyValues, ...blocker.values }}
                  components={markup}
                />
              </p>
            )}
            {element === null && anchorId !== undefined && !reviewing && (
              <p className="text-xs text-muted-foreground italic">
                {t('common.waitingFor')}
              </p>
            )}
            {reviewing && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                {t('common.stepDone')}
              </p>
            )}
            <div className="mt-1 flex items-center justify-between gap-2">
              <Button
                variant="link"
                size="sm"
                className="h-7 px-0 text-xs text-muted-foreground"
                onClick={quit}
              >
                {t('common.skipTour')}
              </Button>
              <div className="flex items-center gap-2">
                {isAction && !reviewing && step.allowNext !== true && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-7 px-1 text-xs text-muted-foreground"
                    onClick={goNext}
                  >
                    {t('common.skipStep')}
                  </Button>
                )}
                {step.showMe !== undefined && !reviewing && (
                  <Button variant="ghost" size="sm" onClick={onShowMe}>
                    {t('common.showMe')}
                  </Button>
                )}
                {hasBack && (
                  <Button variant="outline" size="sm" onClick={goBack}>
                    {t('common.back')}
                  </Button>
                )}
                {primaryLabel !== null && (
                  <Button size="sm" onClick={goNext}>
                    {primaryLabel}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CoachmarkCard>
      )}
      <span aria-live="polite" className="sr-only">
        {t('common.stepOf', {
          current: progress.current,
          total: progress.total,
        })}
        {': '}
        {title}
      </span>
    </>
  )
}
