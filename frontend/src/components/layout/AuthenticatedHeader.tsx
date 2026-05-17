/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

/** Header for authenticated pages: system status, help, and settings menu. */

import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Blocks,
  Cloud,
  FileText,
  Globe,
  HelpCircle,
  Layout,
  LogOut,
  Maximize2,
  Minimize2,
  Monitor,
  Moon,
  Settings,
  Sun,
  User,
  Variable,
} from 'lucide-react'
import { P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Logo } from '@/components/common/Logo'
import { ActivityMonitor } from '@/components/common/ActivityMonitor'
import { TimeZoneSelect } from '@/components/common/TimeZoneSelect'
import { NavToggle } from '@/components/layout/NavToggle'
import { StatusDetailsPopover } from '@/components/common/StatusDetailsPopover'
import { StatusIndicator } from '@/components/common/StatusIndicator'
import { useAuth } from '@/features/auth/AuthContext'
import { cn } from '@/lib/utils'
import { useUser } from '@/hooks/useUser'
import { useStatus } from '@/api/hooks/useStatus'
import { useUiStore } from '@/stores/uiStore'
import { timeZoneOffsetLabel, useAppTimeZone } from '@/lib/datetime'

export function AuthenticatedHeader() {
  const { data: user } = useUser()
  const { trafficLightStatus } = useStatus()
  const { authType, signOut } = useAuth()
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const layoutMode = useUiStore((state) => state.layoutMode)
  const setLayoutMode = useUiStore((state) => state.setLayoutMode)
  const dashboardVariant = useUiStore((state) => state.dashboardVariant)
  const setDashboardVariant = useUiStore((state) => state.setDashboardVariant)
  const setTimeZone = useUiStore((state) => state.setTimeZone)
  const timeZone = useAppTimeZone()
  const [tzDialogOpen, setTzDialogOpen] = useState(false)

  const isAuthenticated = authType === 'authenticated'
  const isSuperuser = user?.is_superuser ?? false
  // In pass-through (anonymous) mode, all users are treated as admins
  const isAdmin = authType === 'anonymous' || isSuperuser

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card">
      <div
        className={cn(
          'flex h-16 items-center gap-2 px-4 sm:gap-4 sm:px-6 lg:px-8',
          layoutMode === 'boxed' && 'mx-auto max-w-7xl',
        )}
      >
        {/* Logo — flex-1 balances the actions so the nav stays centred. */}
        <div className="flex min-w-0 flex-1 items-center">
          <Link
            to="/dashboard"
            className="flex min-w-0 items-center gap-2 sm:gap-3"
            aria-label="Dashboard"
          >
            <Logo />
            <span className="hidden truncate text-base font-semibold tracking-tight md:block md:text-xl">
              Forecast-in-a-Box
            </span>
          </Link>
        </div>

        {/* Section nav — in flow so it can't overlap; shown at lg+. */}
        <div className="hidden shrink-0 lg:flex">
          <NavToggle />
        </div>

        {/* Right side - Status, Help, Settings */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 text-muted-foreground">
          {/* System Status Badge - only show label when there's an issue */}
          <StatusDetailsPopover>
            <StatusIndicator
              status={trafficLightStatus}
              variant="badge"
              size="sm"
              showPulse
              showLabel={trafficLightStatus !== 'green'}
            />
          </StatusDetailsPopover>

          {/* Activity Monitor */}
          <ActivityMonitor />

          {/* Help Button */}
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label="Help"
          >
            <HelpCircle className="h-5 w-5" />
          </Button>

          {/* Settings Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground"
                  aria-label="Settings"
                />
              }
            >
              <Settings className="h-5 w-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {/* User Info (only for authenticated users) */}
              {isAuthenticated && user && (
                <>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <P className="leading-none font-medium">
                          {user.email.split('@')[0] || 'User'}
                        </P>
                        <P className="leading-none text-muted-foreground">
                          {user.email}
                        </P>
                      </div>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                </>
              )}

              {/* View Group */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>View</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() =>
                    setLayoutMode(layoutMode === 'boxed' ? 'fluid' : 'boxed')
                  }
                >
                  {layoutMode === 'boxed' ? (
                    <>
                      <Maximize2 className="mr-2 h-4 w-4" />
                      Fluid Layout
                    </>
                  ) : (
                    <>
                      <Minimize2 className="mr-2 h-4 w-4" />
                      Boxed Layout
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sun className="mr-2 h-4 w-4" />
                    Theme
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={theme}
                        onValueChange={(value) =>
                          setTheme(value as 'light' | 'dark' | 'system')
                        }
                      >
                        <DropdownMenuRadioItem value="light">
                          <Sun className="mr-2 h-4 w-4" />
                          Light
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dark">
                          <Moon className="mr-2 h-4 w-4" />
                          Dark
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="system">
                          <Monitor className="mr-2 h-4 w-4" />
                          System
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Layout className="mr-2 h-4 w-4" />
                    Card Style
                  </DropdownMenuSubTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup
                        value={dashboardVariant}
                        onValueChange={(value) =>
                          setDashboardVariant(
                            value as 'default' | 'flat' | 'modern' | 'gradient',
                          )
                        }
                      >
                        <DropdownMenuRadioItem value="default">
                          Default
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="flat">
                          Flat
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="modern">
                          Modern
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="gradient">
                          Gradient
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuPortal>
                </DropdownMenuSub>
                <DropdownMenuItem onClick={() => setTzDialogOpen(true)}>
                  <Globe className="mr-2 h-4 w-4" />
                  Timezone
                  <span className="ml-auto text-xs text-muted-foreground">
                    {timeZoneOffsetLabel(timeZone)}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              {/* Help & Documentation */}
              <DropdownMenuGroup>
                <DropdownMenuItem>
                  <HelpCircle className="mr-2 h-4 w-4" />
                  Help & Support
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <FileText className="mr-2 h-4 w-4" />
                  Documentation
                </DropdownMenuItem>
              </DropdownMenuGroup>

              {/* User Profile Section (only for authenticated users) */}
              {isAuthenticated && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Account</DropdownMenuLabel>
                    <DropdownMenuItem>
                      <User className="mr-2 h-4 w-4" />
                      Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Settings className="mr-2 h-4 w-4" />
                      Settings
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}

              {/* Admin Settings (for superusers or pass-through mode) */}
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Administration</DropdownMenuLabel>
                    <DropdownMenuItem render={<Link to="/admin/plugins" />}>
                      <Blocks className="mr-2 h-4 w-4" />
                      Plugins
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link to="/admin/artifacts" />}>
                      <Cloud className="mr-2 h-4 w-4" />
                      Artifacts
                    </DropdownMenuItem>
                    <DropdownMenuItem render={<Link to="/admin/variables" />}>
                      <Variable className="mr-2 h-4 w-4" />
                      Global Variables
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}

              {/* Sign Out */}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Dialog open={tzDialogOpen} onOpenChange={setTzDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Application timezone</DialogTitle>
                <DialogDescription>
                  All dates and times — including forecast base times — are
                  shown and entered in this timezone. Defaults to UTC.
                </DialogDescription>
              </DialogHeader>
              <TimeZoneSelect
                value={timeZone}
                onChange={(tz) => {
                  setTimeZone(tz)
                  setTzDialogOpen(false)
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Nav strip — shown below the bar until the centred nav fits (lg+); scrolls when cramped. */}
      <div className="overflow-x-auto border-t border-border lg:hidden">
        <div className="flex w-fit min-w-full justify-center px-4 py-1.5">
          <NavToggle />
        </div>
      </div>
    </header>
  )
}
