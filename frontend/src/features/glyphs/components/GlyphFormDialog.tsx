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
 * GlyphFormDialog Component
 *
 * Dialog for creating or editing a global glyph.
 */

import { useState } from 'react'
import { AlertCircle, HelpCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GlyphDetail } from '@/api/types/fable.types'
import { useCreateGlobalGlyph } from '@/api/hooks/useFable'
import { useAuth } from '@/features/auth/AuthContext'
import { useUser } from '@/hooks/useUser'
import { showToast } from '@/lib/toast'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { P } from '@/components/base/typography'

interface GlyphFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editGlyph?: GlyphDetail
}

export function GlyphFormDialog({
  open,
  onOpenChange,
  editGlyph,
}: GlyphFormDialogProps) {
  const { t } = useTranslation('glyphs')
  const { authType } = useAuth()
  const { data: user } = useUser()
  // Passthrough mode treats every caller as admin (matches backend AuthContext).
  const isAdmin = authType === 'anonymous' || (user?.is_superuser ?? false)
  const isEditing = !!editGlyph

  const [key, setKey] = useState(editGlyph?.name ?? '')
  const [value, setValue] = useState(editGlyph?.valueExample ?? '')
  const [isPublic, setIsPublic] = useState(false)
  // null when public is off; concrete boolean when public is on (backend rule).
  const [overriddable, setOverriddable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const createGlyph = useCreateGlobalGlyph()

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setKey('')
      setValue('')
      setIsPublic(false)
      setOverriddable(null)
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  function handlePublicChange(next: boolean) {
    setIsPublic(next)
    // Default to "pinned" (overriddable=false) — the safer choice when an admin
    // explicitly publishes a value. Reset to null when going private so the
    // submit body satisfies the backend's public/overriddable invariant.
    setOverriddable(next ? false : null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedKey = key.trim()
    const trimmedValue = value.trim()

    if (!trimmedKey || !trimmedValue) return

    try {
      await createGlyph.mutateAsync({
        key: trimmedKey,
        value: trimmedValue,
        public: isPublic,
        overriddable,
      })
      showToast.success(
        isEditing ? t('actions.updateSuccess') : t('actions.createSuccess'),
        trimmedKey,
      )
      handleOpenChange(false)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred'
      setError(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('form.editTitle') : t('form.title')}
          </DialogTitle>
          <DialogDescription>{t('page.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="glyph-key">{t('form.key')}</Label>
            <Input
              id="glyph-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={t('form.keyPlaceholder')}
              disabled={isEditing}
            />
            <P className="text-sm text-muted-foreground">{t('form.keyHelp')}</P>
          </div>

          <div className="space-y-2">
            <Label htmlFor="glyph-value">{t('form.value')}</Label>
            <Input
              id="glyph-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={t('form.valuePlaceholder')}
            />
          </div>

          {isAdmin && (
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="glyph-public">{t('form.public')}</Label>
                <P className="text-sm text-muted-foreground">
                  {t('form.publicHelp')}
                </P>
              </div>
              <Switch
                id="glyph-public"
                checked={isPublic}
                onCheckedChange={handlePublicChange}
              />
            </div>
          )}

          {isAdmin && isPublic && (
            <div className="flex items-center justify-between rounded-md border border-dashed border-border/60 bg-muted/30 p-3">
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="glyph-overriddable">
                    {t('form.overriddable')}
                  </Label>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label={t('form.overriddableTooltip')}
                            className="text-muted-foreground hover:text-foreground"
                          />
                        }
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('form.overriddableTooltip')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <P className="text-sm text-muted-foreground">
                  {t('form.overriddableHelp')}
                </P>
              </div>
              <Switch
                id="glyph-overriddable"
                checked={overriddable === true}
                onCheckedChange={(next) => setOverriddable(next)}
              />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={!key.trim() || !value.trim() || createGlyph.isPending}
            >
              {createGlyph.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('actions.saving')}
                </>
              ) : (
                t('actions.save')
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
