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
 * What does this deployment allow? Introspects the build's CSP meta tag
 * (vite.config.ts): dev allows any http(s) WMS origin, production
 * enumerates the curated origins + FIAB_CSP_EXTRA_HOSTS. Reading the tag
 * keeps the UI in lockstep with what the browser enforces — a CSP-blocked
 * fetch otherwise misreports as "server unreachable".
 */

export interface CspConnectPolicy {
  /** True when connect-src enumerates specific origins (production). */
  restricted: boolean
  allows: (url: URL) => boolean
}

const SCHEME_SOURCE = /^[a-z][\w+.-]*:$/i
const HOST_SOURCE =
  /^([a-z][\w+.-]*):\/\/(\*\.[^\s/:*]+|[^\s/:*]+)(?::(\d+|\*))?$/i

function defaultPort(protocol: string): string {
  return protocol === 'http:' ? '80' : protocol === 'https:' ? '443' : ''
}

/** CSP host-source match, reduced to the forms vite.config.ts emits. */
export function matchesCspSource(
  url: URL,
  source: string,
  appOrigin: string,
): boolean {
  if (source === '*') return true
  if (source === "'self'") return url.origin === appOrigin
  if (SCHEME_SOURCE.test(source)) {
    return url.protocol === source.toLowerCase()
  }
  const m = HOST_SOURCE.exec(source)
  if (!m) return false
  const [, scheme, host] = m
  // The optional port group IS undefined at runtime despite the array type.
  const port = m[3] as string | undefined
  if (url.protocol !== `${scheme.toLowerCase()}:`) return false
  const urlHost = url.hostname.toLowerCase()
  const sourceHost = host.toLowerCase()
  const hostOk = sourceHost.startsWith('*.')
    ? urlHost.endsWith(sourceHost.slice(1)) &&
      urlHost.length > sourceHost.length - 1
    : urlHost === sourceHost
  if (!hostOk) return false
  if (port === '*') return true
  const urlPort = url.port || defaultPort(url.protocol)
  return urlPort === (port ?? defaultPort(url.protocol))
}

/** The connect-src source list of a CSP string; null when absent. */
export function parseConnectSrc(cspContent: string): Array<string> | null {
  const directive = cspContent
    .split(';')
    .map((d) => d.trim())
    .find((d) => /^connect-src(\s|$)/i.test(d))
  if (!directive) return null
  return directive.split(/\s+/).slice(1)
}

/** Effective connect-src policy — defaults to the document's CSP meta
 *  tag; no tag or an open scheme source (dev) means unrestricted. */
export function cspConnectPolicy(
  content: string | null = document
    .querySelector('meta[http-equiv="Content-Security-Policy" i]')
    ?.getAttribute('content') ?? null,
  appOrigin: string = window.location.origin,
): CspConnectPolicy {
  const sources = content === null ? null : parseConnectSrc(content)
  const restricted =
    sources !== null && !sources.some((s) => s === '*' || /^https?:$/i.test(s))
  if (!restricted) return { restricted: false, allows: () => true }
  return {
    restricted: true,
    allows: (url) => sources.some((s) => matchesCspSource(url, s, appOrigin)),
  }
}

/** Non-loopback app origin = remote (cloud) deployment, where host paths
 *  mean the server's filesystem, not the user's machine. */
export function isRemoteDeployment(
  hostname: string = window.location.hostname,
): boolean {
  return !/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/i.test(hostname)
}
