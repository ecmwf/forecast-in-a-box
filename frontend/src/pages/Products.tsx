
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import React, { useState } from "react";
import { SimpleGrid, Stepper, Divider, Button, Alert, Container} from "@mantine/core";

import ProductConfigurator from '../components/products/products'
import Model from "../components/model/model";
import Environment from "../components/environment";

import Confirm from '../components/confirm';
import LoggedIn from '../layouts/LoggedIn';

import {ModelSpecification, ProductSpecification, EnvironmentSpecification, SubmitResponse} from '../components/interface'

import { IconWorldCog, IconCircleCheck, IconShoppingCartCode, IconRocket, IconTerminal2, IconLogs, IconMap } from '@tabler/icons-react';

const ProductsPage = () => {    
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
    const [environment, setEnvironment] = useState({} as EnvironmentSpecification);
    const [jobId, setJobId] = useState<SubmitResponse>({} as SubmitResponse);

    const setSubmittedProducts = (prod: Record<string, ProductSpecification>) => {
        setProducts(prod);
        nextStep();
    }

    const setEnvironmentInfo = (env: EnvironmentSpecification) => {
        setEnvironment(env);
        nextStep();
    }

    return(
    <LoggedIn>
      <Container size='xl' pt='xl'>
        <Stepper active={active} onStepClick={setActive} allowNextStepsSelect={false} completedIcon={<IconCircleCheck size={18} />}>
            <Stepper.Step label="Model" description="Configure the Model" allowStepSelect={true} icon={<IconWorldCog/>}>
                <Divider my="md" />
                <Model selectedModel={selectedModel} coordinates={coords} setCoordinates={setCoordinates} modelSpec={selectedModel} submit={setSubmittedModel}/>
            </Stepper.Step>
            <Stepper.Step label="Products" description="Choose Products" allowStepSelect={!!selectedModel.model} icon={<IconShoppingCartCode/>}>
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
            <Stepper.Step label="Environment" description="Configure Execution" allowStepSelect={true} icon={<IconTerminal2/>}>
                <Environment setEnvironment={setEnvironmentInfo}/>
            </Stepper.Step>
            <Stepper.Step label="Confirm" description="Execute the graph" allowStepSelect={!!selectedModel.model} icon={<IconRocket/>}>
                <Divider my="md" />
                {products && selectedModel ? (
                    <Confirm model={selectedModel} products={products} environment={environment} setProducts={setProducts} setSlider={setActive} setJobId={setJobId}/>
                ) : (
                    <>
                        <Alert>Select products first</Alert>
                        <Button onClick={() => setActive(1)}>Back</Button>
                    </>
                )}
            </Stepper.Step>
        </Stepper>
        <Divider p='sm'/>
    </Container>
    </LoggedIn>
    )
}

export default ProductsPage;