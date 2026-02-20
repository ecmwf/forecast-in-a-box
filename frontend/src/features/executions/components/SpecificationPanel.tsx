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
 * SpecificationPanel Component
 *
 * JSON viewer for the original fable specification snapshot.
 */

import { useMemo } from 'react'
import { FileJson } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'

interface SpecificationPanelProps {
  fableSnapshot: FableBuilderV1 | undefined
}

function highlightJson(
  json: string,
): Array<{ text: string; className: string }> {
  const segments: Array<{ text: string; className: string }> = []
  // Match JSON tokens: keys (quoted strings before colon), strings, numbers, booleans, null
  const tokenRegex =
    /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([^"'\d\w]+)/g

  let match: RegExpExecArray | null
  let lastIndex = 0

  while ((match = tokenRegex.exec(json)) !== null) {
    // Add any text between matches as plain
    if (match.index > lastIndex) {
      segments.push({
        text: json.slice(lastIndex, match.index),
        className: '',
      })
    }

    const [, key, str, num, bool, punct] = match
    if (key) {
      // Key (quoted string followed by colon)
      segments.push({
        text: key,
        className: 'text-blue-600 dark:text-blue-400',
      })
      segments.push({ text: ':', className: '' })
    } else if (str) {
      // String value
      segments.push({
        text: str,
        className: 'text-green-600 dark:text-green-400',
      })
    } else if (num) {
      // Number
      segments.push({
        text: num,
        className: 'text-amber-600 dark:text-amber-400',
      })
    } else if (bool) {
      // Boolean / null
      segments.push({
        text: bool,
        className: 'text-purple-600 dark:text-purple-400',
      })
    } else if (punct) {
      // Punctuation / whitespace
      segments.push({ text: punct, className: '' })
    }

    lastIndex = match.index + match[0].length
  }

  // Add any remaining text
  if (lastIndex < json.length) {
    segments.push({ text: json.slice(lastIndex), className: '' })
  }

  return segments
}

export function SpecificationPanel({ fableSnapshot }: SpecificationPanelProps) {
  const { t } = useTranslation('executions')

  const highlighted = useMemo(() => {
    if (!fableSnapshot) return null
    const json = JSON.stringify(fableSnapshot, null, 2)
    return highlightJson(json)
  }, [fableSnapshot])

  if (!fableSnapshot || !highlighted) {
    return (
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <FileJson className="h-10 w-10 text-muted-foreground" />
          <P className="font-medium text-muted-foreground">
            {t('detail.specUnavailable')}
          </P>
          <P className="text-muted-foreground">
            {t('detail.specUnavailableDescription')}
          </P>
        </div>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="max-h-[600px] overflow-auto p-6">
        <pre className="font-mono text-sm leading-relaxed">
          <code>
            {highlighted.map((segment, i) => (
              <span key={i} className={segment.className}>
                {segment.text}
              </span>
            ))}
          </code>
        </pre>
      </div>
    </Card>
  )
}
