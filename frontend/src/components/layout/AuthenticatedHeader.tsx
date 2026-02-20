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
 * AuthenticatedHeader Component
 *
 * Header for authenticated pages with system status,
 * help button, and settings dropdown menu
 */

import { Link } from '@tanstack/react-router'
import {
  Blocks,
  Cloud,
  FileText,
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
import { Logo } from '@/components/common/Logo'
import { NavToggle } from '@/components/layout/NavToggle'
import { StatusDetailsPopover } from '@/components/common/StatusDetailsPopover'
import { StatusIndicator } from '@/components/common/StatusIndicator'
import { useAuth } from '@/features/auth/AuthContext'
import { cn } from '@/lib/utils'
import { useUser } from '@/hooks/useUser'
import { useStatus } from '@/api/hooks/useStatus'
import { useUiStore } from '@/stores/uiStore'

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
          'relative flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8',
          layoutMode === 'boxed' && 'mx-auto max-w-7xl',
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 sm:gap-3"
            aria-label="Dashboard"
          >
            <Logo />
            <span className="hidden text-base font-semibold tracking-tight md:inline md:text-xl">
              Forecast-in-a-Box
            </span>
          </Link>
        </div>

        {/* NavToggle (center) - hidden on mobile */}
        <div className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 md:flex">
          <NavToggle />
        </div>

        {/* Right side - Status, Help, Settings */}
        <div className="flex items-center gap-3 text-muted-foreground">
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
                    <DropdownMenuItem render={<Link to="/admin/sources" />}>
                      <Cloud className="mr-2 h-4 w-4" />
                      Sources
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
        </div>
      </div>

      {/* NavToggle strip - visible only on mobile */}
      <div className="flex justify-center border-t border-border py-1.5 md:hidden">
        <NavToggle />
      </div>
    </header>
  )
}
