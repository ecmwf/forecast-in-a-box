
import React, { useState } from 'react';
import { Button, Card, Title, Group, Modal, Divider, SimpleGrid, Center, ScrollArea, Paper, Text} from '@mantine/core';

import { IconX, IconPencil} from '@tabler/icons-react';

import {ModelSpecification, ProductSpecification, SubmitSpecification, SubmitResponse} from './interface'

import InformationWindow from './model/information'
import Cart from './products/cart'

import GraphModal from './shared/graphModal'


interface ConfirmProps {
    model: ModelSpecification;
    products: Record<string, ProductSpecification>;
    setProducts: (products: Record<string, ProductSpecification>) => void;
    setSlider: (value: number) => void;
    setJobId: (value: SubmitResponse) => void;
}

function Confirm({ model, products, setProducts, setSlider, setJobId}: ConfirmProps) {
    
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = () => {
        const submitData: SubmitSpecification = {
            model: model,
            products: Object.values(products),
            environment: {}
        }
        console.log(submitData);
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
                    console.log(result);
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
        console.log(submitData);

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
                
                console.log(fileBlob);

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

    const [graphContent, setGraphContent] = useState<string>("");
    const [loading, setLoading] = useState(false);

    const getGraph = () => {
        const submitData: SubmitSpecification = {
            model: model,
            products: Object.values(products),
            environment: {}
        };
        console.log(submitData);

        const getGraphHtml = async () => {
            setLoading(true);
            (async () => {
                try {
                    const response = await fetch(`/api/py/graph/visualise`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(submitData),
                    });

                    const graph: string = await response.text();
                    console.log(graph);
                    setGraphContent(graph);
                } catch (error) {
                    console.error("Error getting graph:", error);
                } finally {
                    setLoading(false);
                }
            })();
        };
        getGraphHtml();
    };

    return (
        <>
            <Title order={1}>Confirm</Title>
            <Group p='' justify="space-between" grow align="flex-start">
                <Card padding="md">
                    <Title pb ='md' order={2}>Model</Title>
                    <Button onClick={() => setSlider(0)}>Change</Button>
                    <Divider p='md'/>
                    <Title pb ='md' order={3}>Specification</Title>
                    <SimpleGrid cols={2} mah='30vh'>
                        {Object.entries(model).filter(([key]) => key !== 'model').map(([key, value]) => ( 
                            <Paper shadow="xs" p="xs">
                                <Title order={5}>{key}</Title>
                                <Text maw='80%' lineClamp={3} style={{ marginLeft: '10px' }}>{JSON.stringify(value, null, 2)}</Text>
                            </Paper>
                            ))}
                    </SimpleGrid>
                    <Divider p='md'/>
                    <Title pb ='md' order={3}>Model Information</Title>
                    <ScrollArea h='40vh' type="always">
                        <InformationWindow selected={model.model} />
                    </ScrollArea>
                </Card>

                <Card padding="md">
                    <Title pb ='md' order={2}>Products ({Object.keys(products).length})</Title>
                    <Button onClick={() => setSlider(1)}>Add more</Button>
                    <Divider p='md'/>
                    <Cart products={products} setProducts={setProducts} />
                </Card>
            </Group>
            <Divider p='md'/>
            <SimpleGrid cols={3}>
                <Button color='orange' onClick={getGraph} disabled={loading}>
                    {loading ? "Loading..." : "Visualise"}
                </Button>
                <Button onClick={handleDownload}>Download</Button>
                <Button color='green'onClick={handleSubmit} disabled={submitting}>
                    {submitting ? "Submitting..." : "Submit"}
                </Button>
            </SimpleGrid>
            
            <GraphModal graphContent={graphContent} setGraphContent={setGraphContent} loading={loading}/>
            
        </>
    );
}

export default Confirm;
