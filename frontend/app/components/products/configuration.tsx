"use client";

import { useState, useEffect } from 'react';

import { Card, TextInput, Select, Button, LoadingOverlay, MultiSelect, Group, Text} from '@mantine/core';

import {
  showNotification, // notifications.show
} from '@mantine/notifications';

import {IconX} from '@tabler/icons-react'

import classes from './configuration.module.css';

import {ProductSpecification, ProductConfiguration, ConfigEntry, ModelSpecification} from '../interface'

interface ConfigurationProps {
  selectedProduct: string | null;
  selectedModel: ModelSpecification ;
  submitTarget: (conf: ProductSpecification) => void;
}

function write_description({ description, constraints }: { description: string; constraints: string[] }) {
  if (!constraints.length) return <>{description}</>;
  const constraintText = <span style={{ color: 'red' }}>Constraints: {constraints.join(", ")}</span>;
  return description ? <>{description} - {constraintText}</> : constraintText;
}

function Configuration({ selectedProduct, selectedModel, submitTarget}: ConfigurationProps) {

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [productConfig, updateProductConfig] = useState<ProductConfiguration>({ product: selectedProduct, options: {} });
  const [loading, setLoading] = useState(true);

  // Handle select field changes
  const handleChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };
  

  // Fetch initial options
  const fetchInitialOptions = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/py/products/configuration/${selectedProduct}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 'model': selectedModel, 'spec': {} }), // Empty request for initial load
      });

      const productSpec: ProductConfiguration = await response.json();

      // Extract keys from API response to set formData and options dynamically
      const initialFormData: Record<string, string> = Object.keys(productSpec.options).reduce((acc: Record<string, string>, key: string) => {
        acc[key] = ""; // Initialize all fields with empty values
        return acc;
      }, {});

      setFormData(initialFormData);
      updateProductConfig(productSpec);
    } catch (error) {
      console.error("Error fetching options:", error);
    }
    setLoading(false);
  };
  // Fetch initial options on component mount
  useEffect(() => {
    fetchInitialOptions();
  }, [selectedProduct]); // Run only on component mount


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

        const productSpec: ProductConfiguration = await response.json();
        updateProductConfig(productSpec);
        
      } catch (error) {
        console.error("Error fetching updated options:", error);
      }
      setLoading(false);
    };

    fetchUpdatedOptions();
  }, [formData]); // Update options when formData changes

  if (!selectedProduct) {
    return (
      <Card>
        <p>Select Product to configure</p>
      </Card>
    );
  }

  
  const isFormValid = () => {
    // console.log(formData);
    const isValid = Object.keys(productConfig.options).every(key => formData[key] !== undefined && formData[key] !== "");
    if (!isValid) {
      showNotification({
        id: 'invalid-form',
        position: 'bottom-center',
        withCloseButton: true,
        autoClose: 5000,
        title: "Fill in all fields",
        message: 'Please fill in all fields before submitting',
        color: 'red',
        icon: <IconX />,
        className: 'my-notification-class',
        // style: { backgroundColor: 'red' },
        loading: false,
      });
    }
    return isValid;
  };

  const handleSubmit = () => {
    if (isFormValid()) {
      const filteredFormData = Object.keys(formData)
        .filter(key => key in productConfig.options)
        .reduce((acc: Record<string, any>, key) => {
          acc[key] = formData[key];
          return acc;
        }, {});
        
      submitTarget({ product: selectedProduct, specification: filteredFormData });
    }
  };

  return (
    <Card padding='sm'>
      <LoadingOverlay visible={loading} />
        {productConfig && productConfig.product && <Text pb='md'>{productConfig.product}</Text>}
        {productConfig && Object.entries(productConfig.options).map(([key, item]: [string, ConfigEntry]) => (
              item.values ? (
                item.multiple ? (
                  <MultiSelect
                    key={`${selectedProduct}_${key}`}
                    description={write_description({ description: item.description, constraints: item.constrained_by })}
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
                description={write_description({ description: item.description, constraints: item.constrained_by })}
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
        <Button type='button' onClick={() => { setFormData({}); updateProductConfig({ product: selectedProduct, options: {} }); fetchInitialOptions(); }}>Clear</Button>
      </Group>
    </Card>
  );
}

export default Configuration;
