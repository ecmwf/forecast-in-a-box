/*
 * (C) Copyright 2026- ECMWF and individual contributors.
 *
 * This software is licensed under the terms of the Apache Licence Version 2.0
 * which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
 * In applying this licence, ECMWF does not waive the privileges and immunities
 * granted to it by virtue of its status as an intergovernmental organisation nor
 * does it submit to any jurisdiction.
 */

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

interface EnvironmentConfigProps {
  environment: EnvironmentSpecification
  onChange: (env: EnvironmentSpecification) => void
}

export function EnvironmentConfig({
  environment,
  onChange,
}: EnvironmentConfigProps) {
  const { t } = useTranslation('executions')

  const envEntries = Object.entries(environment.environment_variables)

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

  function handleEnvKeyChange(oldKey: string, newKey: string) {
    const newVars = { ...environment.environment_variables }
    const value = newVars[oldKey] ?? ''
    delete newVars[oldKey]
    newVars[newKey] = value
    onChange({ ...environment, environment_variables: newVars })
  }

  function handleEnvValueChange(key: string, value: string) {
    onChange({
      ...environment,
      environment_variables: {
        ...environment.environment_variables,
        [key]: value,
      },
    })
  }

  function handleRemoveEnvVar(key: string) {
    const newVars = { ...environment.environment_variables }
    delete newVars[key]
    onChange({ ...environment, environment_variables: newVars })
  }

  function handleAddEnvVar() {
    onChange({
      ...environment,
      environment_variables: {
        ...environment.environment_variables,
        '': '',
      },
    })
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
              <Input
                id="env-hosts"
                type="number"
                min={1}
                placeholder={t('submit.hostsPlaceholder')}
                value={environment.hosts ?? ''}
                onChange={(e) => handleHostsChange(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="env-workers">{t('submit.workersPerHost')}</Label>
              <Input
                id="env-workers"
                type="number"
                min={1}
                placeholder={t('submit.workersPerHostPlaceholder')}
                value={environment.workers_per_host ?? ''}
                onChange={(e) => handleWorkersChange(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('submit.envVariables')}</Label>
            {envEntries.map(([key, value], index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  placeholder={t('submit.envKeyPlaceholder')}
                  value={key}
                  onChange={(e) => handleEnvKeyChange(key, e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder={t('submit.envValuePlaceholder')}
                  value={value}
                  onChange={(e) => handleEnvValueChange(key, e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleRemoveEnvVar(key)}
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
