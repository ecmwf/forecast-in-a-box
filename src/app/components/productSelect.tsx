"use client";

import React, { useState } from "react";
import { Group, Grid} from "@mantine/core";


import Categories from "./categories";
import Configuration from "./configuration";
import Cart from "./cart";


const Packages = () => {
    const [selected, setSelected] = useState<string | null>(null);

    const [products, setProducts] = useState({
        1: { product: "Apple", price: 1.5, quantity: 2 },
        2: { product: "Banana", price: 1.0, quantity: 3 },
      });
        
    const addProduct = (specification) => {
        console.log(specification);
        setSelected(null);
        setProducts((prev) => ({
          ...prev,
          [btoa(JSON.stringify(specification))]: specification,
        }));
        console.log(products);
      };

      
    return(
        <Grid align="top">
            <Grid.Col span={4}><h2>Categories</h2><Categories apiPath="/api/products/categories" setSelected={setSelected} /></Grid.Col>
            <Grid.Col span={4}><h2>Configuration</h2><Configuration apiPath="/api/products/configuration" selected={selected} submitTarget={addProduct} /></Grid.Col>
            <Grid.Col span={4}><h2>Selected</h2><Cart products={products} setProducts={setProducts}/></Grid.Col>
        </Grid>
    )
}

export default Packages;