/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Chromium restricts clipboard payloads to a small MIME allowlist. */
export type ClipboardMime = 'image/png' | 'image/jpeg' | 'text/plain'

/**
 * Copy async-produced data to the clipboard, Safari-safely.
 *
 * WebKit revokes the user activation after the first `await`, so the
 * ClipboardItem must be constructed inside the gesture with the *unawaited*
 * promise as payload — call this directly from the event handler.
 * A `null` resolution rejects the write: one failure path for callers.
 */
export function copyToClipboard(
  mime: ClipboardMime,
  data: Promise<Blob | string | null>,
): Promise<void> {
  const payload = data.then((value) => normalize(value, mime))
  // Not every path consumes the payload (unavailable API, stubbed write) —
  // pre-mark rejections handled so they never surface as unhandled.
  void payload.catch(() => {})
  // Runtime guard despite lib.dom types: absent in insecure contexts.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return Promise.reject(new Error('Clipboard API is not available'))
  }
  let item: ClipboardItem
  try {
    item = new ClipboardItem({ [mime]: payload })
  } catch {
    // Older Chromium rejects promise payloads; no gesture rule there.
    return payload.then((blob) =>
      navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]),
    )
  }
  return navigator.clipboard.write([item])
}

function normalize(value: Blob | string | null, mime: ClipboardMime): Blob {
  if (value === null) throw new Error('Nothing to copy')
  // Item key and blob type must agree or the write is rejected.
  if (typeof value === 'string' || value.type !== mime) {
    return new Blob([value], { type: mime })
  }
  return value
}
