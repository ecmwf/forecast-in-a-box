"use client";

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Progress, Container, Title, Text, ScrollArea, Divider, Button, Loader, Space, Table, Flex} from '@mantine/core';

import {IconSearch} from '@tabler/icons-react';

import { SubmitResponse, DatasetId } from '../../components/interface';

import GraphModal from './../../components/shared/graphModal'

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
                
                if (sanitisedProgress === 100) {
                    clearInterval(interval); // Stop fetching if progress is 100
                }

            } catch (error) {
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
                console.log(data);
                setOutputs(data);
            } catch (error) {
                // console.error('Error fetching progress:', error);
            }
        };
        fetchOutputs(); // Initial fetch
    }, [id]);

    const [graphContent, setGraphContent] = useState<string>("");
    const [loading, setLoading] = useState(false);

    const getGraph = () => {

        const getGraphHtml = async () => {
            setLoading(true);
            (async () => {
                try {
                    const response = await fetch(`/api/py/jobs/visualise/${id}`, {
                        method: "GET",
                        headers: { "Content-Type": "application/json" },
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
        <Container size='lg'>
            {/* <Button
            display={'inline'}
            color="blue"
            onClick={() => window.location.href = `/status`}>
            All
            </Button> */}
            <Flex gap='xl' pt='xl'>
            <Title display={'inline'} order={1}>Progress</Title>
            <Button color='orange' onClick={getGraph} disabled={loading}>
                {loading ? "Loading..." : "Visualise"}
            </Button>
            </Flex>

            <Title pt='xl' order={4}>{id}</Title>
            
            {progress === null ? (
                <>
                <Title pb='xl' order={6}>Waiting for Cascade...</Title>
                <Text>{progressResponse}</Text>
                </>
            ) : (
                <>
                <Progress value={progress || 0} striped animated key={progress}/>
                {/* <Loader/> */}
                <Text>{progress}%</Text>

                <Divider my='lg' />
                </>
            )}
            <Title order={3}>Output IDs</Title>
            <Space h='lg'/>
            <Table mb='xs' w='100%' verticalSpacing='' striped highlightOnHover>
            <Table.Tbody>
                {outputs === null || outputs.length === 0 ? (
                    <Table.Tr>
                    <Table.Td colSpan={2} style={{ textAlign: "center"}}>
                     <Space h='lg'/>
                        <Loader size="sm" />
                        <Text ml="sm">Getting output id's...</Text>
                     <Space h='lg'/>
                    </Table.Td>
                    </Table.Tr>
                ) : (
                    <>
                    {outputs.map((dataset: DatasetId, index: number) => (
                        <Table.Tr key={index}>
                            <Table.Td>
                                <Text ml="sm" style={{ fontFamily: 'monospace' }}>{dataset.split(':')[0]}:{dataset.split(':')[1]?.substring(0, 10)}</Text>
                            </Table.Td>
                            <Table.Td align='right'>
                                <Button size='sm' disabled={progress !== 100} component={progress === 100 ? `a` : 'b'} href={progress === 100 ? `/api/py/jobs/result/${id}/${dataset}` : ''} target='_blank'><IconSearch/></Button>
                            </Table.Td>
                        </Table.Tr>
                ))}
                </>
            )}
            </Table.Tbody>
            </Table>
            <GraphModal graphContent={graphContent} setGraphContent={setGraphContent} loading={loading}/>
        </Container>
    );
};

export default ProgressPage;