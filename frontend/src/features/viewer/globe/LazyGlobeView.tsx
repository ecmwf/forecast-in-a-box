/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** The globe chunk, loaded on mount; a failed load or render reports and unmounts. */

import { Component, Suspense, lazy } from 'react'
import type { GlobeViewProps } from './GlobeView'

export class LazyGlobeView extends Component<
  GlobeViewProps,
  { failed: boolean }
> {
  state = { failed: false }
  // Per mount: React keeps a rejected lazy() rejected, so a retry needs a fresh one.
  private readonly Chunk = lazy(() =>
    import('./GlobeView').then((m) => ({ default: m.GlobeView })),
  )

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    this.props.onFailure(error)
  }

  render() {
    if (this.state.failed) return null
    const { Chunk } = this
    return (
      <Suspense fallback={null}>
        <Chunk {...this.props} />
      </Suspense>
    )
  }
}
