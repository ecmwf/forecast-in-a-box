"use client";

import { useState, useEffect } from 'react';

import { Container, TextInput, NumberInput, Stack, Button, LoadingOverlay, MultiSelect, Group, Text, Collapse, Box, Space, Loader, Divider, Title} from '@mantine/core'


import { EnvironmentSpecification } from './interface';

interface EnvironmentProps {
    setEnvironment: (environment: EnvironmentSpecification) => void;
}

export default function Environment({setEnvironment}: EnvironmentProps) {

    const [environment, setLocalEnvironment] = useState<EnvironmentSpecification>({} as EnvironmentSpecification);

    const handleInputChange = (field: keyof EnvironmentSpecification, value: string) => {
        setLocalEnvironment((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = () => {
        setEnvironment(environment);
    };

    return (
        <Container size='xl'>
        <Title order={2}>Environment</Title>
            <Text size="sm" content="dimmed">
                Configure the environment settings for your model.
            </Text>
            <Divider my='md'/>
            <Group justify='space-between' align='flex-end' grow>
            <NumberInput
                label="Hosts"
                placeholder="Number of hosts, default is max"
                value={environment.hosts}
                onChange={(e) => handleInputChange('hosts', e.target.value)}
            />
            <NumberInput
                label="Workers per Host"
                placeholder="Number of workers per host, default is max"
                value={environment.workers_per_host}
                onChange={(e) => handleInputChange('workers_per_host', e.target.value)}
            />
            </Group>
             <Box>
                <Space h="lg" />
                <Stack>
                <Title order={4}>Environment Variables</Title>
                {Object.entries(environment).map(([key, value], index) => (
                    <Group key={index} align='flex-end'>
                        <TextInput
                            label="Key"
                            placeholder="Enter key"
                            value={key}
                            onChange={(e) => {
                                const newKey = e.target.value;
                                setLocalEnvironment((prev) => {
                                    const updated = { ...prev };
                                    delete updated[key];
                                    updated[newKey] = value;
                                    return updated;
                                });
                            }}
                        />
                        <TextInput
                            label="Value"
                            placeholder="Enter value"
                            value={value as string}
                            onChange={(e) => {
                                const newValue = e.target.value;
                                setLocalEnvironment((prev) => ({
                                    ...prev,
                                    [key]: newValue,
                                }));
                            }}
                        />
                        <Button
                            color="red"
                            onClick={() => {
                                setLocalEnvironment((prev) => {
                                    const updated = { ...prev };
                                    delete updated[key];
                                    return updated;
                                });
                            }}
                        >
                            Remove
                        </Button>
                    </Group>
                ))}
                <Button
                    onClick={() =>
                        setLocalEnvironment((prev) => ({
                            ...prev,
                            [`key${Object.keys(prev).length + 1}`]: "",
                        }))
                    }
                >
                    Add Variable
                </Button>
                </Stack>
            </Box>
            <Space h="md" />
            <Group p="right">
                <Button onClick={handleSubmit} color='green'>Submit</Button>
            </Group>
        </Container>
    );
    // return (
    //     <Container size='xl'>
    //         <LoadingOverlay visible={loading}/>
    //         <Grid >
    //             <Grid.Col span={{ base: 12, sm: 12, md: 6, xl: 4 }}>
    //                 <Title order={2}>Categories</Title>
    //                 <Categories categories={categories} setSelected={setSelectedProduct} />
    //             </Grid.Col>
    //             <Grid.Col span={{ base: 12, sm: 12, md: 6, xl: 4 }}>
    //                 <Container className='configuration_container'>
    //                     <Title order={2}>Configuration</Title>
    //                     <Configuration selectedProduct={selected} selectedModel={model} submitTarget={addProduct} />
    //                 </Container>
    //             </Grid.Col>
    //             <Grid.Col span={{ base: 12, sm: 12, md: 12, xl: 4 }} >
    //                 <Title order={2}>Selected ({Object.keys(internal_products).length})</Title>
    //                 <Cart products={internal_products} setProducts={internal_setProducts} />
    //             </Grid.Col>
    //         </Grid>
    //         <Divider p='md'/>
    //         <SimpleGrid cols={1}>
    //             <Button onClick={() => setProducts(internal_products)} disabled={!model}>Submit</Button>
    //         </SimpleGrid>
    //     </Container>
    // );
}