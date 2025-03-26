"use client";

import React, { useState } from "react";
import { Card, Stepper, Divider, Button, Alert, Container} from "@mantine/core";

import ProductConfigurator from './components/products/products'
import Model from "./components/model/model";

import Confirm from './components/confirm'
import {ModelSpecification, ProductSpecification, EnvironmentSpecification} from './components/interface'

import { IconWorldCog, IconCircleCheck, IconShoppingCartCode, IconRocket, IconTerminal2 } from '@tabler/icons-react';

const Packages = () => {    
    const [active, setActive] = useState(0);
    const nextStep = () => setActive((current) => (current < 3 ? current + 1 : current));
    const prevStep = () => setActive((current) => (current > 0 ? current - 1 : current));

    const [selectedModel, setSelectedModel] = useState<ModelSpecification>({} as ModelSpecification);
    const [coords, setCoordinates] = useState<{ lat: number; lon: number } | null>(null);
    

    const setSubmittedModel = (val: ModelSpecification) => {
        setSelectedModel(val);
        nextStep();
    }

    const [products, setProducts] = useState({} as Record<string, ProductSpecification>);

    const setSubmittedProducts = (prod: Record<string, ProductSpecification>) => {
        console.log("Submitted products: ", prod);
        setProducts(prod);
        nextStep();
    }
    return(
      <Container size='xl' pt='md'>
        <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false} completedIcon={<IconCircleCheck size={18} />}>
            <Stepper.Step label="Model" description="Configure the Model" allowStepSelect={false} icon={<IconWorldCog/>}>
                <Divider my="md" />
                <Model selectedModel={selectedModel} coordinates={coords} setCoordinates={setCoordinates} submit={setSubmittedModel}/>
            </Stepper.Step>
            <Stepper.Step label="Products" description="Choose Products" allowStepSelect={false} icon={<IconShoppingCartCode/>}>
                <Divider my="md" />
                {selectedModel ? (
                    <ProductConfigurator model={selectedModel.model} products={products} setProducts={setSubmittedProducts} back={prevStep}/>
                ) : (
                    <>
                        <Alert>Select a model first</Alert>
                        <Button onClick={() => setActive(0)}>Back</Button>
                    </>
                )}
            </Stepper.Step>
            <Stepper.Step label="Environment" description="Configure Execution Environment" allowStepSelect={false} icon={<IconTerminal2/>}>
                <Divider my="md" />
                <Button onClick={prevStep}>Back</Button>
                <Button onClick={nextStep}>Next</Button>
            </Stepper.Step>
            <Stepper.Step label="Confirm" description="Execute the graph" allowStepSelect={false} icon={<IconRocket/>}>
                <Divider my="md" />
                {products && selectedModel ? (
                    <Confirm model={selectedModel} products={products} setProducts={setProducts} setSlider={setActive}/>
                ) : (
                    <>
                        <Alert>Select products first</Alert>
                        <Button onClick={() => setActive(1)}>Back</Button>
                    </>
                )}
            </Stepper.Step>
        </Stepper>
    </Container>
    )
}

export default Packages;