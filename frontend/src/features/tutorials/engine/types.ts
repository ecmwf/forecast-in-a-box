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
 * Guided-tour definition schema: ordered steps anchored to `data-tour`
 * elements, advanced by button press or by the user's real action. The
 * engine knows no page domain — tours bring their own launch type/signals.
 */

import type { TutorialId } from '@/stores/tutorialsStore'

export type { TutorialId }

export type SearchRecord = Record<string, unknown>

export type AdvanceWhen =
  | { kind: 'next-click' }
  /** `atEntry` = the search when the step was entered, so "changed since"
   * checks never pre-satisfy. */
  | {
      kind: 'search'
      check: (search: SearchRecord, atEntry: SearchRecord) => boolean
    }
  /** Any external state; `check` runs at entry and on each notification. */
  | {
      kind: 'signal'
      subscribe: (onChange: () => void) => () => void
      check: () => boolean
    }

/** Alternate presentation while a marker anchor is present (e.g. the
 * static-timeline notice). */
export interface StepVariant {
  whenPresent: string
  /** i18n prefix: steps.<id>.<key>Title / <key>Body. */
  key: string
  anchor?: string
  advance?: AdvanceWhen
}

/** "Show me": the step's real action — press the control or apply its URL. */
export type ShowMeAction =
  | {
      within: string
      /** Selector(s) in the anchor, by preference; omitted = the anchor. */
      selector?: string | ReadonlyArray<string>
      /** Follow-up press once its target appears (modals inert the page). */
      then?: ShowMeAction
    }
  | { search: (prev: SearchRecord) => SearchRecord }

export interface RuntimeSnapshot<TLaunch> {
  /** Null while the launch signals resolve. */
  launch: TLaunch | null
}

export interface TutorialStep<TLaunch = unknown> {
  /** i18n leaf: <tutorial>.steps.<id>.* */
  id: string
  /** `data-tour` id; absent = centered card. */
  anchor?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  advance: AdvanceWhen
  /** Keep the Next button on an action-advanced step. */
  allowNext?: boolean
  /** Anchor hidden inside a collapsed panel: click this control first. */
  expandVia?: string
  /** On entry, ask the page once to close open overlays. */
  closeDialog?: boolean
  variant?: StepVariant
  /** Function form resolves against the live snapshot (dynamic targets). */
  showMe?: ShowMeAction | ((ctx: RuntimeSnapshot<TLaunch>) => ShowMeAction)
  spotlightPadding?: number
}

export interface TutorialDefinition<TLaunch = unknown> {
  id: TutorialId
  route: string
  /** i18n subtree in the `tutorials` namespace, e.g. 'firstMap'. */
  i18nKey: string
  /** Interpolation values for every step's copy (e.g. the server name). */
  copyValues?: (launch: TLaunch) => Record<string, unknown>
  steps: ReadonlyArray<TutorialStep<TLaunch>>
}
