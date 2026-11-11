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
import type { TFunction } from 'i18next'
import type { JobStatus } from '@/api/types/job.types'
import type {
  LogViewRow,
  LogViewportHandle,
} from '@/features/executions/components/LogViewport'
import type {
  FileContent,
  LogFileMeta,
  ViewResult,
} from '@/features/executions/utils/log-snapshot'
import type {
  EntryCounts,
  LogFileGroup,
  LogLevel,
  RunWindow,
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
  CodeBlockCopyButton,
  CodeBlockHeader,
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
import { LogViewport } from '@/features/executions/components/LogViewport'
import { useLogSnapshot } from '@/features/executions/hooks/useLogSnapshot'
import {
  defaultLogFile,
  formatLogTime,
  indexOfLine,
  lineLevel,
  lineText,
  logFileGroup,
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
  /** Takes a fresh snapshot and opens this failure. */
  focus?: LogFocus | null
}

/** Lines per file in "All files". */
const SECTION_LIMIT = 200

const ALL_LEVELS = 'all'
type LevelFilter = LogLevel | typeof ALL_LEVELS

const ALL_FILES = 'all-files'

const GROUPS: Array<LogFileGroup> = ['run', 'server', 'details']

interface JumpTarget {
  file: string
  line: number
}

/** Where to scroll once the next view arrives. */
type PendingScroll = 'top' | 'end' | JumpTarget | null

/** The view on screen; it lags the controls by one worker reply. */
interface Pane {
  snapshotAt: number
  file: string | null
  /** The filter text the result was made for. */
  query: string
  result: ViewResult
  content: FileContent | null
}

export function LogsPanel({
  jobId,
  status,
  createdAt,
  updatedAt,
  focus,
}: LogsPanelProps) {
  const { t } = useTranslation('executions')
  const logs = useLogSnapshot(jobId)
  const { snapshot, call, load: loadSnapshot } = logs
  const [selected, setSelected] = useState<string | null>(null)
  const [level, setLevel] = useState<LevelFilter>(ALL_LEVELS)
  const [filter, setFilter] = useState('')
  const [wrap, setWrap] = useState(true)
  const [jumpTo, setJumpTo] = useState<JumpTarget | null>(null)
  const [duringRun, setDuringRun] = useState(true)
  const [pane, setPane] = useState<Pane | null>(null)
  const paneRef = useRef<Pane | null>(null)
  const viewportRef = useRef<LogViewportHandle>(null)
  const pendingScrollRef = useRef<PendingScroll>('end')

  const files = useMemo(() => snapshot?.files ?? [], [snapshot])
  const allFiles = selected === ALL_FILES
  const current = allFiles
    ? undefined
    : (files.find((f) => f.name === selected) ?? defaultLogFile(files))
  const viewFile = allFiles ? null : (current?.name ?? null)

  const isRunning = !isTerminalStatus(status)
  const span = useMemo<RunWindow | null>(() => {
    if (!snapshot) return null
    const offset = serverClockOffset(snapshot.files, snapshot.fetchedAt)
    return offset === null
      ? null
      : runWindow(createdAt, isRunning ? null : updatedAt, offset)
  }, [snapshot, createdAt, updatedAt, isRunning])
  // "During run": server-wide lines within the run's time.
  const scope = duringRun ? span : null
  const query = useDeferredValue(filter.trim().toLowerCase())
  const minLevel = level === ALL_LEVELS ? null : level

  useEffect(() => {
    paneRef.current = pane
  }, [pane])

  // Asks the worker for the view; the file's lines only when it changes.
  useEffect(() => {
    if (!snapshot || (!allFiles && viewFile === null)) return
    const before = paneRef.current
    const sameFile =
      before?.snapshotAt === snapshot.fetchedAt && before.file === viewFile
    const reuse = sameFile ? before.content : null
    let cancelled = false
    void call({
      type: 'view',
      request: {
        file: viewFile,
        query,
        minLevel,
        window: scope,
        content: viewFile !== null && reuse === null,
        sectionLimit: SECTION_LIMIT,
      },
    }).then((result) => {
      if (cancelled) return
      setPane({
        snapshotAt: snapshot.fetchedAt,
        file: viewFile,
        query,
        result,
        content: result.content ?? reuse,
      })
    })
    return () => {
      cancelled = true
    }
  }, [snapshot, allFiles, viewFile, query, minLevel, scope, call])

  const shownFile =
    pane && pane.file !== null
      ? files.find((f) => f.name === pane.file)
      : undefined
  const rows = useMemo(
    () => buildRows(pane, shownFile, jumpTo, files, t),
    [pane, shownFile, jumpTo, files, t],
  )

  // Applies the pending scroll once its view is on screen.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const pending = pendingScrollRef.current
    if (!pane || !viewport || pending === null) return
    if (pending === 'top' || pending === 'end') {
      if (pending === 'top') viewport.scrollToRow(0, 'start')
      else viewport.scrollToRow(rows.count - 1, 'end')
      pendingScrollRef.current = null
      return
    }
    if (pane.file !== pending.file) return
    const index = rows.indexOfLine(pending.line)
    if (index !== -1) {
      viewport.scrollToRow(index, 'center')
      pendingScrollRef.current = null
    } else if (duringRun && shownFile?.group === 'server') {
      // Outside the run's time: show the whole file.
      setDuringRun(false)
    } else pendingScrollRef.current = null
  }, [pane, rows, duringRun, shownFile])

  const openFile = (name: string) => {
    setSelected(name)
    setJumpTo(null)
    pendingScrollRef.current = name === ALL_FILES ? 'top' : 'end'
  }
  // Opens the line in its file, filters cleared.
  const openAt = (name: string, line: number) => {
    setSelected(name)
    setFilter('')
    setLevel(ALL_LEVELS)
    setJumpTo({ file: name, line })
    pendingScrollRef.current = { file: name, line }
  }
  const resetScroll = () => {
    setJumpTo(null)
    pendingScrollRef.current = allFiles ? 'top' : 'end'
  }

  const refresh = () => {
    // A refresh follows the tail if the view was at the end.
    if (viewportRef.current && !viewportRef.current.isAtEnd()) {
      pendingScrollRef.current = null
    } else if (!jumpTo) pendingScrollRef.current = allFiles ? 'top' : 'end'
    void loadSnapshot()
  }

  // Loads on first show; a focus request loads its own.
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current || focus) return
    startedRef.current = true
    void loadSnapshot()
  }, [focus, loadSnapshot])

  // Each request: a fresh snapshot, then the failure.
  const appliedFocusRef = useRef<number | null>(null)
  useEffect(() => {
    if (!focus || appliedFocusRef.current === focus.at) return
    appliedFocusRef.current = focus.at
    void loadSnapshot().then(async (fresh) => {
      if (!fresh) return
      const target = await call({ type: 'locate', message: focus.message })
      if (!target) return
      setSelected(target.file)
      if (target.line === undefined) {
        setJumpTo(null)
        pendingScrollRef.current = 'end'
        return
      }
      setFilter('')
      setLevel(ALL_LEVELS)
      setJumpTo({ file: target.file, line: target.line })
      pendingScrollRef.current = { file: target.file, line: target.line }
    })
  }, [focus, loadSnapshot, call])

  if (!snapshot) {
    return logs.error ? (
      <div className="flex flex-col items-center gap-3 rounded-lg border py-12 text-center">
        <P className="font-medium">{t('logs.loadFailed')}</P>
        <P className="text-sm text-muted-foreground">{logs.error.message}</P>
        <Button variant="outline" onClick={() => void loadSnapshot()}>
          {t('logs.retry')}
        </Button>
      </div>
    ) : (
      <div className="flex items-center justify-center gap-3 rounded-lg border py-12 text-sm text-muted-foreground">
        <LoadingSpinner size="sm" />
        {t('logs.loading')}
      </div>
    )
  }

  const perFile = pane?.result.perFile
  const countsOf = (f: LogFileMeta): EntryCounts =>
    perFile?.[f.name]?.counts ?? f.counts
  const matchesOf = (f: LogFileMeta) => perFile?.[f.name]?.matches ?? 0
  const logFiles = files.filter((f) => f.group !== 'details')
  const totals = logFiles.reduce(
    (sum, f) => ({
      warning: sum.warning + countsOf(f).warning,
      error: sum.error + countsOf(f).error,
    }),
    { warning: 0, error: 0 },
  )
  const tooLarge = [...snapshot.skipped, ...snapshot.unread]
  const hasRunFiles =
    files.some((f) => f.group === 'run') ||
    tooLarge.some((f) => logFileGroup(f.name) === 'run')

  const scopeEnabled =
    span !== null && (allFiles || current?.group === 'server')
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
  const scopesShown =
    scope !== null && (pane?.file === null || shownFile?.group === 'server')
  const shownScoped = shownFile ? perFile?.[shownFile.name]?.scoped : undefined

  const fileItems = [
    { value: ALL_FILES, label: t('logs.allFiles') },
    ...files.map((f) => ({ value: f.name, label: f.label })),
  ]
  const levelItems: Array<{ value: LevelFilter; label: string }> = [
    { value: ALL_LEVELS, label: t('logs.levelAll') },
    { value: 'info', label: t('logs.levelInfo') },
    { value: 'warning', label: t('logs.levelWarning') },
    { value: 'error', label: t('logs.levelError') },
  ]
  const sections = pane?.result.sections ?? []
  const sectionLines = sections.reduce((n, s) => n + s.matches, 0)
  const firstError = pane?.result.firstError

  return (
    <TooltipProvider delay={120}>
      <div className="flex flex-col gap-3 min-[1280px]:h-full">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={allFiles ? ALL_FILES : (current?.name ?? null)}
            onValueChange={(name) => openFile(name ?? ALL_FILES)}
            items={fileItems}
            disabled={files.length === 0}
          >
            <SelectTrigger className="min-w-56" aria-label={t('logs.file')}>
              <SelectValue placeholder={t('logs.file')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILES}>
                <span className="truncate">{t('logs.allFiles')}</span>
                {query ? (
                  <MatchCount
                    count={logFiles.reduce((n, f) => n + matchesOf(f), 0)}
                  />
                ) : (
                  <FileCounts counts={totals} />
                )}
              </SelectItem>
              <SelectSeparator />
              {GROUPS.map((group) => {
                const inGroup = files.filter((f) => f.group === group)
                if (inGroup.length === 0) return null
                return (
                  <SelectGroup key={group}>
                    <SelectLabel>{t(`logs.group.${group}`)}</SelectLabel>
                    {inGroup.map((f) => (
                      <SelectItem key={f.name} value={f.name}>
                        <span
                          className={cn(
                            'truncate',
                            query &&
                              matchesOf(f) === 0 &&
                              'text-muted-foreground',
                          )}
                        >
                          {f.label}
                        </span>
                        {query ? (
                          <MatchCount count={matchesOf(f)} />
                        ) : (
                          <FileCounts counts={countsOf(f)} />
                        )}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )
              })}
            </SelectContent>
          </Select>
          <Select
            value={level}
            onValueChange={(value) => {
              setLevel(value ?? ALL_LEVELS)
              resetScroll()
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
                  resetScroll()
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
                resetScroll()
              }}
              className="pl-8"
            />
          </div>
          <IconTip label={t('logs.refresh')}>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('logs.refresh')}
              onClick={refresh}
              disabled={logs.isLoading}
            >
              <RefreshCw
                className={cn('h-4 w-4', logs.isLoading && 'animate-spin')}
              />
            </Button>
          </IconTip>
          <IconTip label={t('actions.downloadLogs')}>
            <Button
              variant="outline"
              size="icon"
              aria-label={t('actions.downloadLogs')}
              onClick={() => downloadBlob(snapshot.blob, `logs-${jobId}.zip`)}
            >
              <Download className="h-4 w-4" />
            </Button>
          </IconTip>
        </div>

        {isRunning && (
          <P className="text-sm text-muted-foreground">
            {t('logs.fetchedAt', {
              time: new Date(snapshot.fetchedAt).toLocaleTimeString(),
            })}
          </P>
        )}
        {snapshot.collectError !== null ? (
          <Notice>
            {t('logs.collectError', { detail: snapshot.collectError })}
          </Notice>
        ) : (
          files.length > 0 &&
          !hasRunFiles && <Notice>{t('logs.noRunFiles')}</Notice>
        )}
        {tooLarge.length > 0 && (
          <Notice>
            {t('logs.skippedLarge', {
              files: tooLarge
                .map((f) => `${f.label} (${formatBytes(f.bytes)})`)
                .join(', '),
            })}
          </Notice>
        )}
        {logs.error && (
          <Notice>
            {t('logs.refreshFailed', { detail: logs.error.message })}
          </Notice>
        )}

        {files.length === 0 || (!allFiles && !current) ? (
          <div className="rounded-lg border py-12 text-center text-sm text-muted-foreground">
            {t('logs.noFiles')}
          </div>
        ) : (
          <CodeBlock className="bg-card min-[1280px]:min-h-0 min-[1280px]:flex-1">
            <CodeBlockHeader>
              <CodeBlockTitle>
                {pane?.file === null ? <Files /> : <FileText />}
                {pane?.file === null
                  ? t('logs.allFiles')
                  : (shownFile?.label ?? current?.label)}
                <span className="ms-2 font-normal text-muted-foreground">
                  {pane?.file === null
                    ? t('logs.allMeta', {
                        count: sectionLines,
                        lines: sectionLines.toLocaleString(),
                        files: t('logs.fileCount', { count: sections.length }),
                      })
                    : shownFile && (
                        <FileMeta
                          file={shownFile}
                          scoped={scopesShown ? shownScoped : undefined}
                        />
                      )}
                </span>
              </CodeBlockTitle>
              <CodeBlockActions>
                {firstError?.line !== undefined && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      if (firstError.line === undefined) return
                      if (pane?.file === null) {
                        openAt(firstError.file, firstError.line)
                        return
                      }
                      setJumpTo({
                        file: firstError.file,
                        line: firstError.line,
                      })
                      pendingScrollRef.current = {
                        file: firstError.file,
                        line: firstError.line,
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
                    disabled={!shownFile}
                    onClick={() => {
                      if (!shownFile) return
                      void call({ type: 'fileBytes', name: shownFile.name })
                        .then((bytes) =>
                          downloadBlob(new Blob([bytes]), shownFile.name),
                        )
                        .catch(() => showToast.error(t('logs.downloadFailed')))
                    }}
                  >
                    <Download />
                  </Button>
                </IconTip>
                <CodeBlockCopyButton
                  value={() => rows.copyText()}
                  copyLabel={t('logs.copyLines')}
                  copiedLabel={t('logs.copied')}
                  onCopyError={() => showToast.error(t('logs.copyFailed'))}
                />
              </CodeBlockActions>
            </CodeBlockHeader>
            {pane === null ? (
              <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                <LoadingSpinner size="sm" />
                {t('logs.loading')}
              </div>
            ) : rows.count === 0 ? (
              <P className="px-4 py-4 font-mono text-muted-foreground">
                {shownFile &&
                scopesShown &&
                shownScoped === 0 &&
                shownFile.totalLines > 0
                  ? t('logs.noRunTimeLines')
                  : t('logs.noMatches')}
              </P>
            ) : (
              <LogViewport
                handleRef={viewportRef}
                count={rows.count}
                row={rows.row}
                wrap={wrap}
                numberDigits={rows.numberDigits}
                hasSections={pane.file === null}
                highlight={pane.query}
                layoutKey={pane}
                onLineClick={openAt}
                sectionAction={(name, label) => (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="-my-1 ms-auto"
                    aria-label={t('logs.openFile', { file: label })}
                    onClick={() => openFile(name)}
                  >
                    {t('logs.open')}
                  </Button>
                )}
                className="max-h-[60dvh] min-[1280px]:max-h-none min-[1280px]:flex-1"
              />
            )}
            {pane?.file === null && sections.length > 0 && (
              <div className="flex justify-center border-t px-4 py-2 text-xs text-muted-foreground">
                {t('logs.allHint')}
              </div>
            )}
          </CodeBlock>
        )}
      </div>
    </TooltipProvider>
  )
}

interface Rows {
  count: number
  row: (index: number) => LogViewRow
  /** Row of a file line number, or -1. */
  indexOfLine: (line: number) => number
  numberDigits: number
  copyText: () => string
}

const NO_ROWS: Rows = {
  count: 0,
  row: () => ({ kind: 'note', text: '' }),
  indexOfLine: () => -1,
  numberDigits: 1,
  copyText: () => '',
}

/** The viewer's rows: one file with its notes, or every file's last matches. */
function buildRows(
  pane: Pane | null,
  file: LogFileMeta | undefined,
  jumpTo: JumpTarget | null,
  files: ReadonlyArray<LogFileMeta>,
  t: TFunction<'executions'>,
): Rows {
  if (!pane) return NO_ROWS

  if (pane.file === null) {
    const rows: Array<LogViewRow> = []
    const lines: Array<string> = []
    let digits = 1
    for (const section of pane.result.sections ?? []) {
      const meta = files.find((f) => f.name === section.name)
      const label = meta?.label ?? section.name
      digits = Math.max(digits, String(meta?.totalLines ?? 0).length)
      rows.push({
        kind: 'section',
        file: section.name,
        first: rows.length === 0,
        label,
        caption:
          section.matches > section.rows.length
            ? t('logs.sectionCapped', {
                shown: section.rows.length.toLocaleString(),
                total: section.matches.toLocaleString(),
              })
            : t('logs.lineCount', {
                count: section.matches,
                lines: section.matches.toLocaleString(),
              }),
      })
      for (const line of section.rows) {
        rows.push({ kind: 'line', ...line, file: section.name })
        lines.push(`${label}:${line.number}:${line.text}`)
      }
    }
    return {
      count: rows.length,
      row: (index) => rows[index],
      indexOfLine: () => -1,
      numberDigits: digits,
      copyText: () => lines.join('\n'),
    }
  }

  const content = pane.content
  const indices = pane.result.indices
  if (!content || !indices || !file) return NO_ROWS
  // Older lines than the budget reads: a note at the top.
  const cut = file.firstNumber > 1 ? 1 : 0
  const lineAt = (position: number): LogViewRow => {
    const i = indices[position]
    const number = content.firstNumber + i
    return {
      kind: 'line',
      number,
      text: lineText(content, i),
      level: lineLevel(content, i),
      highlighted: jumpTo?.file === file.name && jumpTo.line === number,
    }
  }
  return {
    count: indices.length + cut,
    row: (index) => {
      if (cut && index === 0) {
        return {
          kind: 'note',
          text: t('logs.olderLines', {
            count: file.firstNumber - 1,
            lines: (file.firstNumber - 1).toLocaleString(),
          }),
        }
      }
      return lineAt(index - cut)
    },
    indexOfLine: (line) => {
      const position = indexOfLine(content, indices, line)
      if (position === -1) return -1
      return position + cut
    },
    numberDigits: String(file.totalLines).length,
    copyText: () => Array.from(indices, (i) => lineText(content, i)).join('\n'),
  }
}

function FileMeta({
  file,
  scoped,
}: {
  file: LogFileMeta
  /** Lines within the run's time, when that applies. */
  scoped: number | undefined
}) {
  const { t } = useTranslation('executions')
  const size =
    file.readBytes < file.bytes
      ? t('logs.sizeTail', {
          size: formatBytes(file.bytes),
          read: formatBytes(file.readBytes),
        })
      : formatBytes(file.bytes)
  return scoped === undefined
    ? t('logs.fileMeta', {
        size,
        count: file.totalLines,
        lines: file.totalLines.toLocaleString(),
      })
    : t('logs.fileMetaScoped', {
        size,
        shown: scoped.toLocaleString(),
        lines: file.totalLines.toLocaleString(),
      })
}

function FileCounts({ counts }: { counts: EntryCounts }) {
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
