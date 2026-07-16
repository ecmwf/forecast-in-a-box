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
 * DefineVariableButton — quick fix for an unresolvable glyph reference.
 * Opens a small dialog that creates the name as a local variable (stored in
 * the configuration, portable) or a global one (stored on this system).
 */

import { useState } from 'react'
import { CornerDownRight } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fableKeys, useCreateGlobalGlyph } from '@/api/hooks/useFable'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useFableBuilderStore } from '@/features/fable-builder/stores/fableBuilderStore'
import { showToast } from '@/lib/toast'

type Scope = 'local' | 'global'

export function DefineVariableButton({ name }: { name: string }) {
  const { t } = useTranslation('glyphs')
  const setLocalGlyph = useFableBuilderStore((state) => state.setLocalGlyph)
  const createGlobal = useCreateGlobalGlyph()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('local')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const glyphRef = `\${${name}}`

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setValue('')
      setScope('local')
      setError(null)
    }
  }

  async function handleCreate() {
    const trimmed = value.trim()
    if (!trimmed) return
    if (scope === 'local') {
      setLocalGlyph(name, trimmed)
      handleOpenChange(false)
      return
    }
    try {
      await createGlobal.mutateAsync({
        key: name,
        value: trimmed,
        public: false,
        overriddable: null,
      })
      // A global doesn't change the fable, so revalidate explicitly.
      await queryClient.invalidateQueries({
        queryKey: [...fableKeys.all, 'validation'],
      })
      showToast.success(t('actions.createSuccess'), name)
      handleOpenChange(false)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('field.defineVariable.globalCreateFailed'),
      )
    }
  }

  return (
    <>
      {/* ↳ ties the action to the error line above it */}
      <div className="mt-1 flex items-center gap-1.5">
        <CornerDownRight
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-destructive/70"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 font-mono text-xs"
          onClick={() => handleOpenChange(true)}
        >
          {t('field.defineVariable.action', { name: glyphRef })}
        </Button>
      </div>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('field.defineVariable.title')}</DialogTitle>
            <DialogDescription>
              {t('field.defineVariable.description', { name: glyphRef })}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t('field.defineVariable.scopeLabel')}</Label>
              <ToggleGroup
                variant="outline"
                className="w-full"
                value={[scope]}
                onValueChange={(next) => {
                  const first = next[0]
                  if (first === 'local' || first === 'global') setScope(first)
                }}
              >
                <ToggleGroupItem value="local" className="flex-1">
                  {t('field.defineVariable.scopeLocal')}
                </ToggleGroupItem>
                <ToggleGroupItem value="global" className="flex-1">
                  {t('field.defineVariable.scopeGlobal')}
                </ToggleGroupItem>
              </ToggleGroup>
              <p className="text-xs text-muted-foreground">
                {scope === 'local'
                  ? t('field.defineVariable.scopeLocalHint')
                  : t('field.defineVariable.scopeGlobalHint')}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`define-variable-${name}`}>
                {t('field.defineVariable.valueLabel')}
              </Label>
              <Input
                id={`define-variable-${name}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && value.trim()) void handleCreate()
                }}
              />
            </div>
            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              {t('field.defineVariable.cancel')}
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={!value.trim() || createGlobal.isPending}
            >
              {t('field.defineVariable.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
