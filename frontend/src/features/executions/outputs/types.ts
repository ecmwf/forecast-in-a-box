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
 * Output renderer adapter contract. Each MIME type registers an OutputAdapter
 * that decides icon, label, thumbnail, viewer, and per-output actions.
 */

import type { ComponentType, LazyExoticComponent } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { TFunction } from 'i18next'

/** A typed `t` function bound to the `executions` namespace. */
export type ExecutionsT = TFunction<'executions'>

/** Resolves a localized label using a literal key the adapter encodes. */
export type LabelResolver = (t: ExecutionsT) => string

export interface OutputItem {
  jobId: string
  taskId: string
  /** Authoritative MIME from RunOutputMetadata. */
  mimeType: string
  /** Source block identifier — used as the human-readable card label and group key. */
  originalBlock: string
  isAvailable: boolean
}

export interface ActionContext {
  /** The adapter actually driving the card — may differ from
   * `resolveAdapter(item.mimeType)` after a sniffer promotion. Actions
   * should prefer this when they need adapter-derived data such as
   * `extension`. */
  resolvedAdapter: OutputAdapter
}

export interface OutputAction {
  /** Stable id, e.g. 'download', 'open-wms', 'copy-url'. */
  id: string
  /** Action label resolver. Each action encodes its own literal i18n key,
   * so call sites can use the typed `t` directly without `as never` casts. */
  label: LabelResolver
  icon: LucideIcon
  variant?: 'default' | 'outline' | 'ghost'
  /** When false the action is hidden for this item. Default: shown. */
  isAvailable?: (item: OutputItem) => boolean
  run: (item: OutputItem, ctx: ActionContext) => void | Promise<void>
}

export interface ThumbnailProps {
  item: OutputItem
  /** The adapter that owns this thumbnail; carries the registered MIME used
   * to re-tag blobs whose wire `.type` may be wrong. */
  adapter: OutputAdapter
}

export interface ViewerProps {
  item: OutputItem
  /** The adapter that mounted this viewer — same one whose `Viewer` was
   * picked. Carries the (possibly sniff-promoted) extension etc. */
  adapter: OutputAdapter
  onClose: () => void
}

export interface OutputAdapter {
  /** Stable id, e.g. 'image-raster', 'pdf'. */
  id: string
  /** Primary MIME plus any aliases this adapter handles. */
  mimeTypes: ReadonlyArray<string>
  icon: LucideIcon
  /** Adapter label resolver. Each adapter encodes its own literal i18n key
   * so call sites can use the typed `t` directly without `as never` casts. */
  label: LabelResolver
  /** Short label shown in the corner pill on the card; defaults to label(t)
   * if omitted but typically a 3–4 letter code (PNG, SVG, PDF). */
  shortLabel?: LabelResolver
  /** Tailwind classes for the corner pill on the card; lets each adapter
   * pick its own color so users can tell formats apart at a glance. */
  chipClass: string
  /** Download filename suffix without leading dot. */
  extension: string
  /** Optional thumbnail rendered inside the grid card. */
  Thumbnail?: ComponentType<ThumbnailProps>
  /** Optional full-fidelity viewer; lazy-loaded by registration. */
  Viewer?: LazyExoticComponent<ComponentType<ViewerProps>>
  /** Ordered list — `download` should typically come last. */
  actions: ReadonlyArray<OutputAction>
}

/**
 * Sniffer hook for the rare case where the registered MIME type is wrong
 * and we need to peek at bytes to dispatch correctly. No first-party
 * sniffer is registered today; the interface is kept for future use.
 */
export interface Sniffer {
  /** Only run when the item's mime is in this list. */
  candidateMimes: ReadonlyArray<string>
  bytesNeeded: number
  /** Return a promoted MIME if recognised, else null. */
  detect: (head: Uint8Array) => string | null
}
