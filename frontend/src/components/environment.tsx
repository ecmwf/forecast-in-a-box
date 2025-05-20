// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { useState, useEffect } from 'react';

import { Container, TextInput, NumberInput, Stack, Button, LoadingOverlay, MultiSelect, Group, Text, Collapse, Box, Space, Loader, Divider, Title, Card, SimpleGrid, ScrollArea} from '@mantine/core'


import { IconPlus, IconTrash } from '@tabler/icons-react';


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
                <Space h="xl" />
                <Stack>
                    <Group justify='space-between' align='flex-end'>
                        <Title order={4}>Environment Variables</Title>
                        <Text size="sm" c="dimmed">
                            Add environment variables for all tasks within the workflow.
                        </Text>
                        <Button
                            leftSection={<IconPlus />}
                            onClick={() =>
                                setLocalEnvironment((prev) => ({
                                    ...prev,
                                    [`key${Object.keys(prev).length + 1}`]: "",
                                }))
                            }
                        >
                            Add Variable
                        </Button>
                    </Group>
                    <ScrollArea.Autosize mah="600px" mx="-md" type='always'>
                    <SimpleGrid cols={3}>
                    {Object.keys(environment).length === 0 && (
                        <Text size="sm" c="dimmed">
                            No environment variables added yet.
                        </Text>
                    )}
                    {Object.entries(environment).map(([key, value], index) => (
                        <Card shadow='sm' padding='lg' radius='md' withBorder>
                            <Card.Section style={{ position: 'absolute', top: '30px', right: '30px' }}>
                                <IconTrash
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => {
                                        setLocalEnvironment((prev) => {
                                            const updated = { ...prev };
                                            delete updated[key];
                                            return updated;
                                        });
                                    }}
                                />
                            </Card.Section>
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
                        {/* <Space h="md" /> */}
                        {/* <Button
                            color="red"
                            leftSection={<IconTrash />}
                            onClick={() => {
                                setLocalEnvironment((prev) => {
                                    const updated = { ...prev };
                                    delete updated[key];
                                    return updated;
                                });
                            }}
                        >
                            Remove
                        </Button> */}
                        </Card>
                ))}
                    </SimpleGrid>
                    </ScrollArea.Autosize>
                </Stack>
            </Box>
            <Space h="md" />
            <Group grow>
                <Button onClick={handleSubmit} color='blue'>Submit</Button>
            </Group>
        </Container>
    );
}