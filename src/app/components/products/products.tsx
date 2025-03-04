"use client";

import React, { useState } from "react";
import { Group, Grid, Affix, Card, Stepper, Button } from "@mantine/core";

import Categories from "./categories";
import Configuration from "./configuration";
import Cart from "./cart";

interface ProductConfigurationProps {
    selectedModel: string;
    products: string;
    setProducts: (Any: any) => void;
}

const ProductConfiguration: React.FC<ProductConfigurationProps> = ({selectedModel, products, setProducts}) => {
    const [selected, setSelectedProduct] = useState<string | null>(null);
        
    const addProduct = (specification: any) => {
        console.log(specification);
        setSelectedProduct(null);
        setProducts((prev: any) => ({
          ...prev,
          [btoa(JSON.stringify(specification))]: specification,
        }));
        console.log(products);
      };

    return (
        <>
        <Grid align="flex-start">
            <Grid.Col span={5}><h2>Categories</h2><Categories apiPath="/api/py/products/categories" setSelected={setSelectedProduct} /></Grid.Col>
            <Grid.Col span={4}><h2>Configuration</h2><Configuration apiPath="/api/py/products/configuration" selected={selected} submitTarget={addProduct} /></Grid.Col>
        </Grid>

        <Affix position={{ top: 190, right: 0 }}>
          <h2>Selected</h2>
          <Cart products={products} setProducts={setProducts}/>
        </Affix>
    </>
    );
}

export default ProductConfiguration;