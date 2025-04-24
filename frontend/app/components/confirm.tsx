
import React, { useState, useEffect } from 'react';
import { Button, Card, Title, Group, Divider, SimpleGrid, Container, ScrollArea, Paper, Text, Grid, Space} from '@mantine/core';

import { IconX, IconPencil} from '@tabler/icons-react';

import {ModelSpecification, ProductSpecification, SubmitSpecification, SubmitResponse} from './interface'

import InformationWindow from './model/information'
import GraphVisualiser from './visualise';

import Cart from './products/cart'

interface ConfirmProps {
    model: ModelSpecification;
    products: Record<string, ProductSpecification>;
    setProducts: (products: Record<string, ProductSpecification>) => void;
    setSlider: (value: number) => void;
    setJobId: (value: SubmitResponse) => void;
}

function Confirm({ model, products, setProducts, setSlider, setJobId}: ConfirmProps) {
    
    const [submitting, setSubmitting] = useState(false);

    const [status, setStatus] = useState<{
            cascade: "loading" | "up" | "down";
        }>({ cascade: "loading"});
    
        const checkStatus = async () => {
            setStatus({ cascade: "loading"});
            try {
                const response = await fetch("/api/py/status");
                if (response.ok) {
                    const data = await response.json();
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
        const submitData: SubmitSpecification = {
            model: model,
            products: Object.values(products),
            environment: {}
        }
        setSubmitting(true);

        const execute = async () => {
            (async () => {
                try {
                    const response = await fetch(`/api/py/graph/execute`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(submitData),
                    });

                    const result: SubmitResponse = await response.json();
                    if (!response.ok) {
                        alert("Error: " + response.status + " " + response.statusText);
                        throw new Error(`Error: ${response.status} - ${response.statusText}`);
                    }
                    if (result.error) {
                        alert("Error: " + result.error);
                        throw new Error(`Error: ${result.error}`);
                    }
                    setJobId(result);
                    window.location.href = `/progress/${result.job_id}`;

                } catch (error) {
                    console.error("Error executing:", error);
                } finally {
                    setSubmitting(false);
                }
            })();
        };
        execute();       
    }

    const handleDownload = () => {
        const submitData: SubmitSpecification = {
            model: model,
            products: Object.values(products),
            environment: {}
        }

        async function retrieveFileBlob() {
            try {
                const ftch = await fetch( // this will request the file information for the download (whether an image, PDF, etc.)
                    `/api/py/execution/serialise`,
                    {
                        method: "POST",
                        headers: {
                            "Content-type": "application/json"
                        },
                        body: JSON.stringify(submitData)
                    },
                )
                if (!ftch.ok) {
                    alert("Error: " + ftch.status + " " + ftch.statusText);
                    throw new Error(`Could not download graph: ${ftch.status} - ${ftch.statusText}`);
                }
                const fileBlob = await ftch.json();
                
                // this works and prompts for download
                var link = document.createElement('a')  // once we have the file buffer BLOB from the post request we simply need to send a GET request to retrieve the file data
                const blob = new Blob([JSON.stringify(fileBlob, null, 2)], { type: 'application/json' });
                link.href = URL.createObjectURL(blob);
                link.setAttribute("download", 'products.json');
                link.click()
                link.remove();  //afterwards we remove the element  
            } catch (e) {
                console.log({ "message": e, status: 400 })  // handle error
            }
        };
        retrieveFileBlob();
    }
    // <SimpleGrid cols={{ base: 1, sm: 3, lg: 3 }} spacing='' >
    {/* <Container miw={{base:'90vw', sm:'25vw'}}><Title order={2}>Categories</Title><Categories categories={categories} setSelected={setSelectedProduct} /></Container>
    <Container miw={{base:'90vw', sm:'25vw'}}><Title order={2}>Configuration</Title><Configuration selectedProduct={selected} selectedModel={model} submitTarget={addProduct} /></Container>
    <Container miw={{base:'90vw', sm:'25vw'}}><Title order={2}>Selected ({Object.keys(internal_products).length})</Title><Cart products={internal_products} setProducts={internal_setProducts}/></Container> */}
    // </SimpleGrid>
    return (
        <Container size='xl'>
        <Title order={2}>Confirm</Title>
        <Divider my='md'/>
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
                        environment: {}
                    }}
                    url={null}
                />
                <Button onClick={handleDownload}>Download</Button>
                <Button color='green'onClick={handleSubmit} disabled={submitting || status.cascade !== "up"}>
                    {submitting ? "Submitting..." : 
                    (status.cascade !== "up" ? <Text c='red'> (Server is down)</Text> : 'Submit')}
                </Button>
            </Group>
        </Container>
    );
}

export default Confirm;
