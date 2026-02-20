/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'fable-builder-pipeline-sidebar-open'

interface PipelineSidebarProps {
  children: React.ReactNode
}

export function PipelineSidebar({ children }: PipelineSidebarProps) {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored !== null ? stored === 'true' : true
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(isOpen))
  }, [isOpen])

  const toggleOpen = () => setIsOpen(!isOpen)

  return (
    <>
      {/* Desktop/Tablet Sidebar (>= 768px) */}
      <div className="relative hidden md:flex">
        {/* Toggle button - positioned at the left edge of sidebar area */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleOpen}
          className="absolute top-1/2 -left-3 z-10 h-8 w-6 -translate-y-1/2 rounded-r-none border border-r-0 bg-card hover:bg-muted"
        >
          {isOpen ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>

        <div
          className={cn(
            'flex h-full flex-col border-l bg-card transition-all duration-300',
            isOpen ? 'w-55 lg:w-65' : 'w-0',
          )}
        >
          {isOpen && (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
                <span className="text-sm font-medium">Pipeline Structure</span>
              </div>
              <div className="flex-1 overflow-auto p-2">{children}</div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Bottom Sheet (< 768px) */}
      <div className="md:hidden">
        <div
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 border-t bg-card shadow-lg transition-all duration-300',
            isOpen ? 'h-70' : 'h-12',
          )}
        >
          <button
            onClick={toggleOpen}
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <span className="text-sm font-medium">Pipeline Structure</span>
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
          {isOpen && (
            <div className="h-[calc(100%-48px)] overflow-auto px-2 pb-2">
              {children}
            </div>
          )}
        </div>
        {/* Spacer to prevent content from being hidden behind bottom sheet */}
        <div className={cn('h-12', isOpen && 'h-[280px]')} />
      </div>
    </>
  )
}
