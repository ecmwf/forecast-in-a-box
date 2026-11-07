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
 * Media-player Space: runs an action even while a plain button inside the
 * viewer has focus, without clicking that button.
 */

import { useEffect, useEffectEvent } from 'react'

/** Text fields and widgets that use Space themselves (ARIA roles). */
const KEEPS_SPACE = [
  'input:not([type=button],[type=submit],[type=reset],[type=range])',
  'textarea',
  'select',
  'summary',
  '[contenteditable]:not([contenteditable=false])',
  ...[
    'textbox',
    'searchbox',
    'switch',
    'checkbox',
    'radio',
    'tab',
    'option',
    'treeitem',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'combobox',
    'listbox',
    'menu',
    'menubar',
    'tree',
    'grid',
    'treegrid',
  ].map((role) => `[role=${role}]`),
].join(',')

/** True with nothing focused or focus inside `scope`. */
function inScope(target: EventTarget | null, scope: string): boolean {
  if (target === document.body) return true
  return target instanceof Element && !!target.closest(scope)
}

export function useSpaceKey(
  action: () => void,
  options: {
    enabled: boolean
    /** Selector of the viewer root; Space elsewhere is left alone. */
    scope: string
    isBlocked?: () => boolean
  },
): void {
  const { enabled, scope, isBlocked } = options
  const run = useEffectEvent(action)
  const blocked = useEffectEvent(() => isBlocked?.() ?? false)

  useEffect(() => {
    if (!enabled) return
    let taken = false
    const onKeyDown = (e: KeyboardEvent) => {
      // Roles, not defaultPrevented: React Flow's pan key prevents every Space.
      if (e.code !== 'Space') return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (!inScope(e.target, scope) || blocked()) return
      if (e.target instanceof Element && e.target.closest(KEEPS_SPACE)) return
      e.preventDefault()
      taken = true
      run()
    }
    // A taken Space must not also click the focused button on release.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !taken) return
      taken = false
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [enabled, scope])
}
