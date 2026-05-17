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
 * ErrorBoundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree
 */

import { Component } from 'react'
import i18n from 'i18next'
import type { ReactNode } from 'react'
import { P } from '@/components/base/typography'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { createLogger } from '@/lib/logger'

const log = createLogger('ErrorBoundary')

/**
 * Props for fallbackRender function
 */
export interface FallbackProps {
  error: Error
  resetErrorBoundary: () => void
}

interface ErrorBoundaryProps {
  children: ReactNode
  /** Static fallback element (doesn't receive error info) */
  fallback?: ReactNode
  /** Render function that receives error and reset function */
  fallbackRender?: (props: FallbackProps) => ReactNode
  /** Callback when error boundary resets */
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

/**
 * Error boundary component to catch and display errors gracefully
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    log.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleReset = () => {
    this.props.onReset?.()
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      // Use fallbackRender if provided (passes error and reset function)
      if (this.props.fallbackRender && this.state.error) {
        return this.props.fallbackRender({
          error: this.state.error,
          resetErrorBoundary: this.handleReset,
        })
      }

      // Use static fallback if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default fallback UI
      return (
        <div className="flex min-h-screen items-center justify-center p-4">
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle className="text-destructive">
                {i18n.t('errors:boundary.title')}
              </CardTitle>
              <CardDescription>
                {i18n.t('errors:boundary.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-muted p-3">
                <P className="font-mono text-muted-foreground">
                  {i18n.t('errors:boundary.details')}
                </P>
              </div>
              <div className="flex gap-2">
                <Button onClick={this.handleReset} variant="outline">
                  {i18n.t('errors:boundary.tryAgain')}
                </Button>
                <Button onClick={() => window.location.reload()}>
                  {i18n.t('errors:boundary.refreshPage')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
