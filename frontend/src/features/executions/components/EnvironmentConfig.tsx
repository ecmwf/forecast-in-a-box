/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

import { useRef, useState } from 'react'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { EnvironmentSpecification } from '@/api/types/job.types'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NumericInput } from '@/components/ui/numeric-input'

interface EnvironmentConfigProps {
  environment: EnvironmentSpecification
  onChange: (env: EnvironmentSpecification) => void
}

interface EnvRow {
  id: string
  key: string
  value: string
}

export function EnvironmentConfig({
  environment,
  onChange,
}: EnvironmentConfigProps) {
  const { t } = useTranslation('executions')

  // Edit as stable-id rows: keying by the editable name would remount the
  // input on rename and drop focus. Object is derived from rows on each change.
  const idCounter = useRef(0)
  const [rows, setRows] = useState<Array<EnvRow>>(() =>
    Object.entries(environment.environment_variables).map(([key, value]) => ({
      id: `env-${idCounter.current++}`,
      key,
      value,
    })),
  )

  function commitRows(nextRows: Array<EnvRow>) {
    setRows(nextRows)
    const vars: Record<string, string> = {}
    for (const row of nextRows) {
      if (row.key) vars[row.key] = row.value
    }
    onChange({ ...environment, environment_variables: vars })
  }

  function handleHostsChange(value: string) {
    onChange({
      ...environment,
      hosts: value === '' ? null : Number(value),
    })
  }

  function handleWorkersChange(value: string) {
    onChange({
      ...environment,
      workers_per_host: value === '' ? null : Number(value),
    })
  }

  function handleEnvKeyChange(id: string, key: string) {
    commitRows(rows.map((row) => (row.id === id ? { ...row, key } : row)))
  }

  function handleEnvValueChange(id: string, value: string) {
    commitRows(rows.map((row) => (row.id === id ? { ...row, value } : row)))
  }

  function handleRemoveEnvVar(id: string) {
    commitRows(rows.filter((row) => row.id !== id))
  }

  function handleAddEnvVar() {
    commitRows([
      ...rows,
      { id: `env-${idCounter.current++}`, key: '', value: '' },
    ])
  }

  return (
    <Collapsible defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted">
        <ChevronDown className="h-4 w-4 transition-transform [[data-panel-closed]_&]:-rotate-90 [[data-panel-open]_&]:rotate-0" />
        {t('submit.advancedTitle')}
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-3 space-y-4 pl-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="env-hosts">{t('submit.hosts')}</Label>
              <NumericInput
                id="env-hosts"
                placeholder={t('submit.hostsPlaceholder')}
                value={environment.hosts ?? ''}
                onChange={(e) => handleHostsChange(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="env-workers">{t('submit.workersPerHost')}</Label>
              <NumericInput
                id="env-workers"
                placeholder={t('submit.workersPerHostPlaceholder')}
                value={environment.workers_per_host ?? ''}
                onChange={(e) => handleWorkersChange(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('submit.envVariables')}</Label>
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  placeholder={t('submit.envKeyPlaceholder')}
                  value={row.key}
                  onChange={(e) => handleEnvKeyChange(row.id, e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder={t('submit.envValuePlaceholder')}
                  value={row.value}
                  onChange={(e) => handleEnvValueChange(row.id, e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveEnvVar(row.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddEnvVar}
              className="w-fit gap-1.5"
            >
              <Plus className="h-4 w-4" />
              {t('submit.addVariable')}
            </Button>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
