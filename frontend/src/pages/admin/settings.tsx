
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
import { Container, Title, Button, TextInput, Group, Loader, Space } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';


import { useSettings } from '../../SettingsContext';

import {useApi} from '../../api';


// Define the TypeScript interfaces for settings
interface APISettings {
    [key: string]: string | number; // Adjust types based on actual API settings structure
  }
  
interface CascadeSettings {
  [key: string]: string | number; // Adjust types based on actual cascade settings structure
}

interface Settings {
  api: APISettings;
  cascade: CascadeSettings;
}


const Settings = () => {

  const api = useApi();

  const { settings, updateSetting } = useSettings();

  const [apiSettings, setApiSettings] = useState<Settings | null>(null);

  const [apiUrl, setApiUrl] = useState(settings.apiUrl);

  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [formValues, setFormValues] = useState({} as Settings);

  // Fetch settings from the API
  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await api.get('/v1/admin/settings');
      setApiSettings(response.data);
      setFormValues(response.data); // Initialize form values
    } catch (error) {
      showNotification({
        id: 'fetch-settings-error',
        title: 'Error',
        message: 'Failed to fetch settings',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  // Update settings via the API
  const updateApiSettings = async () => {
    setUpdating(true);
    try {
      await api.post('/v1/admin/settings', formValues);
      showNotification({
        title: 'Success',
        message: 'Settings updated successfully',
        color: 'green',
      });
    } catch (error) {
      showNotification({
        title: 'Error',
        message: 'Failed to update settings',
        color: 'red',
      });
    } finally {
      setUpdating(false);
    }
  };

  // Handle form input changes
  const handleInputChange = (section: string, key: string, value: string) => {
    setFormValues((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section as keyof Settings] as Record<string, any>),
        [key]: value,
      },
    }));
  };

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
      {apiSettings && !loading && (
        <>
          <Title order={4}>API Settings</Title>
          {Object.keys(apiSettings.api).map((key) => (
            <TextInput
              key={key}
              label={key}
              value={formValues.api[key] || ''}
              onChange={(e) => handleInputChange('api', key, e.target.value)}
            />
          ))}
          <Space h="md" />
          <Title order={4}>Cascade Settings</Title>
          {Object.keys(apiSettings.cascade).map((key) => (
            <TextInput
              key={key}
              label={key}
              value={formValues.cascade[key] || ''}
              onChange={(e) => handleInputChange('cascade', key, e.target.value)}
            />
          ))}
          <Space h="md" />
          <Group>
            <Button onClick={fetchSettings} leftSection={<IconRefresh />} disabled={loading}>
              Refresh
            </Button>
            <Button onClick={updateApiSettings} loading={updating} color='red'>
              Save Changes
            </Button>
          </Group>
        </>
      )}
      {loading ? (
        <Loader />
      ) : null}
    </Container>
  );
}

export default Settings;