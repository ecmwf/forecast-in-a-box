
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import React, { useEffect, useState } from "react";
import { LoadingOverlay, Group, SimpleGrid, Container, Button, Divider, Title, Grid } from "@mantine/core";

import Categories from "./categories";
import Configuration from "./configuration";
import Cart from "./cart";
import {useApi} from '../../api';

import {CategoriesType, ProductSpecification, ModelSpecification} from '../interface'
import sha256 from 'crypto-js/sha256';


interface ProductConfigurationProps {
    model: ModelSpecification;
    products: Record<string, ProductSpecification>;
    setProducts: (products: Record<string, ProductSpecification>) => void;
}

function ProductConfigurator({model, products, setProducts}: ProductConfigurationProps) {
    const [selected, setSelectedProduct] = useState<string | null>(null);
    const [internal_products, internal_setProducts] = useState(products);

    const api = useApi();

    const addProduct = (conf: ProductSpecification) => {
        setSelectedProduct(null);
        internal_setProducts((prev: any) => ({
            ...prev,
            [sha256(JSON.stringify(conf)).toString()]: conf,
        }));
      };

      const [categories, setCategories] = useState<CategoriesType>({});
      const [loading, setLoading] = useState(true);
  
    useEffect(() => {
        const fetchUpdatedOptions = async () => {
        setLoading(true);
        try {
            const response = await api.post(`/v1/product/valid-categories/`, model);    
            const categories: CategoriesType = await response.data;
            setCategories(categories);
            
        } catch (error) {
            console.error("Error fetching categories:", error);
        }
        setLoading(false);
        };
    
        fetchUpdatedOptions();
    }, [model]); // Update options when formData changes

    useEffect(() => {
        if (selected) {
            const configurationContainer = document.querySelector(".configuration_container") as HTMLElement;
            // configurationContainer?.scrollIntoView();
        }
    }, [selected]);

    return (
        <Container size='xl'>
            <LoadingOverlay visible={loading}/>
            <Grid >
                <Grid.Col span={{ base: 12, sm: 12, md: 6, xl: 4 }}>
                    <Title order={2}>Categories</Title>
                    <Categories categories={categories} setSelected={setSelectedProduct} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 12, md: 6, xl: 4 }}>
                    <Container className='configuration_container'>
                        <Title order={2}>Configuration</Title>
                        <Configuration selectedProduct={selected} selectedModel={model} submitTarget={addProduct} />
                    </Container>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 12, md: 12, xl: 4 }} >
                    <Title order={2}>Selected ({Object.keys(internal_products).length})</Title>
                    <Cart products={internal_products} setProducts={internal_setProducts} />
                </Grid.Col>
            </Grid>
            <Divider p='md'/>
            <SimpleGrid cols={1}>
                <Button onClick={() => setProducts(internal_products)} disabled={!model}>Submit</Button>
            </SimpleGrid>
        </Container>
    );
}

export default ProductConfigurator;