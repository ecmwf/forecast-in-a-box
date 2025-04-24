"use client";

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Progress, Container, Title, Text, ScrollArea, Divider, Button, Loader, Space, Table, Flex} from '@mantine/core';

import {IconSearch} from '@tabler/icons-react';

import { DatasetId } from '../../components/interface';
import GraphVisualiser from '@/app/components/visualise';

function OutputCells({ id, dataset, progress }: { id: string; dataset: string, progress: string | null }) {
    const [isAvailable, setIsAvailable] = useState<boolean>(false);

    useEffect(() => {
        const checkAvailability = async () => {
            try {
                const response = await fetch(`/api/py/jobs/available/${id}/${dataset}`, {
                    method: 'GET',
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                const data = await response.json();
                setIsAvailable(data.available);
            } catch (error) {
                console.error('Error checking availability:', error);
            }
        };

        checkAvailability();
        if (progress === "100.00") {
            setIsAvailable(true); // Set to true if progress is 100
        }
    }, [id, dataset, progress]);
    
    return (
        <>
        <Table.Td>
            <Text ml="sm" style={{ fontFamily: 'monospace' }}>{dataset.split(':')[0]}:{dataset.split(':')[1]?.substring(0, 10)}</Text>
        </Table.Td>
        <Table.Td align='right'>
            <Button size='sm' disabled={!isAvailable} component={isAvailable ? `a` : 'b'} href={isAvailable ? `/api/py/jobs/result/${id}/${dataset}` : ''} target='_blank'><IconSearch/></Button>
        </Table.Td>
        </>
    );
}


export type ProgressResponse = {
    progress: string;
    status: string;
    error: string;
  }

const ProgressPage = () => {
    const params = useParams();
    const id = params?.id;


    const [progress, setProgress] = useState<ProgressResponse>({} as ProgressResponse);
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
                setProgress(data);
                
                if (progress.progress == "100.00" || progress.status == "errored" || progress.status == "completed") {
                    clearInterval(interval); // Stop fetching if progress is 100
                }

            } catch (error) {
                clearInterval(interval);
                // console.error('Error fetching progress:', error);
            }
        };
        const interval = setInterval(() => {
            fetchProgress();
        }, 5000); // Fetch progress every 5 seconds

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
            <Space h="xl"/>
            
            <Title display={'inline'} order={1}>Progress</Title>
            <GraphVisualiser spec={null} url={`/api/py/jobs/visualise/${id}`} />

            <Title pt='xl' order={4}>{id} - {progress.status}</Title>
            
            {!progress.progress ? (
                <>
                <Title pb='xl' order={6}>Waiting for Cascade...</Title>
                </>
            ) : (
                <>
                <Progress value={parseFloat(progress.progress) || 0} striped animated/>
                {/* <Loader/> */}
                <Text>{progress.progress}%</Text>
                <Divider my='lg' />
                </>
            )}
            {progress.error && (
                <Text c='red'>{progress.error}</Text>
            )}
            <Space h='lg'/>

            <Title order={3}>Output IDs</Title>
            <Space h='lg'/>
            <Table mb='xs' w='100%' verticalSpacing='' striped highlightOnHover>
            <Table.Tbody>
                {outputs === null || outputs.length === 0 ? (
                    <Table.Tr>
                    <Table.Td colSpan={2} style={{ textAlign: "center"}}>
                     <Space h='lg'/>
                        <Loader size="sm" />
                        <Text ml="sm">Getting output ids...</Text>
                     <Space h='lg'/>
                    </Table.Td>
                    </Table.Tr>
                ) : (
                    <>
                    {outputs.map((dataset: DatasetId, index: number) => (
                        <Table.Tr key={index}>
                            <OutputCells id={id} dataset={dataset} progress={progress.progress}/>
                        </Table.Tr>
                ))}
                </>
            )}
            </Table.Tbody>
            </Table>
        </Container>
    );
};

export default ProgressPage;