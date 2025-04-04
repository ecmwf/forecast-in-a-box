"use client";

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Progress, Container, Title, Text, ScrollArea, Divider, Button, ActionIcon, Table} from '@mantine/core';

import {IconSearch} from '@tabler/icons-react';

import { SubmitResponse, DatasetId } from '../../components/interface';


const ProgressPage = () => {
    const params = useParams();
    const id = params?.id;

    const [progressResponse, setProgressResponse] = useState<string>();
    const [progress, setProgress] = useState<number | null>(null);
    const [outputs, setOutputs] = useState<DatasetId[] | null>([]);

    useEffect(() => {
        const fetchProgress = async () => {
            try {
                const response = await fetch(`/api/py/jobs/status/${id}`, {
                    method: 'GET',
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                const data = await response.json();
                const sanitisedProgress = parseFloat(data.progress.replace('%', ''));
                setProgress(sanitisedProgress);
                setProgressResponse(response.statusText);
            } catch (error) {
                // console.error('Error fetching progress:', error);
            }
        };

        const interval = setInterval(fetchProgress, 7000); // Fetch progress every 5 seconds
        fetchProgress(); // Initial fetch

        return () => clearInterval(interval); // Cleanup on component unmount
    }, [id]);
    
    useEffect(() => {
        const fetchOutputs = async () => {
            try {
                const response = await fetch(`/api/py/jobs/outputs/${id}`, {
                    method: 'GET',
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                const data = await response.json();
                console.log(data);
                setOutputs(data);
            } catch (error) {
                // console.error('Error fetching progress:', error);
            }
        };
        fetchOutputs(); // Initial fetch
    }, [id]);

    return (
        <Container size='lg'>
            {/* <Button
            display={'inline'}
            color="blue"
            onClick={() => window.location.href = `/status`}>
            All
            </Button> */}
            <Title display={'inline'} pt='xl' pb='xl' order={1}>Progress</Title>
            <Title pt='xl' order={4}>{id}</Title>
            {progress === null ? (
                <>
                <Title pb='xl' order={6}>Waiting for Cascade...</Title>
                <Text>{progressResponse}</Text>
                </>
            ) : (
                <>
                <Progress value={progress || 0} striped animated key={progress}/>
                <Text>{progress}%</Text>

                <Divider my='lg' />
                </>
            )}
            <Title order={3}>Output IDs</Title>
            <ScrollArea h='50vh' type="always">
            <Container bg='000000'>
            {outputs === null || outputs.length === 0 ? (
                <></>
            ) : (
            <>
            {outputs.map((dataset: DatasetId, index: number) => (
                <Table key={index} mb='xs' w='100%'>
                    <Table.Tbody>
                    <Table.Tr>
                        <Table.Td>
                            <Text>{dataset}</Text>
                        </Table.Td>
                        <Table.Td align='right'>
                            <ActionIcon mb='xs' size='lg' mr='21px' disabled={progress !== 100} onClick={() => console.log(`Clicked on task: ${dataset}`)}>
                                <IconSearch scale='30%' />
                            </ActionIcon>
                        </Table.Td>
                    </Table.Tr>
                    </Table.Tbody>
                </Table>
            ))}
            </>
            )}
            </Container>
            </ScrollArea>
        </Container>
    );
};

export default ProgressPage;