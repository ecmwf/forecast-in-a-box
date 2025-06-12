
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.


import React, { useState, useEffect } from 'react';
import { Button, Card, Title, Group, Divider, SimpleGrid, Container, ScrollArea, Paper, Text, Grid, Space} from '@mantine/core';

import { IconX, IconPencil} from '@tabler/icons-react';

import {EnsembleProducts, ModelSpecification, ProductSpecification, EnvironmentSpecification, ExecutionSpecification, SubmitResponse} from './interface'

import InformationWindow from './model/information'
import GraphVisualiser from './graph_visualiser';

import Cart from './products/cart'
import {useApi} from './../api';
import { showNotification } from '@mantine/notifications';

import useKeyboardShortcuts from '../hooks/keyboardShortcuts';

interface ConfirmProps {
    model: ModelSpecification;
    products: Record<string, ProductSpecification>;
    environment: EnvironmentSpecification;
    setProducts: (products: Record<string, ProductSpecification>) => void;
    setSlider: (value: number) => void;
    setJobId: (value: SubmitResponse) => void;
}

function Confirm({ model, products, environment, setProducts, setSlider, setJobId}: ConfirmProps) {
    const api = useApi();
    
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(false);

    const [status, setStatus] = useState<{
            cascade: "loading" | "up" | "down";
        }>({ cascade: "loading"});
    
        const checkStatus = async () => {
            setStatus({ cascade: "loading"});
            try {
                const response = await api.get("/v1/status");
                if (response.status == 200) {
                    const data = await response.data;
                    setStatus({
                        cascade: data.cascade || "down",
                    });
                } else {
                    setStatus({cascade: "down" });
                }
            } catch (error) {
                setStatus({ cascade: "down" });
            }
        };
    
        useEffect(() => {
            checkStatus();
        }, []);

    const handleSubmit = () => {
        const ensembleProducts: EnsembleProducts = {
            job_type: "ensemble_products",
            model: model,
            products: Object.values(products)
        }
        const spec: ExecutionSpecification = {
            job: ensembleProducts,
            environment: environment
        }
        setSubmitting(true);

        const execute = async () => {
            (async () => {
                try {
                    const response = await api.post(`/v1/graph/execute`, spec);
                    const result: SubmitResponse = await response.data;
                    if (result.error) {
                        alert("Error: " + result.error);
                        showNotification(
                            {
                                title: 'Error',
                                message: `An error occurred while submitting the graph.\n ${result.error}`,
                                color: 'red',
                                icon: <IconX size={16} />,
                            }
                        )
                    }
                    setJobId(result);
                    window.location.href = `/job/${result.id}`;

                } catch (error) {
                    console.error("Error executing:", error);
                    showNotification(
                        {
                            title: 'Error',
                            message: `An error occurred while submitting the graph.\n ${error.response.data.detail}`,
                            color: 'red',
                            icon: <IconX size={16} />,
                        }
                    )
                } finally {
                    setSubmitting(false);
                }
            })();
        };
        execute();       
    }

    useKeyboardShortcuts({
        Enter: () => {
            if (status.cascade === "up") {
                handleSubmit();
            } else {
                showNotification({
                    title: 'Server Down',
                    message: 'Cannot submit while server is down.',
                    color: 'red',
                    icon: <IconX size={16} />,
                });
            }
        }
    })

    const handleDownload = () => {
        const submitData: ExecutionSpecification = {
            model: model,
            products: Object.values(products),
            environment: {} as EnvironmentSpecification
        };

        const blob = new Blob([JSON.stringify(submitData, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', `${crypto.randomUUID()}.json`);
        link.click();
        link.remove();
    }

    const handleSeralise = () => {
        setLoading(true);
        const spec: ExecutionSpecification = {
            model: model,
            products: Object.values(products),
            environment: {} as EnvironmentSpecification
        }

        async function retrieveFileBlob() {
            try {
                const ftch = await api.post(`/v1/graph/serialise`,spec)
                const fileBlob = await ftch.data;
                
                // this works and prompts for download
                var link = document.createElement('a')  // once we have the file buffer BLOB from the post request we simply need to send a GET request to retrieve the file data
                const blob = new Blob([JSON.stringify(fileBlob, null, 2)], { type: 'application/json' });
                link.href = URL.createObjectURL(blob);
                link.setAttribute('download', `${crypto.randomUUID()}.json`);
                link.click()
                link.remove();  //afterwards we remove the element  
            } catch (error) {
                console.error({ "message": error, status: 400 })  // handle error
                showNotification(
                        {
                            title: 'Error',
                            message: `An error occurred while serialising the graph.\n ${error.response.data.detail}`,
                            color: 'red',
                            icon: <IconX size={16} />,
                        }
                    )
            }
        };
        retrieveFileBlob();
        setLoading(false);
    }
    // <SimpleGrid cols={{ base: 1, sm: 3, lg: 3 }} spacing='' >
    {/* <Container miw={{base:'90vw', sm:'25vw'}}><Title order={2}>Categories</Title><Categories categories={categories} setSelected={setSelectedProduct} /></Container>
    <Container miw={{base:'90vw', sm:'25vw'}}><Title order={2}>Configuration</Title><Configuration selectedProduct={selected} selectedModel={model} submitTarget={addProduct} /></Container>
    <Container miw={{base:'90vw', sm:'25vw'}}><Title order={2}>Selected ({Object.keys(internal_products).length})</Title><Cart products={internal_products} setProducts={internal_setProducts}/></Container> */}
    // </SimpleGrid>
    return (
        <Container size='xl'>
        {/* <Title order={2}>Confirm</Title>
        <Divider my='md'/> */}
        <Grid grow gutter='xl'>
            <Grid.Col span={{ base: 12, sm: 12, md: 6, xl: 6 }}>
                <Card padding="">
                    <Title pb ='md' order={2}>Model</Title>
                    <Button onClick={() => setSlider(0)}>Change</Button>
                    <Title pt ='md' order={3}>Specification</Title>
                    <SimpleGrid cols={{ base: 1, sm: 2, lg: 2 }} spacing=''>
                        {Object.entries(model).filter(([key]) => key !== 'model').map(([key, value]) => ( 
                            <Paper shadow="" p="xs" key={key}>
                                <Title order={5}>{key}</Title>
                                <Text maw='80%' lineClamp={3} style={{ marginLeft: '10px' }}>{JSON.stringify(value, null, 2)}</Text>
                            </Paper>
                            ))}
                    </SimpleGrid>
                    <Divider p='md'/>
                    <Title pb ='md' order={3}>Model Information</Title>
                    <Card.Section>
                    <ScrollArea h='35vh' type="always">
                        <InformationWindow selected={model.model} />
                    </ScrollArea>
                    </Card.Section>
                </Card>
                </Grid.Col>
                
                <Grid.Col span={{ base: 12, sm: 12, md: 6, xl: 6 }}>
                <Card padding="">
                    <Title pb ='md' order={2}>Products ({Object.keys(products).length})</Title>
                    <Button onClick={() => setSlider(1)}>Add more</Button>
                    <Divider p='md'/>
                </Card>
                <Cart products={products} setProducts={setProducts} />
                </Grid.Col>
            </Grid>
            <Space p='xl'/>
            <Group grow justify='center' preventGrowOverflow={true}>
                <GraphVisualiser 
                    spec={{
                        model: model,
                        products: Object.values(products),
                        environment: {} as EnvironmentSpecification
                    }}
                    url={null}
                />
                <Group grow>
                <Button disabled={loading} onClick={handleSeralise}>Serialise</Button>
                <Button onClick={() => {
                    handleDownload();
                }}>Download JSON</Button>
                </Group>
                <Button color='green'onClick={handleSubmit} disabled={submitting || status.cascade !== "up"}>
                    {submitting ? "Submitting..." : 
                    (status.cascade !== "up" ? <Text c='red'> (Server is down)</Text> : 'Submit')}
                </Button>
            </Group>
        </Container>
    );
}

export default Confirm;
