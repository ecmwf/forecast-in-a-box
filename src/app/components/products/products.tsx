"use client";

import React, { useEffect, useState } from "react";
import { LoadingOverlay, Grid, SimpleGrid, Container, Button, Divider } from "@mantine/core";

import Categories from "./categories";
import Configuration from "./configuration";
import Cart from "./cart";

import {CategoriesType, ProductSpecification} from '../interface'
import sha256 from 'crypto-js/sha256';


interface ProductConfigurationProps {
    model: string;
    products: Record<string, ProductSpecification>;
    setProducts: (products: Record<string, ProductSpecification>) => void;
    back: () => void;
}

function ProductConfigurator({model, products, setProducts, back}: ProductConfigurationProps) {
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
  
      useEffect(() => {
          fetch(`/api/py/products/valid-categories/${model}`)
              .then((res) => res.json())
              .then((data) => {
                  setCategories(data);
                  setLoading(false);
              });
      }, []);

    return (
        <Container p='md' size='xl'>
            <LoadingOverlay visible={loading}/>
            <Grid align="flex-start" justify="space-around" w="100%">
                <Grid.Col span={4}><h2>Categories</h2><Categories categories={categories} setSelected={setSelectedProduct} /></Grid.Col>
                <Grid.Col span={4}><h2>Configuration</h2><Configuration selectedProduct={selected} selectedModel={model} submitTarget={addProduct} /></Grid.Col>
                <Grid.Col span={4}><h2>Selected ({Object.keys(internal_products).length})</h2><Cart products={internal_products} setProducts={internal_setProducts}/></Grid.Col>
            </Grid>
            <Divider p='md'/>
            <SimpleGrid cols={2}>
                <Button onClick={back}>Back</Button>
                <Button onClick={() => setProducts(internal_products)} disabled={!model}>Submit</Button>
            </SimpleGrid>
        </Container>

    );
}

export default ProductConfigurator;