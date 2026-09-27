/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { splitBlockName } from '@/features/fable-builder/utils/block-names'

/** Block name with its plugin qualifier as a quiet pill. */
export function BlockName({ name }: { name: string }) {
  const [title, plugin] = splitBlockName(name)
  if (!plugin) return <>{name}</>
  return (
    <>
      {title}
      {/* Keeps the text form "Title · plugin". */}
      <span className="sr-only"> ·</span>{' '}
      <span className="ml-0.5 rounded bg-muted px-1.5 py-px align-[0.05em] text-[0.9em] font-normal text-muted-foreground">
        {plugin}
      </span>
    </>
  )
}
