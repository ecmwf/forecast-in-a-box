"use client";

import { Tabs, Card, TextInput, Select, Button, LoadingOverlay, MultiSelect, Group} from '@mantine/core';
import { useState, useEffect } from 'react';

import classes from './configuration.module.css';

interface ConfigurationProps {
  selectedProduct: string | null;
  selectedModel: string ;
  submitTarget?;
  initial?: Record<string, any>;
}
interface ConfigRecord{
  label: string; description: string; example?: string; values?: string[], multiple: boolean
}

function Configuration({ selectedProduct, selectedModel, submitTarget, initial}: ConfigurationProps) {
  if (!selectedProduct) {
    return (
      <Card>
        <p>Select Product to configure</p>
      </Card>
    );
  }

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [options, setOptions] = useState<Record<string, ConfigRecord>>({});
  const [loading, setLoading] = useState(true);

  // Handle select field changes
  const handleChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };
  useEffect(() => {
    fetchInitialOptions();
  }, [selectedProduct]); // Run only on component mount

  const fetchInitialOptions = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/py/products/configuration/${selectedProduct}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 'model': selectedModel, 'spec': {} }), // Empty request for initial load
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

  useEffect(() => {
    if (Object.keys(formData).length === 0) return; // Prevent unnecessary fetch

    const fetchUpdatedOptions = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/py/products/configuration/${selectedProduct}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 'model': selectedModel, 'spec': formData }),
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


  useEffect(() => {
    if (initial) {
      const initialFormData = Object.keys(initial).reduce((acc, key) => {
        acc[key] = initial[key];
        return acc;
      }, {});
      setFormData(initialFormData);
    }
  }, [initial]);


  const isFormValid = () => {
    // console.log(formData);
    const isValid = Object.keys(options).every(key => formData[key] !== undefined && formData[key] !== "");
    if (!isValid) {
      alert("Please fill out all required fields.");
    }
    return isValid;
  };

  const handleSubmit = () => {
    if (isFormValid()) {
      const filteredFormData = Object.keys(formData)
        .filter(key => key in options)
        .reduce((acc, key) => {
          acc[key] = formData[key];
          return acc;
        }, {});
      submitTarget({ ...filteredFormData, product: selectedProduct });
    }
  };
  console.log(options);
  return (
    <Card padding='sm'>
      <LoadingOverlay visible={loading} />
        {options && Object.entries(options).map(([key, item]: [string, ConfigRecord]) => (
              item.values ? (
                item.multiple ? (
                  <MultiSelect
                    key={`${selectedProduct}_${key}`}
                    description={item.description}
                    label={item.label}
                    placeholder={`${key}`}
                    // value={formData[key]}
                    disabled={item.values && item.values.length === 0}
                    onChange={(value) => handleChange(key, value)}
                    data={item.values || []}
                    searchable
                  />
                ) : (
              <Select
                key={`${selectedProduct}_${key}`}
                description={item.description}
                label={item.label}
                placeholder={`Select ${key}`}
                // value={formData[key]}
                disabled={item.values && item.values.length === 0}
                onChange={(value) => handleChange(key, value)}
                data={item.values || []}
                searchable
              />
            )) : item.example ? (
              <TextInput 
                key={`${selectedProduct}_${key}`}
                label={item.label} 
                description={item.description} 
                placeholder={item.example} 
                // value={formData[key] || ""}
                onChange={(event) => handleChange(key, event.currentTarget.value)}
              />
            ) : null
        ))}
      <Group w='100%' align='center' mt='lg'>
        <Button type='submit' onClick={handleSubmit} disabled={!isFormValid}>Submit</Button>
        <Button type='button' onClick={() => { setFormData({}); setOptions({}); fetchInitialOptions(); }}>Clear</Button>
      </Group>
    </Card>
  );
}

export default Configuration;
