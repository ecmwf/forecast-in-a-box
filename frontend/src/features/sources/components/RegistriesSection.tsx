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
 * RegistriesSection Component
 *
 * Displays connected source registries with management options.
 * Registries are lightweight FIAB adapters that point to Stores (e.g., HuggingFace).
 */

import { useState } from 'react'
import {
  CheckCircle2,
  Database,
  ExternalLink,
  HardDrive,
  MoreVertical,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { SourceRegistry } from '@/api/types/sources.types'
import type { DashboardVariant, PanelShadow } from '@/stores/uiStore'
import { H3, H4, P } from '@/components/base/typography'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface RegistriesSectionProps {
  registries: Array<SourceRegistry>
  onAddRegistry: (url: string, name?: string) => void
  onRemoveRegistry?: (registryId: string) => void
  onSyncRegistry?: (registryId: string) => void
  isAddingRegistry?: boolean
  isSyncingRegistry?: string | null
  variant?: DashboardVariant
  shadow?: PanelShadow
}

export function RegistriesSection({
  registries,
  onAddRegistry,
  onRemoveRegistry,
  onSyncRegistry,
  isAddingRegistry = false,
  isSyncingRegistry = null,
  variant,
  shadow,
}: RegistriesSectionProps) {
  const { t } = useTranslation('sources')
  const { t: tCommon } = useTranslation('common')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (newUrl.trim()) {
      onAddRegistry(newUrl.trim(), newName.trim() || undefined)
      setNewUrl('')
      setNewName('')
      setShowAddForm(false)
    }
  }

  const formatLastSynced = (dateStr?: string) => {
    if (!dateStr) return t('registry.neverSynced')
    const date = new Date(dateStr)
    return t('registry.lastSynced', {
      date: date.toLocaleDateString(),
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    })
  }

  const getStoreIcon = (type: string) => {
    switch (type) {
      case 'huggingface':
        return '🤗'
      case 's3':
        return '☁️'
      case 'gcs':
        return '☁️'
      case 'local':
        return '💾'
      default:
        return '📦'
    }
  }

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between px-1">
        <H3 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase">
          {t('registry.title')}
        </H3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-primary"
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('registry.add')}
        </Button>
      </div>

      {/* Add Registry Form */}
      {showAddForm && (
        <Card
          className="border-dashed border-primary/30 bg-primary/5 p-4"
          variant={variant}
          shadow={shadow}
        >
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="sm:flex-1">
                <Input
                  type="text"
                  placeholder={t('registry.namePlaceholder')}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  disabled={isAddingRegistry}
                />
              </div>
              <div className="sm:flex-2">
                <Input
                  type="url"
                  placeholder={t('registry.urlPlaceholder')}
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  disabled={isAddingRegistry}
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowAddForm(false)
                  setNewUrl('')
                  setNewName('')
                }}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                type="submit"
                disabled={isAddingRegistry || !newUrl.trim()}
              >
                {isAddingRegistry ? tCommon('loading') : t('registry.connect')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Registries List */}
      <div className="grid gap-3">
        {registries.map((registry) => (
          <Card
            key={registry.id}
            className="p-4"
            variant={variant}
            shadow={shadow}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {/* Icon + Info Row */}
              <div className="flex min-w-0 flex-1 gap-4">
                {/* Icon */}
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Database className="h-6 w-6 text-primary" />
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <H4 className="truncate font-semibold">{registry.name}</H4>
                    {registry.isDefault && (
                      <Badge variant="secondary" className="shrink-0">
                        {t('registry.default')}
                      </Badge>
                    )}
                  </div>
                  <P className="mb-2 truncate text-muted-foreground">
                    {registry.url}
                  </P>

                  {/* Stores */}
                  {registry.stores.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {registry.stores.map((store) => (
                        <Tooltip key={store.id}>
                          <TooltipTrigger
                            render={
                              <Badge
                                variant="outline"
                                className="cursor-help text-sm"
                              />
                            }
                          >
                            <HardDrive className="mr-1 h-3 w-3" />
                            <span className="mr-1">
                              {getStoreIcon(store.type)}
                            </span>
                            {store.name}
                          </TooltipTrigger>
                          <TooltipContent>
                            <P className="font-medium">{store.name}</P>
                            <P className="text-muted-foreground">{store.url}</P>
                            <P className="capitalize">{store.type}</P>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Status & Stats + Actions */}
              <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:gap-2">
                {/* Status & Stats */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:flex-col sm:items-end sm:gap-2">
                  {/* Connection Status */}
                  {registry.isConnected ? (
                    <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        {t('registry.connected')}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-destructive">
                      <XCircle className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        {t('registry.disconnected')}
                      </span>
                    </div>
                  )}

                  {/* Sources Count */}
                  <div className="text-sm text-muted-foreground">
                    {t('registry.sourcesCount', {
                      count: registry.sourcesCount,
                    })}
                  </div>

                  {/* Last Synced - hidden on mobile to save space */}
                  <div className="hidden text-sm text-muted-foreground sm:block">
                    {formatLastSynced(registry.lastSyncedAt)}
                  </div>
                </div>

                {/* Actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" size="icon" />}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      render={
                        <a
                          href={registry.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      }
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t('registry.visitSite')}
                    </DropdownMenuItem>
                    {onSyncRegistry && (
                      <DropdownMenuItem
                        onClick={() => onSyncRegistry(registry.id)}
                        disabled={isSyncingRegistry === registry.id}
                      >
                        <RefreshCw
                          className={`mr-2 h-4 w-4 ${isSyncingRegistry === registry.id ? 'animate-spin' : ''}`}
                        />
                        {isSyncingRegistry === registry.id
                          ? t('registry.syncing')
                          : t('registry.sync')}
                      </DropdownMenuItem>
                    )}
                    {!registry.isDefault && onRemoveRegistry && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onRemoveRegistry(registry.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {t('registry.remove')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
