/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import {
  Fragment,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  CircleAlert,
  Download,
  FileText,
  Files,
  RefreshCw,
  Search,
  WrapText,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import type { JobStatus } from '@/api/types/job.types'
import type {
  LogFileGroup,
  LogLevel,
  LogLine,
  ParsedLogFile,
} from '@/features/executions/utils/run-logs'
import { isTerminalStatus } from '@/api/types/job.types'
import { formatBytes } from '@/api/types/artifacts.types'
import { P } from '@/components/base/typography'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockFooter,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@/components/ui/code-block'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useRunLogArchive } from '@/features/executions/hooks/useRunLogArchive'
import {
  countEntries,
  defaultLogFile,
  formatLogTime,
  inWindow,
  locateFailure,
  meetsLevel,
  parseLogFile,
  runWindow,
  serverClockOffset,
} from '@/features/executions/utils/run-logs'
import { downloadBlob } from '@/lib/download-blob'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/** Request to open a run failure; `at` is when it was made. */
export interface LogFocus {
  message: string
  at: number
}

interface LogsPanelProps {
  jobId: string
  status: JobStatus
  /** Bounds of the "During run" filter. */
  createdAt: string
  updatedAt: string
  /** Opens this failure once fresh logs arrive. */
  focus?: LogFocus | null
}

/** Lines rendered before "Show all". */
const RENDER_LIMIT = 2000
/** Lines per file in "All files". */
const SECTION_LIMIT = 200
/** Slack for "scrolled to the end". */
const FOLLOW_SLACK_PX = 24

const ALL_LEVELS = 'all'
type LevelFilter = LogLevel | typeof ALL_LEVELS

const ALL_FILES = 'all-files'

const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: '',
  warning: 'text-amber-700 dark:text-amber-400',
  error: 'text-destructive',
}

const GROUPS: Array<LogFileGroup> = ['run', 'server', 'details']

interface JumpTarget {
  file: string
  line: number
}

interface Section {
  parsed: ParsedLogFile
  matches: Array<LogLine>
}

export function LogsPanel({
  jobId,
  status,
  createdAt,
  updatedAt,
  focus,
}: LogsPanelProps) {
  const { t } = useTranslation('executions')
  const archive = useRunLogArchive(jobId)
  const [selected, setSelected] = useState<string | null>(null)
  const [level, setLevel] = useState<LevelFilter>(ALL_LEVELS)
  const [filter, setFilter] = useState('')
  const [wrap, setWrap] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [jumpTo, setJumpTo] = useState<JumpTarget | null>(null)
  const [duringRun, setDuringRun] = useState(true)
  const contentRef = useRef<HTMLPreElement>(null)
  const followRef = useRef(true)

  const parsed = useMemo(
    () => (archive.data?.files ?? []).map(parseLogFile),
    [archive.data],
  )
  const allFiles = selected === ALL_FILES
  const current = allFiles
    ? undefined
    : (parsed.find((p) => p.file.name === selected) ?? defaultLogFile(parsed))

  const isRunning = !isTerminalStatus(status)
  const fetchedAt = archive.data?.fetchedAt
  const span = useMemo(() => {
    const offset =
      fetchedAt === undefined ? null : serverClockOffset(parsed, fetchedAt)
    return offset === null
      ? null
      : runWindow(createdAt, isRunning ? null : updatedAt, offset)
  }, [parsed, fetchedAt, createdAt, updatedAt, isRunning])

  // "During run": server-wide lines within the run's time.
  const scope = duringRun ? span : null
  const scopedByFile = useMemo(
    () =>
      new Map(
        parsed.map((p) => {
          if (!scope || p.file.group !== 'server') {
            return [p.file.name, { lines: p.lines, counts: p.counts }]
          }
          const lines = p.lines.filter((line) => inWindow(line, scope))
          return [p.file.name, { lines, counts: countEntries(lines) }]
        }),
      ),
    [parsed, scope],
  )
  const linesOf = (p: ParsedLogFile) =>
    scopedByFile.get(p.file.name)?.lines ?? p.lines
  const countsOf = (p: ParsedLogFile) =>
    scopedByFile.get(p.file.name)?.counts ?? p.counts

  const query = useDeferredValue(filter.trim().toLowerCase())
  const minLevel = level === ALL_LEVELS ? null : level
  const matchesByFile = useMemo(() => {
    const keep = (line: LogLine) =>
      meetsLevel(line, minLevel) &&
      (!query || line.text.toLowerCase().includes(query))
    return new Map(
      parsed.map((p) => [
        p.file.name,
        (scopedByFile.get(p.file.name)?.lines ?? p.lines).filter(keep),
      ]),
    )
  }, [parsed, scopedByFile, minLevel, query])
  const matchesOf = (p: ParsedLogFile) => matchesByFile.get(p.file.name) ?? []
  const scopesCurrent =
    scope !== null && (allFiles || current?.file.group === 'server')

  // "All files" skips the run-detail JSON.
  const logFiles = parsed.filter((p) => p.file.group !== 'details')
  const sections: Array<Section> = allFiles
    ? logFiles
        .map((p) => ({ parsed: p, matches: matchesOf(p) }))
        .filter((section) => section.matches.length > 0)
    : []

  const visible = current ? matchesOf(current) : []
  const capped = !showAll && visible.length > RENDER_LIMIT
  const rendered = capped ? visible.slice(-RENDER_LIMIT) : visible
  const firstError = visible.find((line) => line.level === 'error')
  const firstErrorSection = sections.find((s) =>
    s.matches.some((line) => line.level === 'error'),
  )
  const sectionLines = sections.reduce((n, s) => n + s.matches.length, 0)

  // New file or filter: tail; "All files": top.
  const view = allFiles ? ALL_FILES : current?.file.name
  useLayoutEffect(() => {
    const el = contentRef.current
    if (el) el.scrollTop = allFiles ? 0 : el.scrollHeight
  }, [view, allFiles, level, query])

  // A refresh follows the tail if the view was at the end.
  useLayoutEffect(() => {
    const el = contentRef.current
    if (el && followRef.current) el.scrollTop = el.scrollHeight
  }, [archive.data])

  // Runs after the tail effect; scrolls the box, not the page.
  useEffect(() => {
    const el = contentRef.current
    if (jumpTo === null || !el) return
    const target = el.querySelector<HTMLElement>(`[data-line="${jumpTo.line}"]`)
    if (!target) return
    const top =
      target.getBoundingClientRect().top -
      el.getBoundingClientRect().top +
      el.scrollTop
    el.scrollTop = top - (el.clientHeight - target.offsetHeight) / 2
  }, [jumpTo])

  const resetView = () => {
    setShowAll(false)
    setJumpTo(null)
  }
  const openFile = (name: string) => {
    setSelected(name)
    resetView()
  }
  // Opens the line in its file, filters cleared.
  const openAt = (name: string, line: number) => {
    const target = parsed.find((p) => p.file.name === name)
    const scoped = target ? linesOf(target) : []
    const inScope = scoped.some((l) => l.number === line)
    const shown = inScope ? scoped : (target?.lines ?? [])
    const index = shown.findIndex((l) => l.number === line)
    if (!inScope) setDuringRun(false)
    setSelected(name)
    setFilter('')
    setLevel(ALL_LEVELS)
    setShowAll(index >= 0 && index < shown.length - RENDER_LIMIT)
    setJumpTo({ file: name, line })
  }

  // Applied once, when logs newer than the request arrive.
  const [appliedFocus, setAppliedFocus] = useState<number | null>(null)
  if (
    focus &&
    appliedFocus !== focus.at &&
    !archive.isFetching &&
    archive.dataUpdatedAt >= focus.at
  ) {
    setAppliedFocus(focus.at)
    const target = locateFailure(parsed, focus.message)
    if (target?.line !== undefined) openAt(target.file, target.line)
    else if (target) openFile(target.file)
  }

  const hasRunFiles = parsed.some((p) => p.file.group === 'run')
  const collectError = parsed.find(
    (p) => p.file.name === 'logs_directory.error.txt',
  )
  const totals = logFiles.reduce(
    (sum, p) => ({
      warning: sum.warning + countsOf(p).warning,
      error: sum.error + countsOf(p).error,
    }),
    { warning: 0, error: 0 },
  )

  const scopeEnabled =
    span !== null && (allFiles || current?.file.group === 'server')
  const scopeHint =
    span === null
      ? t('logs.duringRunNoTimes')
      : !scopeEnabled
        ? t('logs.duringRunRunFile')
        : span.to === null
          ? t('logs.duringRunOpen', { from: formatLogTime(span.from) })
          : t('logs.duringRunHint', {
              from: formatLogTime(span.from),
              to: formatLogTime(span.to),
            })

  const fileItems = [
    { value: ALL_FILES, label: t('logs.allFiles') },
    ...parsed.map((p) => ({ value: p.file.name, label: p.file.label })),
  ]
  const levelItems: Array<{ value: LevelFilter; label: string }> = [
    { value: ALL_LEVELS, label: t('logs.levelAll') },
    { value: 'info', label: t('logs.levelInfo') },
    { value: 'warning', label: t('logs.levelWarning') },
    { value: 'error', label: t('logs.levelError') },
  ]
  const copyValue = allFiles
    ? sections
        .flatMap((s) =>
          s.matches.map(
            (line) => `${s.parsed.file.label}:${line.number}:${line.text}`,
          ),
        )
        .join('\n')
    : visible.map((line) => line.text).join('\n')

  return (
    <TooltipProvider delay={120}>
      <div className="flex flex-col gap-3 min-[1280px]:h-full">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={allFiles ? ALL_FILES : (current?.file.name ?? null)}
            onValueChange={(name) => openFile(name ?? ALL_FILES)}
            items={fileItems}
            disabled={parsed.length === 0}
          >
            <SelectTrigger className="min-w-56" aria-label={t('logs.file')}>
              <SelectValue placeholder={t('logs.file')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILES}>
                <span className="truncate">{t('logs.allFiles')}</span>
                {query ? (
                  <MatchCount
                    count={logFiles.reduce(
                      (n, p) => n + matchesOf(p).length,
                      0,
                    )}
                  />
                ) : (
                  <FileCounts counts={totals} />
                )}
              </SelectItem>
              <SelectSeparator />
              {GROUPS.map((group) => {
                const inGroup = parsed.filter((p) => p.file.group === group)
                if (inGroup.length === 0) return null
                return (
                  <SelectGroup key={group}>
                    <SelectLabel>{t(`logs.group.${group}`)}</SelectLabel>
                    {inGroup.map((p) => {
                      const matches = matchesOf(p).length
                      return (
                        <SelectItem key={p.file.name} value={p.file.name}>
                          <span
                            className={cn(
                              'truncate',
                              query && matches === 0 && 'text-muted-foreground',
                            )}
                          >
                            {p.file.label}
                          </span>
                          {query ? (
                            <MatchCount count={matches} />
                          ) : (
                            <FileCounts counts={countsOf(p)} />
                          )}
                        </SelectItem>
                      )
                    })}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>
          <Select
            value={level}
            onValueChange={(value) => {
              setLevel(value ?? ALL_LEVELS)
              resetView()
            }}
            items={levelItems}
          >
            <SelectTrigger className="min-w-44" aria-label={t('logs.level')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {levelItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <IconTip label={scopeHint}>
            <label
              className={cn(
                'flex h-9 items-center gap-2 rounded-md border border-input-border px-3 text-sm whitespace-nowrap shadow-xs dark:bg-input/30',
                scopeEnabled
                  ? 'cursor-pointer hover:bg-muted'
                  : 'cursor-not-allowed opacity-50',
              )}
            >
              <Checkbox
                checked={duringRun && span !== null}
                disabled={!scopeEnabled}
                onCheckedChange={(checked) => {
                  setDuringRun(checked)
                  resetView()
                }}
                // Neutral tick: no primary fill.
                className="data-checked:border-input data-checked:bg-transparent data-checked:text-foreground dark:data-checked:bg-input/30"
              />
              {t('logs.duringRun')}
            </label>
          </IconTip>
          <div className="relative min-w-48 flex-1">
            <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('logs.searchPlaceholder')}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value)
                resetView()
              }}
              className="pl-8"
            />
          </div>
          <IconTip label={t('logs.refresh')}>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('logs.refresh')}
              onClick={() => void archive.refetch()}
              disabled={archive.isFetching}
            >
              <RefreshCw
                className={cn('h-4 w-4', archive.isFetching && 'animate-spin')}
              />
            </Button>
          </IconTip>
          <IconTip label={t('actions.downloadLogs')}>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('actions.downloadLogs')}
              disabled={!archive.data}
              onClick={() =>
                archive.data &&
                downloadBlob(archive.data.blob, `logs-${jobId}.zip`)
              }
            >
              <Download className="h-4 w-4" />
            </Button>
          </IconTip>
        </div>

        {isRunning && archive.data && (
          <P className="text-sm text-muted-foreground">
            {t('logs.fetchedAt', {
              time: new Date(archive.data.fetchedAt).toLocaleTimeString(),
            })}
          </P>
        )}
        {collectError ? (
          <Notice>
            {t('logs.collectError', { detail: collectError.text })}
          </Notice>
        ) : (
          archive.data &&
          parsed.length > 0 &&
          !hasRunFiles && <Notice>{t('logs.noRunFiles')}</Notice>
        )}

        {archive.isPending ? (
          <div className="flex items-center justify-center gap-3 rounded-lg border py-12 text-sm text-muted-foreground">
            <LoadingSpinner size="sm" />
            {t('logs.loading')}
          </div>
        ) : archive.isError ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border py-12 text-center">
            <P className="font-medium">{t('logs.loadFailed')}</P>
            <P className="text-sm text-muted-foreground">
              {archive.error.message}
            </P>
            <Button variant="outline" onClick={() => void archive.refetch()}>
              {t('logs.retry')}
            </Button>
          </div>
        ) : parsed.length === 0 || (!allFiles && !current) ? (
          <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
            {t('logs.noFiles')}
          </div>
        ) : (
          <CodeBlock className="bg-card min-[1280px]:min-h-0 min-[1280px]:flex-1">
            <CodeBlockHeader>
              <CodeBlockTitle>
                {allFiles ? <Files /> : <FileText />}
                {allFiles ? t('logs.allFiles') : current?.file.label}
                <span className="ms-2 font-normal text-muted-foreground">
                  {allFiles
                    ? t('logs.allMeta', {
                        count: sectionLines,
                        lines: sectionLines.toLocaleString(),
                        files: t('logs.fileCount', { count: sections.length }),
                      })
                    : current &&
                      (scopesCurrent
                        ? t('logs.fileMetaScoped', {
                            size: formatBytes(current.file.bytes.length),
                            shown: linesOf(current).length.toLocaleString(),
                            lines: current.lines.length.toLocaleString(),
                          })
                        : t('logs.fileMeta', {
                            size: formatBytes(current.file.bytes.length),
                            count: current.lines.length,
                            lines: current.lines.length.toLocaleString(),
                          }))}
                </span>
              </CodeBlockTitle>
              <CodeBlockActions>
                {(allFiles ? firstErrorSection : firstError) && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      if (firstErrorSection) {
                        const line = firstErrorSection.matches.find(
                          (l) => l.level === 'error',
                        )
                        if (line)
                          openAt(
                            firstErrorSection.parsed.file.name,
                            line.number,
                          )
                      } else if (current && firstError) {
                        if (!rendered.includes(firstError)) setShowAll(true)
                        setJumpTo({
                          file: current.file.name,
                          line: firstError.number,
                        })
                      }
                    }}
                  >
                    <CircleAlert />
                    {t('logs.firstError')}
                  </Button>
                )}
                <IconTip label={t('logs.wrapLines')}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('logs.wrapLines')}
                    aria-pressed={wrap}
                    onClick={() => setWrap(!wrap)}
                    className="aria-pressed:bg-muted"
                  >
                    <WrapText />
                  </Button>
                </IconTip>
                <IconTip label={t('logs.downloadFile')}>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('logs.downloadFile')}
                    // Disabled, not hidden, so the actions don't shift.
                    disabled={!current}
                    onClick={() =>
                      current &&
                      downloadBlob(
                        new Blob([current.file.bytes.slice()]),
                        current.file.name,
                      )
                    }
                  >
                    <Download />
                  </Button>
                </IconTip>
                <CodeBlockCopyButton
                  value={copyValue}
                  copyLabel={t('logs.copyLines')}
                  copiedLabel={t('logs.copied')}
                  onCopyError={() => showToast.error(t('logs.copyFailed'))}
                />
              </CodeBlockActions>
            </CodeBlockHeader>
            <CodeBlockContent
              ref={contentRef}
              wrap={wrap}
              lineNumbers
              onScroll={(e) => {
                const el = e.currentTarget
                followRef.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight <
                  FOLLOW_SLACK_PX
              }}
              className="max-h-[60dvh] scroll-fade-y min-[1280px]:max-h-none min-[1280px]:flex-1"
            >
              {(allFiles ? sections.length : rendered.length) === 0 ? (
                <CodeBlockLine className="text-muted-foreground">
                  {current &&
                  scopesCurrent &&
                  linesOf(current).length === 0 &&
                  current.lines.length > 0
                    ? t('logs.noRunTimeLines')
                    : t('logs.noMatches')}
                </CodeBlockLine>
              ) : allFiles ? (
                sections.map(({ parsed: p, matches }) => (
                  <Fragment key={p.file.name}>
                    <span
                      data-slot="log-section"
                      className="col-span-2 -mx-4 mt-3 flex items-center gap-2 border-t px-4 pt-3 pb-1 font-sans text-xs select-none first:mt-0 first:border-t-0 first:pt-0"
                    >
                      <span className="font-medium text-foreground">
                        {p.file.label}
                      </span>
                      <span className="text-muted-foreground">
                        {matches.length > SECTION_LIMIT
                          ? t('logs.sectionCapped', {
                              shown: SECTION_LIMIT.toLocaleString(),
                              total: matches.length.toLocaleString(),
                            })
                          : t('logs.lineCount', {
                              count: matches.length,
                              lines: matches.length.toLocaleString(),
                            })}
                      </span>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="-my-1 ms-auto"
                        aria-label={t('logs.openFile', { file: p.file.label })}
                        onClick={() => openFile(p.file.name)}
                      >
                        {t('logs.open')}
                      </Button>
                    </span>
                    {matches.slice(-SECTION_LIMIT).map((line) => (
                      <CodeBlockLine
                        key={line.number}
                        data-file={p.file.name}
                        data-line={line.number}
                        style={{ counterSet: `line ${line.number}` }}
                        className={cn(
                          'cursor-pointer hover:bg-muted/60',
                          line.level && LEVEL_CLASS[line.level],
                        )}
                        onClick={() => {
                          // Ignore text selection.
                          if (window.getSelection()?.toString()) return
                          openAt(p.file.name, line.number)
                        }}
                      >
                        {line.text}
                      </CodeBlockLine>
                    ))}
                  </Fragment>
                ))
              ) : (
                rendered.map((line) => (
                  <CodeBlockLine
                    key={line.number}
                    data-line={line.number}
                    variant={
                      jumpTo?.file === current?.file.name &&
                      jumpTo?.line === line.number
                        ? 'highlighted'
                        : 'default'
                    }
                    // Filtered lines keep their file line numbers.
                    style={{ counterSet: `line ${line.number}` }}
                    className={line.level ? LEVEL_CLASS[line.level] : undefined}
                  >
                    {line.text}
                  </CodeBlockLine>
                ))
              )}
            </CodeBlockContent>
            {allFiles && sections.length > 0 && (
              <CodeBlockFooter className="justify-center">
                <span className="text-xs">{t('logs.allHint')}</span>
              </CodeBlockFooter>
            )}
            {capped && (
              <CodeBlockFooter className="justify-center">
                <span className="text-xs">
                  {t('logs.showingLast', {
                    shown: RENDER_LIMIT.toLocaleString(),
                    total: visible.length.toLocaleString(),
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowAll(true)}
                >
                  {t('logs.showAll')}
                </Button>
              </CodeBlockFooter>
            )}
          </CodeBlock>
        )}
      </div>
    </TooltipProvider>
  )
}

function FileCounts({ counts }: { counts: ParsedLogFile['counts'] }) {
  const { t } = useTranslation('executions')
  if (counts.error > 0) {
    return (
      <span className="ms-auto text-xs text-destructive">
        {t('logs.errorCount', { count: counts.error })}
      </span>
    )
  }
  if (counts.warning > 0) {
    return (
      <span className="ms-auto text-xs text-amber-700 dark:text-amber-400">
        {t('logs.warningCount', { count: counts.warning })}
      </span>
    )
  }
  return null
}

function MatchCount({ count }: { count: number }) {
  const { t } = useTranslation('executions')
  if (count === 0) return null
  return (
    <span className="ms-auto text-xs text-muted-foreground">
      {t('logs.matchCount', { count })}
    </span>
  )
}

function Notice({ children }: { children: string }) {
  return (
    <P className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/10">
      {children}
    </P>
  )
}

function IconTip({
  label,
  children,
}: {
  label: string
  children: ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
