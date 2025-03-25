"use client";

import React, { useState } from "react";
import { Card, Stepper, Divider, Button, Alert } from "@mantine/core";

import ProductConfigurator from './components/products/products'
import Model from "./components/model/model";

import Confirm from './components/products/confirm'

import { IconWorldCog, IconCircleCheck, IconShoppingCartCode, IconRocket, IconTerminal2 } from '@tabler/icons-react';

const Packages = () => {    
    const [active, setActive] = useState(0);
    const nextStep = () => setActive((current) => (current < 3 ? current + 1 : current));
    const prevStep = () => setActive((current) => (current > 0 ? current - 1 : current));

    const [selectedModel, setSelectedModel] = useState<string>("");
    const [coords, setCoordinates] = useState<{ lat: number; lon: number } | null>(null);
    

    const setSubmittedModel = () => {
        console.log("Submitted model: ", selectedModel);
        nextStep();
    }

    const [products, setProducts] = useState({
      });

    const setSubmittedProducts = (prod) => {
        console.log("Submitted products: ", prod);
        setProducts(prod);
        nextStep();
    }
    return(
      <Card>
        <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false} completedIcon={<IconCircleCheck size={18} />}>
            <Stepper.Step label="Model" description="Configure the Model" allowStepSelect={true} icon={<IconWorldCog/>}>
                <Divider my="md" />
                <Model selectedModel={selectedModel} setSelectedModel={setSelectedModel} coordinates={coords} setCoordinates={setCoordinates} submit={setSubmittedModel}/>
            </Stepper.Step>
            <Stepper.Step label="Products" description="Choose Products" allowStepSelect={true} icon={<IconShoppingCartCode/>}>
                <Divider my="md" />
                {selectedModel ? (
                    <ProductConfigurator model={selectedModel} products={products} setProducts={setSubmittedProducts}/>
                ) : (
                    <>
                        <Alert>Select a model first</Alert>
                        <Button onClick={() => setActive(0)}>Back</Button>
                    </>
                )}
            </Stepper.Step>
            <Stepper.Step label="Environment" description="Configure Execution Environment" allowStepSelect={true} icon={<IconTerminal2/>}>
                <Divider my="md" />
                <Button onClick={prevStep}>Back</Button>
                <Button onClick={nextStep}>Next</Button>
            </Stepper.Step>
            <Stepper.Step label="Confirm" description="Execute the graph" allowStepSelect={true} icon={<IconRocket/>}>
                <Divider my="md" />
                {products && selectedModel ? (
                    <Confirm model={selectedModel} products={products}/>
                ) : (
                    <>
                        <Alert>Select products first</Alert>
                        <Button onClick={() => setActive(1)}>Back</Button>
                    </>
                )}
                
            </Stepper.Step>
        </Stepper>
    </Card>
    )
}

export default Packages;