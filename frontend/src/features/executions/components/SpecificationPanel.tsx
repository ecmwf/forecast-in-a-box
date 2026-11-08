/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useMemo } from 'react'
import { FileJson } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import type { FableBuilderV1 } from '@/api/types/fable.types'
import { P } from '@/components/base/typography'
import { Card } from '@/components/ui/card'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@/components/ui/code-block'
import { showToast } from '@/lib/toast'

interface SpecificationPanelProps {
  fableSnapshot: FableBuilderV1 | undefined
}

// A string with an optional key colon, a number, or a literal.
const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g

const TOKEN_CLASS = {
  key: 'text-blue-600 dark:text-blue-400',
  string: 'text-green-600 dark:text-green-400',
  number: 'text-amber-600 dark:text-amber-400',
  literal: 'text-purple-600 dark:text-purple-400',
}

/** Colours one line of `JSON.stringify` output, which keeps strings on one line. */
function highlightJsonLine(line: string): Array<ReactNode> {
  const parts: Array<ReactNode> = []
  let last = 0
  for (const match of line.matchAll(JSON_TOKEN)) {
    const [text, str, colon, num] = match
    if (match.index > last) parts.push(line.slice(last, match.index))
    const kind = str ? (colon ? 'key' : 'string') : num ? 'number' : 'literal'
    parts.push(
      <span key={match.index} className={TOKEN_CLASS[kind]}>
        {colon ? str : text}
      </span>,
    )
    if (colon) parts.push(colon)
    last = match.index + text.length
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts
}

export function SpecificationPanel({ fableSnapshot }: SpecificationPanelProps) {
  const { t } = useTranslation('executions')
  const json = useMemo(
    () => (fableSnapshot ? JSON.stringify(fableSnapshot, null, 2) : ''),
    [fableSnapshot],
  )
  const lines = useMemo(() => json.split('\n').map(highlightJsonLine), [json])

  if (!fableSnapshot) {
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
    // Wide: fills the column; only the code scrolls.
    <CodeBlock className="bg-card min-[1280px]:h-full">
      <CodeBlockHeader>
        <CodeBlockTitle>
          <FileJson />
          {t('detail.specTitle')}
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton
            value={json}
            copyLabel={t('detail.copySpec')}
            copiedLabel={t('detail.copied')}
            onCopyError={() => showToast.error(t('detail.specCopyFailed'))}
          />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        lineNumbers
        className="max-h-[70dvh] scroll-fade-y min-[1280px]:max-h-none min-[1280px]:flex-1"
      >
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  )
}
