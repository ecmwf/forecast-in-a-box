
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { useEffect, useState, useRef} from 'react';
import { Progress, Pagination, Title, Text, Divider, Button, Loader, Space, Table, Group, Modal, Card, Stack, Badge, Code, Collapse, SimpleGrid} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { AxiosError } from 'axios';

import {IconSearch, IconLogs, IconChevronDown, IconChevronUp, IconFileText, IconInfoCircle, IconRefresh} from '@tabler/icons-react';

import GraphVisualiser from '../graph_visualiser';
import {useApi} from '../../api';
import Result from '../results/Result';
import { ExecutionSpecification } from '../interface';
import SummaryModal from '../summary';


function OutputCells({ id, dataset, progress, popout}: { id: string; dataset: string, progress: string | null, popout: boolean }) {
    const [isAvailable, setIsAvailable] = useState<boolean>(false);
    const api = useApi();

    useEffect(() => {
        const checkAvailability = async () => {
            try {
                const response = await api.get(`/v1/job/${id}/${dataset}/available`);
                if (response.status !== 200) {
                    throw new Error(`HTTP error! Status: ${response.statusText}`);
                }
                const data = await response.data;
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

    const [showModal, setShowModal] = useState(false);

    return (
        <>
        <Modal opened={showModal} onClose={() => setShowModal(false)} size='xl'>
            <Result job_id={id} dataset_id={dataset} in_modal={true}/>
        </Modal>
        <Table.Td>
            <Text ml="sm" style={{ fontFamily: 'monospace' }}>{dataset.split(':')[0]}:{dataset.split(':')[1]?.substring(0, 10)}</Text>
        </Table.Td>
        <Table.Td align='right'>
            {popout ? (
                <Button size='sm' disabled={!isAvailable} onClick={() => setShowModal(true)}><IconSearch/></Button>
            ) : (
                <Button size='sm' disabled={!isAvailable} component={isAvailable ? `a` : 'b'} href={isAvailable ? `/result/${id}/${dataset}` : ''} target='_blank'><IconSearch/></Button>
            )}
        </Table.Td>
        </>
    );
}

function OutputCard({ product, id, progress, popout }: { product: ProductOutput; id: string; progress: string | null; popout: boolean }) {
    const [specOpened, setSpecOpened] = useState(false);
    const ITEMS_PER_PAGE = 10;
    const [currentPage, setCurrentPage] = useState(1);

    return (
        <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Stack gap="sm">
                <Group justify="space-between">
                    <Title order={4}>{product.product_name}</Title>
                    <Button
                        variant="subtle"
                        size="xs"
                        onClick={() => setSpecOpened(!specOpened)}
                        leftSection={<IconFileText size={16} />}
                        rightSection={specOpened ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                        mb="xs"
                    >
                        Specification
                    </Button>
                </Group>

                <Collapse in={specOpened}>
                    <Code block>{JSON.stringify(product.product_spec, null, 2)}</Code>
                </Collapse>

                <>


                    <Text size="sm" fw={500} mb="xs">Output IDs:</Text>
                    <Table striped highlightOnHover>
                        <Table.Tbody>
                            {product.output_ids
                                .slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
                                .map((outputId: string, idIndex: number) => (
                                    <Table.Tr key={idIndex}>
                                        <OutputCells id={id} dataset={outputId} progress={progress} popout={popout} />
                                    </Table.Tr>
                                ))}
                        </Table.Tbody>
                    </Table>
                    <Space h="md" />
                    {product.output_ids.length > ITEMS_PER_PAGE && (
                        <Pagination
                            total={Math.ceil(product.output_ids.length / ITEMS_PER_PAGE)}
                            value={currentPage}
                            onChange={setCurrentPage}
                        />
                    )}
                </>
            </Stack>
        </Card>
    );
}


export type ProgressResponse = {
    progress: string;
    status: string;
    error: string;
  }

export type ProductOutput = {
    product_name: string;
    product_spec: Record<string, any>;
    output_ids: string[];
}


const ProgressComponent = ({ id, popout = false }: { id: string, popout: boolean}) => {

    const [progress, setProgress] = useState<ProgressResponse>({} as ProgressResponse);
    const [outputs, setOutputs] = useState<ProductOutput[] | null>([]);

    const progressIntervalRef = useRef<number | null>(null);
    const api = useApi();

    const [showMoreInfo, setShowMoreInfo] = useState(false);
    const [moreInfoSpec, setMoreInfoSpec] = useState({} as ExecutionSpecification);

    const handleMoreInfo = (jobId: string) => {
        try {
        api.get(`/v1/job/${jobId}/specification`)
            .then((response) => {
            setMoreInfoSpec(response.data);
            setShowMoreInfo(true);
            })
            .catch((error) => {
            console.error("Error getting job specification:", error);
            showNotification({
                id: `more-info-error-${crypto.randomUUID()}`,
                position: "top-right",
                autoClose: 3000,
                title: "Error getting job specification",
                message: `${error.response?.data?.detail}`,
                color: "red",
            });
            });
        } catch (error) {
        showNotification({
            id: `more-info-error-${crypto.randomUUID()}`,
            position: "top-right",
            autoClose: 3000,
            title: "Error getting job specification",
            message: `${error.response?.data?.detail}`,
            color: "red",
        });
        }
    }

    const fetchProgress = async () => {
        try {
            const response = await api.get(`/v1/job/${id}/status`);
            const data = response.data;
            setProgress(data);

            if (data.progress === "100.00" || data.status === "completed") {
                if (progressIntervalRef.current) {
                    clearInterval(progressIntervalRef.current); // Stop fetching if progress is 100
                    fetchOutputs(); // Fetch outputs once progress is complete
                    progressIntervalRef.current = null;
                }
            }
        } catch (error) {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
            showNotification({
                id: `error-progress-${id}`,
                title: 'Error',
                message: `Error getting status: ${error instanceof AxiosError ? error.response?.data?.detail : 'Unknown error'}`,
                color: 'red',
            });
        }
    };

    const fetchOutputs = async () => {
        try {
            const response = await api.get(`/v1/job/${id}/outputs`);
            const data = await response.data;
            setOutputs(data);

            // If outputs is empty, try again after a short delay
            if (Array.isArray(data) && data.length === 0) {
                setTimeout(fetchOutputs, 2000);
            }
        } catch (error) {
            showNotification({
                id: `error-outputs-${id}`,
                title: 'Error',
                message: `Error getting outputs: ${error instanceof AxiosError ? error.response?.data?.detail : 'Unknown error'}`,
                color: 'red',
            });
        }
    };
    const handleLogs = (jobId: string) => {
        try {
            api.get(`/v1/job/${jobId}/logs`, { responseType: 'blob' })
                .then((response) => {
                    const url = window.URL.createObjectURL(new Blob([response.data]));
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute('download', `logs-${jobId}.zip`);
                    document.body.appendChild(link);
                    link.click();
                    link.parentNode?.removeChild(link);
                })
                .catch((error) => {
                    console.error("Error getting job logs:", error);
                    showNotification({
                        id: `more-info-error-${crypto.randomUUID()}`,
                        position: "top-right",
                        autoClose: 3000,
                        title: "Error getting job logs",
                        message: `${error.response?.data?.detail}`,
                        color: "red",
                    });
                });
        } catch (error) {
            showNotification({
                id: `more-info-error-${crypto.randomUUID()}`,
                position: "top-right",
                autoClose: 3000,
                title: "Error getting job logs",
                message: `${error instanceof AxiosError ? error.response?.data?.detail : 'Unknown error'}`,
                color: "red",
            });
        }
    }

    useEffect(() => {
        // Start the interval and store its ID in the ref
        progressIntervalRef.current = setInterval(() => {
            fetchProgress();
        }, 5000);
        fetchProgress(); // Initial fetch
        fetchOutputs(); // Initial fetch

        // Cleanup function to clear the interval when the component unmounts or `id` changes
        return () => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
        };
    }, [id]);

    return (
        <>
        <SummaryModal moreInfoSpec={moreInfoSpec} showMoreInfo={showMoreInfo} setShowMoreInfo={setShowMoreInfo}/>
            <Space h="xl"/>

            <Title display={'inline'} order={1} pb='md'>Progress</Title>
            <Group grow>
                <GraphVisualiser spec={null} url={`/v1/job/${id}/visualise`} />
                <Button color='green' onClick={() => handleMoreInfo(id as string)} leftSection={<IconInfoCircle />}>More Info</Button>
                <Button color='orange' onClick={() => handleLogs(id as string)} leftSection={<IconLogs />}>Logs</Button>
                {/* <Button color='blue' component='a' href={`/v1/job/${id}/download`} target='_blank'>Download</Button> */}
            </Group>
            <Title pt='xl' order={4}>{id} - {progress.status}</Title>

            {!progress.progress ? (
                <>
                <Title pb='xl' order={6}>Waiting for Cascade...</Title>
                </>
            ) : (
                <>
                <Progress value={Math.max(1, parseFloat(progress.progress) || 0)} striped animated/>
                <Group>
                    {/* <Loader size="xs" /> */}
                    <Text>{progress.progress}%</Text>
                </Group>
                <Divider my='lg' />
                </>
            )}
            {progress.error && (
                <Text c='red'>{progress.error}</Text>
            )}
           <Button
                variant="outline"
                color="blue"
                size="xs"
                leftSection={<IconRefresh size={16} />}
                onClick={() => {fetchProgress(); setOutputs([]); fetchOutputs();}}
                >
                    Refresh
            </Button>
            <Space h='lg'/>
            <Title order={3}>Outputs</Title>

            <Space h='lg'/>
            {outputs === null || outputs.length === 0 ? (
                <Card shadow="sm" padding="lg" radius="md" withBorder>
                    <Space h='lg'/>
                    <Group justify="center">
                        <Loader size="sm" />
                        <Text>Getting outputs...</Text>
                    </Group>
                    <Space h='lg'/>
                </Card>
            ) : (
                <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    {outputs.map((product: ProductOutput, index: number) => (
                        <OutputCard
                            key={index}
                            product={product}
                            id={id as string}
                            progress={progress.progress}
                            popout={popout}
                        />
                    ))}
                </SimpleGrid>
            )}
        </>
    );
};


export default ProgressComponent;
