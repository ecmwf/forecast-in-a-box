"use client";

import React, { useState } from "react";
import { Card, Stepper } from "@mantine/core";

import ProductConfiguration from './components/products/products'
import Model from "./components/model/model";

import { IconWorldCog, IconCircleCheck, IconShoppingCartCode, IconRocket } from '@tabler/icons-react';

const Packages = () => {    
    const [active, setActive] = useState(0);
    const nextStep = () => setActive((current) => (current < 3 ? current + 1 : current));
    const prevStep = () => setActive((current) => (current > 0 ? current - 1 : current));

    const [selectedModel, setSelectedModel] = useState<string | null>(null);
    const [coords, setCoordinates] = useState<{ lat: number; lon: number } | null>(null);
    

    const setSubmittedModel = () => {
        console.log("Submitted model: ", selectedModel);
        nextStep();
    }
    const [products, setProducts] = useState({
        1: { product: "Apple", price: 1.5, quantity: 2 },
        2: { product: "Banana", price: 1.0, quantity: 3 },
      });

    return(
      <Card>
        <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false} completedIcon={<IconCircleCheck size={18} />}>
            <Stepper.Step label="Model" description="Configure the Model" allowStepSelect={true} icon={<IconWorldCog/>}>
                <Model selectedModel={selectedModel} setSelectedModel={setSelectedModel} coordinates={coords} setCoordinates={setCoordinates} submit={setSubmittedModel}/>
            </Stepper.Step>
            <Stepper.Step label="Products" description="Choose Products" allowStepSelect={true} icon={<IconShoppingCartCode/>}>
                <ProductConfiguration selectedModel={selectedModel} products={products} setProducts={setProducts}/>
            </Stepper.Step>
            <Stepper.Step label="Confirm" description="Execute the graph" allowStepSelect={true} icon={<IconRocket/>}>
                Step 3 content: Get full access
            </Stepper.Step>
        </Stepper>
    </Card>
    )
}

export default Packages;