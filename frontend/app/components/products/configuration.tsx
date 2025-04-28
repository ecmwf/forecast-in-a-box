"use client";

import { useState, useEffect } from 'react';

import { Card, TextInput, Select, Button, LoadingOverlay, MultiSelect, Group, Text, Collapse, Box, Space} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {useApi} from '@/app/api';

import {
  showNotification, // notifications.show
} from '@mantine/notifications';

import {IconX, IconSettings} from '@tabler/icons-react'

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

function ConfigInput({ selectedProduct, item, keyValue, handleChange }: { selectedProduct: string, item: ConfigEntry, keyValue: string, handleChange: (name: string, value: any) => void }) {
    return (
      item.values ? (
        item.multiple ? (
          <MultiSelect
            key={`${selectedProduct}_${keyValue}`}
            description={write_description({ description: item.description, constraints: item.constrained_by })}
            label={item.label}
            placeholder={item.default || `${keyValue}`}
            // value={formData[key]}
            disabled={item.values && item.values.length === 0}
            onChange={(value) => handleChange(keyValue, value)}
            data={item.values || []}
            searchable
          />
        ) : (
      <Select
        key={`${selectedProduct}_${keyValue}`}
        description={write_description({ description: item.description, constraints: item.constrained_by })}
        label={item.label}
        placeholder={item.default || `Select ${keyValue}`}
        // value={formData[key]}
        disabled={item.values && item.values.length === 0}
        onChange={(value) => handleChange(keyValue, value)}
        data={item.values || []}
        searchable
      />
    )) : (
      <TextInput 
        key={`${selectedProduct}_${keyValue}`}
        label={item.label} 
        description={item.description} 
        placeholder={item.example? item.example : item.default || `Enter ${keyValue}`} 
        // value={formData[key] || ""}
        onChange={(event) => handleChange(keyValue, event.currentTarget.value)}
      />
    )
  )
}

function Configuration({ selectedProduct, selectedModel, submitTarget}: ConfigurationProps) {

  const [formData, setFormData] = useState<Record<string, any>>({});
  const [productConfig, updateProductConfig] = useState<ProductConfiguration>({ product: selectedProduct, options: {} });
  const [loading, setLoading] = useState(true);
  const api = useApi();

  const [advancedOpened, { toggle }] = useDisclosure(false);

  // Handle select field changes
  const handleChange = (name: string, value: any) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };
  

  // Fetch initial options
  const fetchInitialOptions = async () => {
    if (!selectedProduct) return; // Prevent unnecessary fetch
    setLoading(true);
    try {
      const response = await api.post(`/products/configuration/${selectedProduct}`, { 'model': selectedModel, 'spec': {} }); // Empty request for initial load

      const productSpec: ProductConfiguration = await response.data;
      console.log(productSpec)

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
        const response = await api.post(`/products/configuration/${selectedProduct}`, { 'model': selectedModel, 'spec': formData });
        const productSpec: ProductConfiguration = await response.data;
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
    const isValid = Object.keys(productConfig.options).every(key => formData[key] !== undefined && formData[key] !== "" || productConfig.options[key].default);
    if (!isValid) {
      showNotification({
        id: 'invalid-form',
        position: 'top-right',
        autoClose: 3000,
        title: "Fill in all fields",
        message: 'Please fill in all fields before submitting',
        color: 'red',
        icon: <IconX />,
        loading: false,
      });
    }
    return isValid;
  };

  const handleSubmit = () => {
    if (isFormValid()) {
      const filteredFormData = Object.keys(formData)
        .filter(key => key in productConfig.options && formData[key] !== "")
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
          !item.default ? (
                <ConfigInput selectedProduct='{selectedProduct}' key = {key} keyValue={key} item={item} handleChange={handleChange} />
          ) : null
        ))}
        <Space h='md' />

        <Card.Section  >

        {productConfig && Object.entries(productConfig.options).some(([key, item]) => item.default) ? (
          <Button onClick={toggle} rightSection={<IconSettings/>}>Advanced Settings</Button>
        ) : null}

        <Collapse in={advancedOpened} bg='#f8f8f8' p='md' mt='md'>
            {productConfig && Object.entries(productConfig.options).map(([key, item]: [string, ConfigEntry]) => (
              item.default ? (
                  <ConfigInput selectedProduct='{selectedProduct}' key = {key} keyValue={key} item={item} handleChange={handleChange} />
              ) : null
            ))}
        </Collapse>
        </Card.Section>


      <Group w='100%' align='center' mt='lg'>
        <Button type='submit' onClick={handleSubmit} disabled={!isFormValid}>Submit</Button>
        <Button type='button' onClick={() => { setFormData({}); updateProductConfig({ product: selectedProduct, options: {} }); fetchInitialOptions(); }}>Clear</Button>
      </Group>
    </Card>
  );
}

export default Configuration;
