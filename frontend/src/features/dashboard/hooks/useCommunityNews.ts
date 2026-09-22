/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { STATIC_FILES } from '@/api/endpoints'

const NewsLinkSchema = z.object({
  title: z.string().min(1),
  url: z.url(),
  /** Publisher or venue, shown as the meta line. */
  source: z.string().min(1),
  /** Year or ISO date when known; shown verbatim. */
  date: z.string().optional(),
})

export const CommunityNewsSchema = z.object({
  press: z.array(NewsLinkSchema),
  materials: z.array(NewsLinkSchema),
  community: z.array(NewsLinkSchema),
})

export type NewsLink = z.infer<typeof NewsLinkSchema>
export type CommunityNews = z.infer<typeof CommunityNewsSchema>

async function fetchCommunityNews(signal: AbortSignal): Promise<CommunityNews> {
  const url = STATIC_FILES.communityNews
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return CommunityNewsSchema.parse(await res.json())
}

/** The curated link lists; the file only changes with a deployment. */
export function useCommunityNews() {
  return useQuery({
    queryKey: ['community-news'],
    queryFn: ({ signal }) => fetchCommunityNews(signal),
    staleTime: Infinity,
  })
}
