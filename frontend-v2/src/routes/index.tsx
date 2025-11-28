/*
 * (C) Copyright 2025- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { createFileRoute } from '@tanstack/react-router'
import { StatusCard } from '@/features/status/components/StatusCard'

export const Route = createFileRoute('/')({
  component: App,
})

function App() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <StatusCard />
    </div>
  )
}
