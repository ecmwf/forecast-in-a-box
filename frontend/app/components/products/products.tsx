"use client";

import React, { useEffect, useState } from "react";
import { LoadingOverlay, Group, SimpleGrid, Container, Button, Divider, Title } from "@mantine/core";

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

    useEffect(() => {
        if (selected) {
            const configurationContainer = document.querySelector(".configuration_container") as HTMLElement;
            configurationContainer?.scrollIntoView();
        }
    }, [selected]);

    return (
        <Container size='xl'>
            <LoadingOverlay visible={loading}/>
            <SimpleGrid cols={{ sm: 1, md: 2, xl: 3}} spacing='' >
                <Container miw={{sm:'90vw', md:'45vw', xl:'15vw'}}><Title order={2}>Categories</Title><Categories categories={categories} setSelected={setSelectedProduct} /></Container>
                <Container className='configuration_container' miw={{sm:'90vw', md:'45vw', xl:'15vw'}}><Title order={2}>Configuration</Title><Configuration selectedProduct={selected} selectedModel={model} submitTarget={addProduct} /></Container>
                <Container miw={{sm:'90vw', xl:'15vw'}}><Title order={2}>Selected ({Object.keys(internal_products).length})</Title><Cart products={internal_products} setProducts={internal_setProducts}/></Container>
            </SimpleGrid>
            <Divider p='md'/>
            <SimpleGrid cols={1}>
                <Button onClick={() => setProducts(internal_products)} disabled={!model}>Submit</Button>
            </SimpleGrid>
        </Container>

    );
}

export default ProductConfigurator;