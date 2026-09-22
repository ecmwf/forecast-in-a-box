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
 * Decorative welcome vignette; aria-hidden, brand text untranslated.
 */

/** Soft radial fade so the globe mesh melts into the backdrop. */
const GLOBE_MASK = {
  maskImage:
    'radial-gradient(ellipse 55% 55% at 50% 50%, black 35%, transparent 72%)',
  WebkitMaskImage:
    'radial-gradient(ellipse 55% 55% at 50% 50%, black 35%, transparent 72%)',
} as const

export function WelcomeIllustration() {
  return (
    <div aria-hidden className="absolute inset-0">
      <img
        src="/logos/ecmwf-globe-mesh.webp"
        alt=""
        className="pointer-events-none absolute -top-10 -right-15 w-[380px] opacity-[0.18] dark:opacity-30 dark:invert"
        style={GLOBE_MASK}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3.5">
        <img
          src="/logos/fiab-mark-blue.svg"
          alt=""
          className="h-auto w-19 dark:brightness-150"
        />
        <span className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
          ECMWF · Forecast-in-a-Box
        </span>
      </div>
    </div>
  )
}
