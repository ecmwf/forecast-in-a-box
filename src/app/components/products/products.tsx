"use client";

import React, { useEffect, useState } from "react";
import { LoadingOverlay, Grid, Affix, Card, Stepper, Button } from "@mantine/core";

import Categories from "./categories";
import Configuration from "./configuration";
import Cart from "./cart";

import {CategoriesInterface} from './interface'


interface ProductConfigurationProps {
    selectedModel: string;
    products: string;
    setProducts: (Any: any) => void;
}


const ProductConfiguration: React.FC<ProductConfigurationProps> = ({selectedModel, products, setProducts}) => {
    const [selected, setSelectedProduct] = useState<string | null>(null);
    const [internal_products, internal_setProducts] = useState(products);

    const addProduct = (specification: any) => {
        console.log(specification);
        setSelectedProduct(null);
        internal_setProducts((prev: any) => ({
          ...prev,
          [btoa(JSON.stringify(specification))]: specification,
        }));
        console.log(products);
      };

      const [categories, setCategories] = useState<CategoriesInterface>({});
      const [loading, setLoading] = useState(true);
  
      useEffect(() => {
          fetch(`/api/py/products/valid-categories/${selectedModel}`)
              .then((res) => res.json())
              .then((data) => {
                  setCategories(data);
                  setLoading(false);
              });
      }, []);

    return (
        <Card padding='md'>
            <LoadingOverlay visible={loading}/>

            <Grid align="flex-start" justify="space-around" w="100%">
                <Grid.Col span={4}><h2>Categories</h2><Categories categories={categories} setSelected={setSelectedProduct} /></Grid.Col>
                <Grid.Col span={4}><h2>Configuration</h2><Configuration selectedProduct={selected} selectedModel={selectedModel} submitTarget={addProduct} /></Grid.Col>
                <Grid.Col span={4}><h2>Selected</h2><Cart products={internal_products} setProducts={internal_setProducts}/></Grid.Col>
            </Grid>
            <Button onClick={() => setProducts(internal_products)} disabled={!selectedModel}>Submit</Button>
        </Card>

    );
}

export default ProductConfiguration;