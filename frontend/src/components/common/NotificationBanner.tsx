/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { Link } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { cn, isExternalUrl } from '@/lib/utils'

export interface NotificationBannerProps {
  message: string
  linkText?: string
  linkHref?: string
  variant?: 'info' | 'warning' | 'error'
  onDismiss?: () => void
  className?: string
}

const variantStyles = {
  info: 'bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-200 border-blue-100 dark:border-blue-800',
  warning:
    'bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-200 border-amber-100 dark:border-amber-800',
  error:
    'bg-red-50 dark:bg-red-900/40 text-red-600 dark:text-red-200 border-red-100 dark:border-red-800',
}

const linkStyles = {
  info: 'hover:text-blue-800 dark:hover:text-blue-100',
  warning: 'hover:text-amber-800 dark:hover:text-amber-100',
  error: 'hover:text-red-800 dark:hover:text-red-100',
}

export function NotificationBanner({
  message,
  linkText,
  linkHref,
  variant = 'info',
  onDismiss,
  className,
}: NotificationBannerProps) {
  return (
    <div
      className={cn(
        'relative flex items-center justify-center border-b px-12 py-3 text-base',
        variantStyles[variant],
        className,
      )}
      role="alert"
    >
      <span className="text-center">
        {message}
        {linkText && linkHref && (
          <>
            {' '}
            {isExternalUrl(linkHref) ? (
              <a
                href={linkHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn('font-medium underline', linkStyles[variant])}
              >
                {linkText}
              </a>
            ) : (
              <Link
                to={linkHref}
                className={cn('font-medium underline', linkStyles[variant])}
              >
                {linkText}
              </Link>
            )}
            .
          </>
        )}
      </span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1.5 transition-opacity hover:bg-black/5 hover:opacity-70 sm:right-4 dark:hover:bg-white/10"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
