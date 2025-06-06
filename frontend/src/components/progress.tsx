
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
import { Progress, Container, Title, Text, Divider, Button, Loader, Space, Table, Group} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { AxiosError } from 'axios';

import {IconSearch} from '@tabler/icons-react';

import { DatasetId } from './interface';
import GraphVisualiser from './graph_visualiser';

import {useApi} from '../api';


import { ExecutionSpecification } from './interface';
import SummaryModal from './summary';


function OutputCells({ id, dataset, progress }: { id: string; dataset: string, progress: string | null }) {
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
        console.log(progress)
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
            <Button size='sm' disabled={!isAvailable} component={isAvailable ? `a` : 'b'} href={isAvailable ? `/result/${id}/${dataset}` : ''} target='_blank'><IconSearch/></Button>
        </Table.Td>
        </>
    );
}


export type ProgressResponse = {
    progress: string;
    status: string;
    error: string;
  }


const ProgressComponent = ({ id }: { id: string }) => {

    const [progress, setProgress] = useState<ProgressResponse>({} as ProgressResponse);
    const [outputs, setOutputs] = useState<DatasetId[] | null>([]);
    
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
            
            <Title display={'inline'} order={1}>Progress</Title>
            <Group grow>
                <GraphVisualiser spec={null} url={`/v1/job/${id}/visualise`} />
                <Button color='green' onClick={() => handleMoreInfo(id as string)}>More Info</Button>
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
                            <OutputCells id={id as string} dataset={dataset} progress={progress.progress}/>
                        </Table.Tr>
                ))}
                </>
            )}
            </Table.Tbody>
            </Table>
        </>
    );
};


export default ProgressComponent;