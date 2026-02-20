/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { H2 } from '@/components/base/typography'

export function Collaboration() {
  return (
    <section className="bg-zinc-50 py-16 dark:bg-zinc-900">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mx-auto mb-12 max-w-xl text-center text-balance md:mb-16">
          <H2 className="border-0 pb-0 text-4xl">A Collaboration between</H2>
        </div>
        <div className="relative mx-auto grid max-w-4xl divide-x border bg-background sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center justify-center p-12">
            <img
              src="/logos/org/ECMWF.png"
              alt="ECMWF"
              className="object-contain"
            />
          </div>
          <div className="flex items-center justify-center p-12">
            <img
              src="/logos/org/MetNorway.png"
              alt="MetNorway"
              className="object-contain"
            />
          </div>
          <div className="flex items-center justify-center border-t p-12 sm:col-span-2 lg:col-span-1">
            <img
              src="/logos/org/destine-fund.png"
              alt="DestinE"
              className="object-contain"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
