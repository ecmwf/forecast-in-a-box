/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Link as RouterLink } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { H3, Link, P } from '@/components/base/typography.tsx'

export function FiabStackSection() {
  return (
    <section>
      <div className="_border-b relative mx-auto max-w-7xl border-x px-3 pt-24 pb-10 md:pt-16 md:pb-20">
        <div className="grid max-md:divide-y md:grid-cols-2 md:divide-x">
          <div className="_grid _grid-rows-subgrid _pb-12 row-span-2 gap-8 md:pr-12">
            <div className="flex h-full items-center">
              <P className="mx-auto max-w-xl text-balance">
                Forecast-in-a-Box integrates data access, model execution,
                post-processing, and visualisation in one modular framework,
                providing the same functionality as large- scale operational
                systems at a fraction of the computational cost. Leveraging
                recent progress in data-driven AI models, Forecast-in-a-Box
                enables high-quality, local forecasts to be generated even on
                commodity hardware — from desktops to HPC clusters and cloud
                deployments. Developed within{' '}
                <Link href="https://destination-earth.eu">
                  Destination Earth
                </Link>{' '}
                and powered by the{' '}
                <Link href="https://github.com/ecmwf/anemoi">Anemoi</Link> and{' '}
                <Link href="https://earthkit.ecmwf.int">Earthkit</Link>{' '}
                open-source libraries, Forecast-in-a-Box demonstrates a
                sustainable, scalable path toward user-centred digital
                forecasting services.
                <Button
                  variant="secondary"
                  size="sm"
                  className="ml-1.5 gap-1 pr-1.5"
                  render={
                    <RouterLink to="/about">
                      <span>Learn More</span>
                      <ChevronRight className="size-2" />
                    </RouterLink>
                  }
                  nativeButton={false}
                />
              </P>
            </div>
          </div>
          <div className="_pb-12 row-span-2 grid grid-rows-subgrid gap-8 max-md:pt-12 md:pl-12">
            <H3 className="border-0 pb-0 text-balance">Powered by</H3>
            <div className="flex h-full items-center">
              <div className="relative grid w-full grid-cols-2 gap-x-3 gap-y-6 sm:gap-6 lg:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <img
                      src="/logos/packages/anemoi.webp"
                      alt="Anemoi"
                      className="h-24"
                    />
                  </div>
                  <Link
                    href="https://github.com/ecmwf/anemoi"
                    underline={false}
                    color="muted"
                  >
                    Open-source ML framework for developing, training, and
                    deploying weather forecasting models
                  </Link>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <img
                      src="/logos/packages/earthkit-light.svg"
                      alt="EarthKit"
                      className="h-24"
                    />
                  </div>
                  <Link
                    href="https://earthkit.ecmwf.int"
                    underline={false}
                    color="muted"
                  >
                    Open-source tools for seamless earth science workflows
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
