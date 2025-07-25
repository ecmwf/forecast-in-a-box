
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { useState, useEffect } from 'react';

import { Card, TextInput, Select, Button, LoadingOverlay, MultiSelect, Group, Text, Collapse, Box, Space, Loader} from '@mantine/core';
import {useApi} from '../../api';

import { withTheme } from '@rjsf/core';
import { Theme } from '@rjsf/mui';

const Form = withTheme(Theme);

import validator from '@rjsf/validator-ajv8';

import {ProductSpecification, ProductConfiguration, ModelSpecification} from '../interface'

interface ConfigurationProps {
  selectedProduct: string | null;
  selectedModel: ModelSpecification ;
  submitTarget: (conf: ProductSpecification) => void;
}

function Configuration({ selectedProduct, selectedModel, submitTarget}: ConfigurationProps) {

  const [formData, setFormData] = useState(null);

  const [productConfig, updateProductConfig] = useState<ProductConfiguration>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const api = useApi();


  // Fetch initial options
  const fetchInitialOptions = async () => {
    if (!selectedProduct) return; // Prevent unnecessary fetch
    setLoading(true);
    try {
      const response = await api.post(`/v1/product/configuration/${selectedProduct}`, { 'model': selectedModel, 'spec': {} }); // Empty request for initial load

      const productSpec: ProductConfiguration = await response.data;
      updateProductConfig(productSpec);
    } catch (error) {
      console.error("Error fetching options:", error);
    }
    setLoading(false);
  };


  const fetchUpdatedOptions = async (data: any) => {
    setUpdating(true);
    try {
      const response = await api.post(`/v1/product/configuration/${selectedProduct}`, { 'model': selectedModel, 'spec': data });
      const productSpec: ProductConfiguration = await response.data;
      updateProductConfig(productSpec);

    } catch (error) {
      console.error("Error fetching updated options:", error);
    }
    setUpdating(false);
  };


  // Fetch initial options on component mount
  useEffect(() => {
    setFormData({});
    fetchInitialOptions();
  }, [selectedProduct]); // Run only on component mount


  if (!selectedProduct) {
    return (
      <Card>
        <p>Select Product to configure</p>
      </Card>
    );
  }

  const onSubmit = async (data: any) => {
    console.log("Submitting configuration:", data);
    const conf: ProductSpecification = {
      product: selectedProduct,
      specification: data,
    };
    submitTarget(conf);
    setFormData({});
  }

  return (
    <Card padding='sm'>
      <LoadingOverlay visible={loading} />
        {productConfig && productConfig.jsonSchema ? (
          <>
          <Space h='md' />
          <Card.Section>
            <Form
              schema={productConfig.jsonSchema}
              uiSchema={productConfig.uiSchema}
              validator={validator}
              formData={formData}
              onChange={(e) => { setFormData(e.formData); fetchUpdatedOptions(e.formData); }}
              onSubmit={(e) => { onSubmit(e.formData); }}
              showErrorList={"bottom"}
              omitExtraData={true}
            />
          </Card.Section>
          <Button type='button' onClick={() => { setFormData({}); fetchInitialOptions(); }}>Clear</Button>
          <Card.Section>
            <Group p='apart' mb='md'>
              <Text size='xs' c='dimmed'>{updating ? 'Updating': null}</Text> {updating ? <Loader size='xs'/> : null}
            </Group>
          </Card.Section>
          </>
          ) :
          <Text>Loading product configuration...</Text>
        }
    </Card>
  );
}

export default Configuration;
