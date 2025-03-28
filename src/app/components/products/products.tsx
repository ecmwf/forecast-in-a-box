"use client";

import React, { useEffect, useState } from "react";
import { LoadingOverlay, Grid, SimpleGrid, Container, Button, Divider } from "@mantine/core";

import Categories from "./categories";
import Configuration from "./configuration";
import Cart from "./cart";

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

    const addProduct = (conf: ProductSpecification) => {
        setSelectedProduct(null);
        console.log(sha256(JSON.stringify(conf)).toString());
        internal_setProducts((prev: any) => ({
            ...prev,
            [sha256(JSON.stringify(conf)).toString()]: conf,
        }));
        console.log(products);
      };

      const [categories, setCategories] = useState<CategoriesType>({});
      const [loading, setLoading] = useState(true);
  
    //   useEffect(() => {
    //       fetch(`/api/py/products/valid-categories/${model}`)
    //           .then((res) => res.json())
    //           .then((data) => {
    //               setCategories(data);
    //               setLoading(false);
    //           });
    //   }, []);

    useEffect(() => {
        const fetchUpdatedOptions = async () => {
        setLoading(true);
        console.log("Fetching categories for model: ", model);
        try {
            const response = await fetch(`/api/py/products/valid-categories/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(model),
            });
    
            const categories: CategoriesType = await response.json();
            setCategories(categories);
            
        } catch (error) {
            console.error("Error fetching categories:", error);
        }
        setLoading(false);
        };
    
        fetchUpdatedOptions();
    }, [model]); // Update options when formData changes

    return (
        <Container p='md' size='xl'>
            <LoadingOverlay visible={loading}/>
            <Grid align="flex-start" justify="space-around" w="100%">
                <Grid.Col span={4}><h2>Categories</h2><Categories categories={categories} setSelected={setSelectedProduct} /></Grid.Col>
                <Grid.Col span={4}><h2>Configuration</h2><Configuration selectedProduct={selected} selectedModel={model} submitTarget={addProduct} /></Grid.Col>
                <Grid.Col span={4}><h2>Selected ({Object.keys(internal_products).length})</h2><Cart products={internal_products} setProducts={internal_setProducts}/></Grid.Col>
            </Grid>
            <Divider p='md'/>
            <SimpleGrid cols={1}>
                <Button onClick={() => setProducts(internal_products)} disabled={!model}>Submit</Button>
            </SimpleGrid>
        </Container>

    );
}

export default ProductConfigurator;