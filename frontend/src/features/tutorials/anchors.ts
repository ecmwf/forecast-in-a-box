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
 * Guided-tour anchor ids, stamped as `data-tour="<page>.<element>"`;
 * `data-tour-action` marks controls a "Show me" step may press. Duplicate
 * stamps are allowed — the resolver picks the first visible match.
 * The ONLY tutorials module page components may import (like `data-testid`);
 * anything else a tour reads is component-owned semantics, never tour attrs.
 */

export const TOUR = {
  visualise: {
    addSource: 'visualise.add-source',
    hub: 'visualise.hub',
    knownWms: 'visualise.known-wms',
    map: 'visualise.map',
    modeSwitcher: 'visualise.mode-switcher',
    help: 'visualise.help',
    activeLayers: 'visualise.active-layers',
    layerBrowser: 'visualise.layer-browser',
    expandLeft: 'visualise.expand-left',
    expandRight: 'visualise.expand-right',
    timeline: 'visualise.timeline',
    timelineStatic: 'visualise.timeline-static',
  },
} as const

export function tourAttr(id: string): { 'data-tour': string } {
  return { 'data-tour': id }
}

export function tourSelector(id: string): string {
  return `[data-tour="${id}"]`
}

export function tourActionAttr(action: string): { 'data-tour-action': string } {
  return { 'data-tour-action': action }
}

export function tourActionSelector(action: string): string {
  return `[data-tour-action="${action}"]:not([disabled])`
}

/** First visible element carrying the anchor id (hidden matches skipped);
 * `match` narrows ids stamped on several elements (e.g. per block kind). */
export function findTourElement(id: string, match = ''): Element | null {
  for (const el of document.querySelectorAll(tourSelector(id) + match)) {
    if (el.getClientRects().length > 0) return el
  }
  return null
}
