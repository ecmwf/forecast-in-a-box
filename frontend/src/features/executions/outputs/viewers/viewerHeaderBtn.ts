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
 * Header control button styling shared by the full-screen output viewers.
 *
 * `text-foreground` flips with the theme; on the viewers' dark overlay an
 * outline Button leaves icons invisible, so the controls use a transparent
 * ghost button with explicit white styling.
 */
export const viewerHeaderBtn =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-white/90 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30'
