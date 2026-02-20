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
 * BlockFactoryCard Component
 *
 * Display a block factory from a plugin with configuration info and action buttons.
 */

import { Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BlockFactory } from '@/api/types/fable.types'
import { BLOCK_KIND_METADATA, getBlockKindIcon } from '@/api/types/fable.types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { H4, P } from '@/components/base/typography'
import { cn } from '@/lib/utils'

export interface BlockFactoryCardProps {
  factory: BlockFactory
  onStartConfiguration: () => void
}

export function BlockFactoryCard({
  factory,
  onStartConfiguration,
}: BlockFactoryCardProps) {
  const { t } = useTranslation('plugins')
  const metadata = BLOCK_KIND_METADATA[factory.kind]
  const IconComponent = getBlockKindIcon(factory.kind)
  const isSource = factory.kind === 'source'

  const configKeys = Object.keys(factory.configuration_options)
  const hasInputs = factory.inputs.length > 0

  const button = (
    <Button
      size="sm"
      variant="outline"
      className="w-full gap-1.5"
      disabled={!isSource}
      onClick={isSource ? onStartConfiguration : undefined}
    >
      <Play className="h-3.5 w-3.5" />
      {t('blockFactory.useInConfig', { kind: metadata.label })}
    </Button>
  )

  return (
    <Card className="gap-2 p-4">
      <div className="flex min-w-0 gap-3">
        <div className={cn('shrink-0 rounded-lg p-2', metadata.bgColor)}>
          <IconComponent className={cn('h-5 w-5', metadata.color)} />
        </div>
        <div className="min-w-0 flex-1">
          <H4 className="truncate font-semibold">{factory.title}</H4>
          <Badge
            variant="outline"
            className={cn('mt-1 text-sm', metadata.color)}
          >
            {metadata.label}
          </Badge>
          {factory.description && (
            <P className="mt-1 line-clamp-2 text-muted-foreground">
              {factory.description}
            </P>
          )}
          <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
            {configKeys.length > 0 && (
              <span>
                {configKeys.length} config{' '}
                {configKeys.length === 1 ? 'option' : 'options'}
              </span>
            )}
            {hasInputs && (
              <span>
                {factory.inputs.length} input
                {factory.inputs.length === 1 ? '' : 's'}
              </span>
            )}
            {configKeys.length === 0 && !hasInputs && (
              <span>No configuration required</span>
            )}
          </div>
        </div>
      </div>
      {isSource ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger render={<span />}>{button}</TooltipTrigger>
          <TooltipContent>{t('blockFactory.sourceOnlyTooltip')}</TooltipContent>
        </Tooltip>
      )}
    </Card>
  )
}
