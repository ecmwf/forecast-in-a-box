
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { useEffect, useState } from 'react';
import { Container, Title, Button, TextInput, Loader, Space } from '@mantine/core';

import { showNotification } from '@mantine/notifications';

import { useSettings } from '../../SettingsContext';

import {useApi} from '../../api';

import { withTheme } from '@rjsf/core';
import { Theme } from '@rjsf/mui';

const Form = withTheme(Theme);
import validator from '@rjsf/validator-ajv8';

const Settings = () => {

  const api = useApi();

  const { settings, updateSetting } = useSettings();
  const [apiUrl, setApiUrl] = useState(settings.apiUrl);

  const [settingsConfig, setSettingsConfig] = useState<any>(null);
  const [backendSettings, setBackendSettings] = useState<any>(null);


  // Fetch settings from the API
  const fetchSettings = async () => {
    try {
        const result = await api.get(`/v1/admin/settings`);
        const spec = await result.data;
        setBackendSettings(spec.formData || {});
        setSettingsConfig(spec);
    } catch (error) {
        console.error('Error fetching settings:', error);
    }
  };

  const onSubmit = async (data: any) => {
      showNotification({
          color: 'blue',
          message: 'Updating Settings...'
      });
      try {
          await api.patch(`/v1/admin/settings`, data)
      } catch (error) {
          showNotification({
              color: 'red',
              message: 'Error updating settings',
          });
      }
  }

  const handleApiUrlChange = (newUrl: string) => {
    updateSetting('apiUrl', newUrl);
    setApiUrl(newUrl);
    fetchSettings();
    showNotification({
      title: 'API URL Updated',
      message: `API URL set to ${newUrl}`,
      color: 'blue',
    });
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <Container>
      <Space h="xl" />
      <Title order={2}>Settings</Title>
    <Space h="md" />
      <TextInput
        label="API URL"
        value={apiUrl}
        placeholder="Enter API URL"
        onChange={(e) => setApiUrl(e.target.value)}
      />
        <Button onClick={() => handleApiUrlChange(apiUrl)} mt="md">
            Set API URL
        </Button>
        <TextInput label='Set Banner text' onChange={(e) => updateSetting('banner_text', e.target.value)} value={settings.banner_text || 'PROTOTYPE'} mt="md" />
      <Space h="md" />
      <Title order={3}></Title>
      {backendSettings && settingsConfig.jsonSchema ? (
        <Form
            schema={settingsConfig.jsonSchema}
            uiSchema={settingsConfig.uiSchema}
            validator={validator}
            formData={backendSettings}
            onChange={(e) => { setBackendSettings(e.formData); }}
            onSubmit={(e) => { onSubmit(e.formData); }}
            showErrorList={"bottom"}
            omitExtraData={true}
            />
        ) : (
          <>
            <Loader/>
          </>
        )}
    </Container>
  );
}

export default Settings;
