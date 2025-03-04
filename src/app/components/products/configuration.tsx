"use client";

import { Tabs, Card, TextInput, Select, Button, Loader, Stack, Group} from '@mantine/core';
import { useState, useEffect } from 'react';

import classes from './configuration.module.css';

interface ConfigurationProps {
  apiPath: string;
  selected: string | null;
  submitTarget?;
  initial?: Record<string, any>;
}

function Configuration({ apiPath, selected, submitTarget, initial}: ConfigurationProps) {
  if (!selected) {
    return (
      <Card>
        <p>Select Product to configure</p>
      </Card>
    );
  }

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [options, setOptions] = useState<Record<string, { label: string; description: string; example?: string; values?: string[], multiple?: boolean}>>({});
  const [loading, setLoading] = useState(true);

  // Handle select field changes
  const handleChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  useEffect(() => {
    const fetchInitialOptions = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${apiPath}/${selected}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}), // Empty request for initial load
        });

        const data = await response.json();

        // Extract keys from API response to set formData and options dynamically
        const initialFormData = Object.keys(data).reduce((acc, key) => {
          acc[key] = ""; // Initialize all fields with empty values
          return acc;
        }, {});

        setFormData(initialFormData);
        setOptions(data);
      } catch (error) {
        console.error("Error fetching options:", error);
      }
      setLoading(false);
    };

    fetchInitialOptions();
  }, [selected]); // Run only on component mount

  useEffect(() => {
    if (Object.keys(formData).length === 0) return; // Prevent unnecessary fetch

    const fetchUpdatedOptions = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${apiPath}/${selected}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });

        const data = await response.json();
        setOptions(data);
      } catch (error) {
        console.error("Error fetching updated options:", error);
      }
      setLoading(false);
    };

    fetchUpdatedOptions();
  }, [formData]); // Update options when formData changes


  console.log(initial)
  useEffect(() => {
    if (initial) {
      const initialFormData = Object.keys(initial).reduce((acc, key) => {
        acc[key] = initial[key];
        return acc;
      }, {});
      setFormData(initialFormData);
    }
  }, [initial]);


  return (
    <Card padding='sm'>
        {options && Object.entries(options).map(([key, item]: [string, any]) => (
            item.example ? (
              <TextInput key={key} label={item.label} description={item.description} placeholder={item.example} />
            ) : item.values ? (
              <Select
                key={key}
                description={item.description}
                label={item.label}
                placeholder={`Select ${key}`}
                value={formData[key]}
                disabled={item.values && item.values.length === 0}
                onChange={(value) => handleChange(key, value)}
                data={item.values || []}
                searchable
              />
            ) : null
        ))}
      <Group w='100%' align='center'>
        <Button type='submit' onClick={() => submitTarget({...formData, product: selected})}>Submit</Button>
      </Group>
    </Card>
  );
}

export default Configuration;
