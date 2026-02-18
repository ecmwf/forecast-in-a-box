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
 * MSW Error Handler Factories
 *
 * Reusable factories for creating MSW handler overrides in tests.
 * Use with `worker.use()` to simulate error responses.
 *
 * @example
 * ```ts
 * import { worker } from '@tests/test-extend'
 * import { create500Handler } from '@mocks/utils/error-factories'
 * import { API_ENDPOINTS } from '@/api/endpoints'
 *
 * worker.use(create500Handler('get', API_ENDPOINTS.plugin.details))
 * ```
 */

import { HttpResponse, http } from 'msw'
import type { JsonBodyType } from 'msw'

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch'

function getHttpMethod(method: HttpMethod) {
  const methods = {
    get: http.get,
    post: http.post,
    put: http.put,
    delete: http.delete,
    patch: http.patch,
  }
  return methods[method]
}

/**
 * Creates a handler that returns 500 Internal Server Error
 */
export function create500Handler(method: HttpMethod, path: string) {
  return getHttpMethod(method)(path, () => {
    return HttpResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  })
}

/**
 * Creates a handler that returns 403 Forbidden
 */
export function create403Handler(method: HttpMethod, path: string) {
  return getHttpMethod(method)(path, () => {
    return HttpResponse.json({ detail: 'Forbidden' }, { status: 403 })
  })
}

/**
 * Creates a handler that returns 200 with custom empty payload
 */
export function createEmptyHandler(
  method: HttpMethod,
  path: string,
  emptyData: JsonBodyType,
) {
  return getHttpMethod(method)(path, () => {
    return HttpResponse.json(emptyData)
  })
}

/**
 * Creates a handler that returns a network error
 */
export function createNetworkErrorHandler(method: HttpMethod, path: string) {
  return getHttpMethod(method)(path, () => {
    return HttpResponse.error()
  })
}
