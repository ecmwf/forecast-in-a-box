"use client";

import React, { useEffect, useState } from 'react';
import { Container, Title, Button, TextInput, Group, Loader, Space } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';


import { useSettings } from '@/app/SettingsContext';

import {useApi} from '@/app/api';


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


const HomePage = () => {

  const api = useApi();

  const { settings, updateSetting, updateSettings } = useSettings();

  const [apiSettings, setApiSettings] = useState();

  const [apiUrl, setApiUrl] = useState(settings.apiUrl);

  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [formValues, setFormValues] = useState({} as Settings);

  // Fetch settings from the API
  const fetchSettings = async () => {
    setLoading(true);
    try {
      const response = await api.get('/api/v1/setting');
      setApiSettings(response.data);
      setFormValues(response.data); // Initialize form values
    } catch (error) {
      showNotification({
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
      await api.post('/api/v1/setting', formValues);
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
  const handleInputChange = (section, key, value) => {
    setFormValues((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
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

export default HomePage;