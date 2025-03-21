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

    return (
        <Card padding='md'>
            <Grid align="flex-start" justify="space-around" w="100%">
                <Grid.Col span={4}><h2>Categories</h2><Categories apiPath="/api/py/products/categories" setSelected={setSelectedProduct} /></Grid.Col>
                <Grid.Col span={4}><h2>Configuration</h2><Configuration apiPath="/api/py/products/configuration" selectedProduct={selected} selectedModel={selectedModel} submitTarget={addProduct} /></Grid.Col>
                <Grid.Col span={4}><h2>Selected</h2><Cart products={internal_products} setProducts={internal_setProducts}/></Grid.Col>
            </Grid>
            <Button onClick={() => setProducts(internal_products)} disabled={!selectedModel}>Submit</Button>
        </Card>

    );
}

export default ProductConfiguration;