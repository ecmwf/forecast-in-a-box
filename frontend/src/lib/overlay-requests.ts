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
 * "Close your overlays" request bus: any feature may ask, any page that
 * owns dialog state may honour it. Decouples the asker (e.g. a guided
 * tour advancing out of a dialog) from the page — synthetic clicks on a
 * dialog's close button are unreliable, React state is not.
 */

import { useEffect } from 'react'

const EVENT = 'fiab:close-overlays'

export function requestOverlayClose(): void {
  document.dispatchEvent(new CustomEvent(EVENT))
}

/** Runs `onRequest` whenever someone asks for overlays to close. */
export function useOverlayCloseRequest(onRequest: () => void): void {
  useEffect(() => {
    document.addEventListener(EVENT, onRequest)
    return () => document.removeEventListener(EVENT, onRequest)
  }, [onRequest])
}
