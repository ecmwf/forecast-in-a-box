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
 * Decorative vignettes for the welcome tour, one per step — miniature mock
 * screens, aria-hidden with intentionally untranslated sample content.
 */

/** Soft radial fade so the globe mesh melts into the backdrop. */
const GLOBE_MASK = {
  maskImage:
    'radial-gradient(ellipse 55% 55% at 50% 50%, black 35%, transparent 72%)',
  WebkitMaskImage:
    'radial-gradient(ellipse 55% 55% at 50% 50%, black 35%, transparent 72%)',
} as const

export function WelcomeIllustration() {
  return (
    <div aria-hidden className="absolute inset-0">
      <img
        src="/logos/ecmwf-globe-mesh.webp"
        alt=""
        className="pointer-events-none absolute -top-10 -right-15 w-[380px] opacity-[0.18] dark:opacity-30 dark:invert"
        style={GLOBE_MASK}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3.5">
        <img
          src="/logos/fiab-mark-blue.svg"
          alt=""
          className="h-auto w-19 dark:brightness-150"
        />
        <span className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
          ECMWF · Forecast-in-a-Box
        </span>
      </div>
    </div>
  )
}

export function DashboardIllustration() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center"
    >
      <div className="flex w-105 flex-col gap-2.5 rounded-[10px] border bg-card p-3.5 shadow-md">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-lg border px-3 py-2.5">
            <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              System status
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="size-[9px] animate-pulse rounded-full bg-success motion-reduce:animate-none" />
              <span className="text-[15px] font-semibold">All OK</span>
            </div>
          </div>
          <div className="rounded-lg border px-3 py-2.5">
            <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Available models
            </div>
            <div className="mt-1.5 text-[15px] font-semibold">
              7{' '}
              <span className="text-xs font-normal text-muted-foreground">
                of 11 downloaded
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <span className="flex items-baseline gap-2">
            <span className="text-xs">AIFS 72-Hour Forecast</span>
            <span className="font-mono text-[9.5px] text-muted-foreground">
              Europe · 2t, msl
            </span>
          </span>
          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
            Completed
          </span>
        </div>
        <div className="flex items-center justify-between rounded-lg border px-3 py-2">
          <span className="flex items-baseline gap-2">
            <span className="text-xs">IFS Ensemble Statistics</span>
            <span className="font-mono text-[9.5px] text-muted-foreground">
              Global · 2t mean, +72 h
            </span>
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            Scheduled
          </span>
        </div>
      </div>
    </div>
  )
}

const PIPELINE_BLOCKS = [
  { kind: 'Source', title: 'IFS Ensemble', bar: 'bg-blue-500' },
  { kind: 'Transform', title: 'Select 2t', bar: 'bg-amber-500' },
  { kind: 'Product', title: 'Ensemble mean', bar: 'bg-purple-500' },
] as const

function OutputBlock({ title }: { title: string }) {
  return (
    <div className="w-23 overflow-hidden rounded-[10px] border bg-card shadow-md">
      <div className="h-[5px] bg-emerald-500 opacity-80" />
      <div className="px-2.5 pt-1.5 pb-2">
        <div className="text-[9px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Output
        </div>
        <div className="mt-0.5 text-[11.5px] font-semibold whitespace-nowrap">
          {title}
        </div>
      </div>
    </div>
  )
}

export function BlocksIllustration() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center"
    >
      <div className="flex items-center">
        {PIPELINE_BLOCKS.map(({ kind, title, bar }) => (
          <div key={kind} className="flex items-center">
            <div className="w-[102px] overflow-hidden rounded-[10px] border bg-card shadow-md">
              <div className={`h-[5px] opacity-80 ${bar}`} />
              <div className="px-[11px] pt-2 pb-[11px]">
                <div className="text-[9px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {kind}
                </div>
                <div className="mt-[3px] text-[11.5px] font-semibold whitespace-nowrap">
                  {title}
                </div>
              </div>
            </div>
            <div className="relative h-0.5 w-5 bg-border">
              <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-zinc-400" />
            </div>
          </div>
        ))}
        {/* Fan-out to two outputs */}
        <svg
          width="30"
          height="110"
          viewBox="0 0 30 110"
          className="-ml-5 flex-none text-border"
        >
          <path
            d="M 0 55 C 14 55, 14 26, 28 26"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M 0 55 C 14 55, 14 84, 28 84"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <circle cx="28" cy="26" r="3" className="fill-zinc-400" />
          <circle cx="28" cy="84" r="3" className="fill-zinc-400" />
        </svg>
        <div className="flex flex-col gap-2.5">
          <OutputBlock title="Map plot" />
          <OutputBlock title="GRIB Sink" />
        </div>
      </div>
    </div>
  )
}

/** Pastel heat palette for the GRIB tile thumb. */
const HEAT = ['#dbeafe', '#93c5fd', '#86efac', '#fde047', '#fb923c', '#ef4444']

function Thumb({
  badge,
  badgeClass,
  label,
  children,
}: {
  badge: string
  badgeClass: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-[7px] border">
      <div className="relative h-[46px]">
        {children}
        <span
          className={`absolute top-1 left-1 rounded px-1 font-mono text-[8px] font-bold ${badgeClass}`}
        >
          {badge}
        </span>
      </div>
      <div className="px-[7px] pt-1 pb-1.5 font-mono text-[9.5px]">{label}</div>
    </div>
  )
}

function MiniTabs({ labels }: { labels: ReadonlyArray<string> }) {
  return (
    <div className="flex gap-1 border-b bg-muted px-2.5 py-[7px]">
      {labels.map((label, index) => (
        <span
          key={label}
          className={
            index === 0
              ? 'rounded-md bg-card px-2 py-[3px] text-[10.5px] font-semibold shadow-xs'
              : 'px-2 py-[3px] text-[10.5px] text-muted-foreground'
          }
        >
          {label}
        </span>
      ))}
    </div>
  )
}

export function ExecutionIllustration() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center"
    >
      <div className="grid w-[470px] grid-cols-[150px_1fr] overflow-hidden rounded-[10px] border bg-card shadow-md">
        <div
          className="flex flex-col items-start gap-2 border-r bg-background p-2.5"
          style={{
            backgroundImage:
              'radial-gradient(circle, var(--border) 1px, transparent 1px)',
            backgroundSize: '12px 12px',
          }}
        >
          <div className="w-26 overflow-hidden rounded-[7px] border bg-card">
            <div className="h-1 bg-blue-500 opacity-80" />
            <div className="px-2 pt-[5px] pb-1.5 text-[10px] font-semibold whitespace-nowrap">
              Anemoi Model Src
            </div>
          </div>
          <div className="ml-4 w-22 overflow-hidden rounded-[7px] border bg-card">
            <div className="h-1 bg-amber-500 opacity-80" />
            <div className="px-2 pt-[5px] pb-1.5 text-[10px] font-semibold">
              Select
            </div>
          </div>
          <div className="ml-8 w-22 overflow-hidden rounded-[7px] border bg-card">
            <div className="h-1 bg-emerald-500 opacity-80" />
            <div className="px-2 pt-[5px] pb-1.5 text-[10px] font-semibold">
              Map Plot
            </div>
          </div>
        </div>
        <div className="flex flex-col">
          <MiniTabs
            labels={['Outputs', 'Logs', 'Task graph', 'Specification']}
          />
          <div className="flex items-center gap-2 border-b px-2.5 py-2">
            <span className="rounded-[5px] bg-success/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-success">
              GRIB
            </span>
            <span className="text-[11px] font-semibold">GRIB Sink</span>
            <span className="text-[10px] text-muted-foreground">16 files</span>
            <span className="ml-auto rounded-md border px-2 py-[3px] text-[10px] font-semibold">
              Visualise
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 p-2.5">
            <Thumb
              badge="PNG"
              badgeClass="bg-[#fff4d6]/95 text-[#a65f00]"
              label="mapPlot.png"
            >
              <div
                className="h-full"
                style={{
                  background:
                    'linear-gradient(125deg, #fde68a 0%, #f97316 45%, #b91c1c 100%)',
                }}
              />
            </Thumb>
            <Thumb
              badge="GRIB"
              badgeClass="bg-success/10 text-success backdrop-blur-xs"
              label="forecast.grib"
            >
              <div className="grid h-full grid-cols-8 grid-rows-4 gap-[2px] bg-background p-[3px]">
                {Array.from({ length: 32 }, (_, i) => (
                  <span
                    key={i}
                    className="rounded-[2px]"
                    style={{
                      background: HEAT[(i * 5 + Math.floor(i / 8) * 3) % 6],
                    }}
                  />
                ))}
              </div>
            </Thumb>
            <Thumb
              badge="NC"
              badgeClass="bg-blue-100/95 text-blue-700"
              label="forecast.nc"
            >
              <div className="h-full bg-blue-50/60 dark:bg-blue-950/30">
                <span className="absolute top-[6px] left-[16px] h-6 w-9 rounded-[3px] border-[1.5px] border-blue-600 bg-blue-100/60" />
                <span className="absolute top-[13px] left-[26px] h-6 w-9 rounded-[3px] border-[1.5px] border-blue-400 bg-blue-100/40" />
                <span className="absolute top-[20px] left-[36px] h-6 w-9 rounded-[3px] border-[1.5px] border-blue-300 bg-blue-100/25" />
              </div>
            </Thumb>
          </div>
        </div>
      </div>
    </div>
  )
}

function SlotChip({ slot, label }: { slot: 'a' | 'b'; label: string }) {
  return (
    <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-[5px] rounded-[5px] bg-white/90 px-[7px] py-0.5">
      <span
        className={`inline-flex size-[13px] items-center justify-center rounded text-[8.5px] font-bold text-white ${
          slot === 'a' ? 'bg-slot-a' : 'bg-slot-b'
        }`}
      >
        {slot.toUpperCase()}
      </span>
      <span className="font-mono text-[8.5px] text-zinc-700">{label}</span>
    </span>
  )
}

function SlotTimeline({ slot }: { slot: 'a' | 'b' }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-[11px] text-center font-mono text-[8.5px] font-bold ${
          slot === 'a' ? 'text-slot-a' : 'text-slot-b'
        }`}
      >
        {slot.toUpperCase()}
      </span>
      <div
        className="h-[5px] flex-1 rounded-sm opacity-55"
        style={{
          background: `repeating-linear-gradient(90deg, var(--slot-${slot}) 0 4px, transparent 4px 7px)`,
        }}
      />
    </div>
  )
}

export function ViewerIllustration() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 flex items-center justify-center"
    >
      <div className="w-110 overflow-hidden rounded-[10px] border bg-card shadow-md">
        <div className="flex items-center gap-1 border-b bg-muted px-2.5 py-[7px]">
          {['Side by side', 'Swipe', 'Flicker', 'Blend'].map((label, index) => (
            <span
              key={label}
              className={
                index === 0
                  ? 'rounded-md bg-card px-2 py-[3px] text-[10.5px] font-semibold shadow-xs'
                  : 'px-2 py-[3px] text-[10.5px] text-muted-foreground'
              }
            >
              {label}
            </span>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground">
            Linked layers
          </span>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border">
          <div
            className="relative h-24"
            style={{
              background:
                'linear-gradient(160deg, #22d3ee 0%, #a3e635 30%, #facc15 52%, #f97316 74%, #7c3aed 100%)',
            }}
          >
            <SlotChip slot="a" label="Map Plot · 00:00Z" />
          </div>
          <div
            className="relative h-24 bg-background"
            style={{
              backgroundImage:
                'repeating-radial-gradient(circle at 65% 40%, transparent 0, transparent 9px, #cbd5e1 9px, #cbd5e1 10px)',
            }}
          >
            <SlotChip slot="b" label="ECMWF · 00:00Z" />
          </div>
        </div>
        <div className="flex flex-col gap-[5px] border-t px-3 pt-2 pb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              Valid time
            </span>
            <div className="relative h-1 flex-1 rounded-full bg-muted">
              <div className="absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary" />
              <span className="absolute top-1/2 left-2/5 box-border size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-card" />
            </div>
            <span className="font-mono text-[9px] text-muted-foreground">
              41 / 103
            </span>
          </div>
          <SlotTimeline slot="a" />
          <SlotTimeline slot="b" />
        </div>
      </div>
    </div>
  )
}
