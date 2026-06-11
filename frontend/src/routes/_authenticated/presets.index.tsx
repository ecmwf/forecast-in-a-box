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
 * Presets Index Route — /presets
 *
 * Redirects to the default tab: /presets/gallery (Templates).
 * This ensures existing links to /presets continue to work.
 */

import { Navigate, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/presets/')({
  component: PresetsIndex,
})

function PresetsIndex() {
  return <Navigate to="/presets/gallery" replace />
}
