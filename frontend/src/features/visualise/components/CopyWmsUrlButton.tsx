/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Icon button copying a WMS URL for external clients. */

import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { showToast } from '@/lib/toast'
import { cn, copyToClipboard } from '@/lib/utils'

export function CopyWmsUrlButton({
  url,
  className,
}: {
  /** null while the server is not running yet. */
  url: string | null
  className?: string
}) {
  const { t } = useTranslation('visualise')
  const copy = () => {
    if (!url) return
    void copyToClipboard(url).then((ok) =>
      ok
        ? showToast.success(t('wmsUrl.copied'))
        : showToast.error(t('wmsUrl.copyFailed')),
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            // aria-disabled keeps the tooltip reachable while not ready.
            aria-disabled={!url || undefined}
            className={cn(
              'h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground',
              !url && 'opacity-50 hover:text-muted-foreground',
              className,
            )}
            onClick={copy}
            aria-label={t('wmsUrl.copy')}
          />
        }
      >
        <Link2 className="h-4 w-4" />
      </TooltipTrigger>
      <TooltipContent>
        {url ? (
          <>
            <span className="font-medium">{t('wmsUrl.copy')}</span>
            <br />
            {t('wmsUrl.hint')}
          </>
        ) : (
          t('wmsUrl.notReady')
        )}
      </TooltipContent>
    </Tooltip>
  )
}
