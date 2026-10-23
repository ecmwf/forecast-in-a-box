/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Zip download; the menu copies curl, or the link when signed in. */

import { ChevronDown, FolderDown, Link2, Terminal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { buildOutputZipUrl } from '@/api/endpoints/job'
import { useAuthType } from '@/hooks/useConfig'
import { downloadUrl } from '@/lib/download-blob'
import { showToast } from '@/lib/toast'
import { copyToClipboard } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { P } from '@/components/base/typography'

interface OutputZipButtonProps {
  jobId: string
  taskId: string
  /** False while the run still writes. */
  ready: boolean
  /** Folder also holds other runs' files. */
  sharedFolder?: boolean
  /** Icon-only, for output cards. */
  compact?: boolean
}

export function OutputZipButton({
  jobId,
  taskId,
  ready,
  sharedFolder = false,
  compact = false,
}: OutputZipButtonProps) {
  const { t } = useTranslation('executions')
  const signedIn = useAuthType() === 'authenticated'
  const url = buildOutputZipUrl(jobId, taskId)

  const download = () => {
    downloadUrl(url)
    showToast.info(t('zipDownload.preparing'), t('zipDownload.preparingHint'))
  }

  const copy = () => {
    const text = signedIn ? url : `curl -fOJ "${url}"`
    void copyToClipboard(text).then((ok) =>
      ok
        ? showToast.success(
            t(
              signedIn ? 'zipDownload.linkCopied' : 'zipDownload.commandCopied',
            ),
          )
        : showToast.error(t('zipDownload.copyFailed')),
    )
  }

  const hint = !ready
    ? t('zipDownload.notReady')
    : sharedFolder
      ? t('zipDownload.sharedFolder')
      : compact
        ? t('zipDownload.download')
        : null
  const iconClass = compact ? 'h-3 w-3' : 'h-3.5 w-3.5'

  return (
    <Tooltip>
      {/* Span: disabled buttons get no hover. */}
      <TooltipTrigger render={<span className="inline-flex" />}>
        <ButtonGroup>
          <Button
            size="sm"
            variant="outline"
            onClick={download}
            disabled={!ready}
            className="gap-1.5"
            aria-label={compact ? t('zipDownload.download') : undefined}
          >
            <FolderDown className={iconClass} />
            {!compact && t('zipDownload.download')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!ready}
                  aria-label={t('zipDownload.moreOptions')}
                  className="px-1.5"
                />
              }
            >
              <ChevronDown className={iconClass} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-72">
              <DropdownMenuItem onClick={copy}>
                {signedIn ? (
                  <Link2 className="mr-2 h-4 w-4 shrink-0" />
                ) : (
                  <Terminal className="mr-2 h-4 w-4 shrink-0" />
                )}
                <span className="flex flex-col">
                  <span className="whitespace-nowrap">
                    {t(
                      signedIn
                        ? 'zipDownload.copyLink'
                        : 'zipDownload.copyCommand',
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(
                      signedIn
                        ? 'zipDownload.copyLinkHint'
                        : 'zipDownload.copyCommandHint',
                    )}
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </TooltipTrigger>
      {hint && (
        <TooltipContent>
          <P className="max-w-xs text-sm text-inherit">{hint}</P>
        </TooltipContent>
      )}
    </Tooltip>
  )
}
