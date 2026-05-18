/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Inline error panel for a failed data load. */

import { P } from '@/components/base/typography'

interface ErrorPanelProps {
  message: string
}

export function ErrorPanel({ message }: ErrorPanelProps) {
  return (
    <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
      <P className="text-destructive">{message}</P>
    </div>
  )
}
