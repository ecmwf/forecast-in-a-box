/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { H2, P } from '@/components/base/typography'

export function Dag() {
  return (
    <section>
      <div className="_border-x _border-b relative mx-auto max-w-7xl px-3 pt-24 pb-10 md:pt-16 md:pb-20">
        <div className="mx-auto mb-12 max-w-xl text-center text-balance md:mb-16">
          <H2 className="border-0 pb-0 text-4xl">Dynamic Product Execution</H2>
          <P className="mt-4">From anemoi to pproc, all in the box.</P>
        </div>
        <iframe
          src="/dag/example.html"
          width="100%"
          height="620px"
          style={{ border: 'none' }}
          title="Dynamic Product Execution"
          // Security: Restrict iframe capabilities
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
        />
      </div>

      <div className="_border-b">
        <div className="relative mx-auto max-w-7xl border-x px-4 sm:px-6 md:px-12"></div>
      </div>
    </section>
  )
}
