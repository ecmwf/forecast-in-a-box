/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ClassValue } from 'clsx'

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs))
}

/**
 * Validate that a redirect URL is safe (internal only)
 *
 * Prevents open redirect vulnerabilities by ensuring:
 * - URL starts with "/" (relative path)
 * - URL does NOT start with "//" (protocol-relative, would allow external redirects)
 * - URL does NOT contain backslashes (IE compatibility issue)
 *
 * @param url - The URL to validate
 * @returns true if the URL is a safe internal redirect (type guard narrows to string)
 */
export function isValidInternalRedirect(url: string | null): url is string {
  if (!url) return false

  // Must start with single forward slash
  if (!url.startsWith('/')) return false

  // Must NOT start with // (protocol-relative URL)
  if (url.startsWith('//')) return false

  // Must NOT contain backslashes (IE treats them as forward slashes)
  if (url.includes('\\')) return false

  return true
}

/**
 * Check if a URL is external
 *
 * External URLs start with:
 * - http:// or https:// (absolute URLs)
 * - // (protocol-relative URLs)
 *
 * @param url - The URL to check
 * @returns true if the URL is external
 */
export function isExternalUrl(url: string): boolean {
  return /^(https?:)?\/\//.test(url)
}

/**
 * Copy text to the clipboard with a graceful fallback for unsupported or
 * permission-denied environments. Returns true on success, false otherwise.
 * Callers can use the result to decide whether to show a success or error toast.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Preferred: the Async Clipboard API. Available in secure contexts only,
  // so the dynamic `in` check avoids a runtime crash when it's missing
  // (e.g. older browsers, `file://`, insecure HTTP pages).
  if ('clipboard' in navigator) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the textarea fallback
    }
  }

  // Fallback: hidden textarea + execCommand. Deprecated but still widely
  // supported and works outside secure contexts.
  if (typeof document === 'undefined') return false
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.setAttribute('readonly', '')
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
