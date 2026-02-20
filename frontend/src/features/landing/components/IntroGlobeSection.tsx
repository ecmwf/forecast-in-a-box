/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Suspense, lazy } from 'react'
import { Button } from '@/components/ui/button'
import { H1, Typography } from '@/components/base/typography'
import { useAuth } from '@/features/auth'

// Lazy load the globe to ensure Three.js initializes properly in production builds
const RotatingGlobe = lazy(
  () => import('@/features/landing/components/RotatingGlobe.tsx'),
)

export function IntroGlobeSection() {
  const { signIn } = useAuth()
  return (
    <section>
      <div className="relative overflow-x-hidden bg-muted py-24">
        <div
          aria-hidden
          className="absolute inset-0 mt-auto -scale-y-100 mask-radial-[50%_50%] mask-radial-from-70% opacity-35"
          style={{
            background: `
         radial-gradient(ellipse 80% 60% at 5% 40%, var(--color-indigo-300), transparent 67%),
        radial-gradient(ellipse 70% 60% at 45% 45%, var(--color-teal-200), transparent 67%),
        radial-gradient(ellipse 62% 52% at 83% 76%, var(--color-purple-200), transparent 63%),
        radial-gradient(ellipse 60% 48% at 75% 20%, rgba(120, 190, 255, 0.36), transparent 66%),
        linear-gradient(45deg, #f7eaff 0%, #fde2ea 100%)
      `,
          }}
        />

        <div className="relative mx-auto max-w-6xl">
          <div className="col-span-full pb-12 text-center lg:p-12">
            <H1 className="mx-auto max-w-4xl text-5xl font-medium text-balance max-lg:font-semibold md:text-6xl lg:text-7xl">
              Product generation on the fly, for any Anemoi model
            </H1>
            <Typography
              variant="lead"
              as="p"
              className="mx-auto mt-6 mb-8 max-w-2xl text-balance max-md:mx-auto lg:text-xl"
            >
              Forecast-in-a-Box reimagines how forecasts are produced and
              delivered. Rather than relying on remote, data-intensive numerical
              weather prediction pipelines, Forecast-in-a-Box distributes a
              self-contained forecasting environment that users can install and
              run anywhere.
            </Typography>

            <div className="flex justify-center gap-3">
              <Button
                size="lg"
                className="border-transparent px-4 text-sm shadow-2xl shadow-indigo-900/40"
                onClick={() => signIn()}
                render={<span>Get Started</span>}
                nativeButton={false}
              />
            </div>
          </div>
          <div className="flex items-center justify-center">
            <Suspense
              fallback={
                <div className="flex h-100 w-100 items-center justify-center">
                  <div className="h-48 w-48 animate-pulse rounded-full bg-muted-foreground/10" />
                </div>
              }
            >
              <RotatingGlobe />
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  )
}
