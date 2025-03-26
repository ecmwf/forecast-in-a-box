
import React, { useState } from 'react';
import { Button, Card, Title, Group, Modal, Divider, SimpleGrid, Center, ScrollArea, Paper, Text} from '@mantine/core';

import { IconX, IconPencil} from '@tabler/icons-react';

import {ModelSpecification, ProductSpecification, SubmitSpecification} from './interface'

import InformationWindow from './model/information'
import Cart from './products/cart'

import Loader from './animations/loader'


interface ConfirmProps {
    model: ModelSpecification;
    products: Record<string, ProductSpecification>;
    setProducts: (products: Record<string, ProductSpecification>) => void;
    setSlider: (value: number) => void;
}


function GraphModal({ graphUrl, setGraphUrl, loading }: { graphUrl: string | null, setGraphUrl: (url: string | null) => void, loading: boolean }) {
    return (
        <Modal
            opened={!!graphUrl || loading}
            onClose={() => setGraphUrl(null)}
            title={loading ? "Loading..." : "Graph"}
            size={loading ? "xs" : "70vw"}
        >
            {loading && 
            <Center>
                <Loader />
            </Center>
            }
            {!loading && graphUrl &&
                <iframe
                    src={graphUrl.replace(/^public/, '')}
                    title="Graph"
                    style={{ width: '100%', height: '620px', border: 'none' }}
                />
            }
        </Modal>
    );
}

function Confirm({ model, products, setProducts, setSlider}: ConfirmProps) {

    const handleSubmit = () => {
        const submitData: SubmitSpecification = {
            model: model,
            products: Object.values(products),
            environment: {}
        }
        console.log(submitData);

        const submit = async () => {
            try {
                const response = await fetch(`/api/py/submit/`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(submitData),
                });
        
                const runId: number = await response.json();
                
            } catch (error) {
                console.error("Error submitting:", error);
            }
        };
    }
    const [graphUrl, setGraphUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const getGraph = () => {
        const submitData: SubmitSpecification = {
            model: model,
            products: Object.values(products),
            environment: {}
        };
        console.log(submitData);

        const submit = async () => {
            setLoading(true);
            (async () => {
                try {
                    const response = await fetch(`/api/py/submit/get_graph/`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(submitData),
                    });

                    const graph: string = await response.text();
                    console.log(graph);
                    setGraphUrl(graph);
                } catch (error) {
                    console.error("Error getting graph:", error);
                } finally {
                    setLoading(false);
                }
            })();
        };
        submit();
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
            <SimpleGrid cols={2}>
                <Button onClick={getGraph} disabled={loading}>
                    {loading ? "Loading..." : "Graph?"}
                </Button>
                <Button onClick={handleSubmit}>Submit</Button>
            </SimpleGrid>
            
            <GraphModal graphUrl={graphUrl} setGraphUrl={setGraphUrl} loading={loading}/>
            
        </>
    );
}

export default Confirm;
