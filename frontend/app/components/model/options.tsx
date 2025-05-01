"use client"; // Required for client-side fetching

import { Card, Button, Tabs, ScrollArea, Group, Title, Text, ActionIcon, Flex, Table, Loader, Progress} from '@mantine/core';
import { useEffect, useRef, useState } from "react";

import classes from './options.module.css';

import {IconDownload, IconCheck, IconRefresh, IconTableDown, IconTrash} from '@tabler/icons-react';
import {useApi} from '@/app/api';

interface DownloadResponse {
    download_id: string;
    status: string;
    message: string;
    progress: number;
}

function ModelButton({ model, setSelected }: { model: string; setSelected: (value: string) => void }) {
    const [downloadStatus, setDownloadStatus] = useState<DownloadResponse>({} as DownloadResponse);
    const [installing, setInstalling] = useState<boolean>(false);
    const api = useApi();

    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
    
    const getDownloadStatus = async () => {
        const result = await api.get(`/api/v1/model/${model}/downloaded`);
        const data = await result.data;
        setDownloadStatus(data);
        if (downloadStatus.status === "completed" || downloadStatus.status === 'errored') {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
        }
    };

    const handleDownload = async () => {
        const result = await api.post(`/api/v1/model/${model}/download`);
        const data = await result.data;
        setDownloadStatus(data);

        progressIntervalRef.current = setInterval(() => {
            getDownloadStatus();
        }, 2500);
    
        return () => {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
        };
    }

    const handleDelete = async () => {
        try {
            const result = await api.delete(`/api/v1/model/${model}`);
            const data = await result.data();
            setDownloadStatus(data);
        } catch (error) {
            console.error('Error deleting model:', error);
        }
    };

    const handleInstall = async () => {
        setInstalling(true);
        const result = await api.post(`/api/v1/model/${model}/install`);
        setInstalling(false);
    };

    useEffect(() => {
        getDownloadStatus();
    }, [model]);

    return (
        <>
            <Table.Td>
                <Button
                    classNames={classes}
                    onClick={() => setSelected(model)}
                    disabled={downloadStatus.status !== 'completed'}
                >
                    <Text size='sm' style={{'wordBreak': 'break-all', 'display':'flex'}}>{model.split('_',2)[1]}</Text>
                </Button>
            </Table.Td>
            <Table.Td>
                {downloadStatus.status === 'completed' ? (
                    <Group><IconCheck color="green" /> <Text size='sm'>Downloaded</Text></Group>
                ): downloadStatus.status === 'in_progress' ? (
                    <Progress value={downloadStatus.progress} />
                ): (
                    <Button
                        color='green'
                        onClick={() => handleDownload()}
                        disabled={downloadStatus.status !== 'not_downloaded' && downloadStatus.status !== 'errored'}
                        // leftSection={<IconDownload />}
                        size='sm'
                    >
                        {downloadStatus.status === 'errored' ? 'Retry' : 'Download'}
                    </Button>
                )}
            </Table.Td>
            <Table.Td>
                <Group>
                    <Button disabled={downloadStatus.status !== 'completed'} onClick={() => handleInstall()} leftSection={<IconTableDown />} variant="outline" color='blue'>
                        {installing ? <Loader size={16} /> : 'Install'}
                    </Button>
                    <Button disabled={downloadStatus.status !== 'completed'} onClick={() => handleDelete()} leftSection={<IconTrash />}  color='red'>
                        Delete
                    </Button>
                </Group>
            </Table.Td>
        </>
    );
}

interface OptionsProps {
    cardProps?: React.ComponentProps<typeof Card>;
    tabProps?: React.ComponentProps<typeof Tabs>;
    setSelected: (value: string) => void;
}

function Options({ cardProps, tabProps, setSelected }: OptionsProps) {
    const [modelOptions, setData] = useState<Record<string, string[]>>();
    const [loading, setLoading] = useState(true);
    const api = useApi();

    const fetchModelOptions = async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/v1/model/available');
            const data = await res.data;
            setData(data);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchModelOptions();
    }, []);

    return (
        <Card {...cardProps} padding="">
            <Card.Section>
                <Flex gap='lg'>
                <Title order={2}>Models</Title>
                <ActionIcon onClick={fetchModelOptions} style={{ display: 'inline' }}><IconRefresh/></ActionIcon>
                </Flex>
            </Card.Section>
            {loading ? <p>Loading...</p> : 
            <Table highlightOnHover verticalSpacing="xs" className={classes['option-table']}>
                <Table.Thead>
                    <Table.Tr style={{ backgroundColor: "#f0f0f6", textAlign: "left" }}>
                        <Table.Th>Model Group</Table.Th>
                        <Table.Th>Model</Table.Th>
                        <Table.Th>Download Status</Table.Th>
                        <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {!modelOptions || Object.keys(modelOptions).length === 0 ? (
                        <Table.Tr>
                            <Table.Td colSpan={4} style={{ textAlign: 'center' }}>
                                No models available.
                            </Table.Td>
                        </Table.Tr>
                    ) : null}
                    {modelOptions && Object.entries(modelOptions).flatMap(([key, values]) =>
                        values.map((value: string, index: number) => (
                            <Table.Tr key={`${key}_${value}`}>
                                {index === 0 && (
                                    <Table.Td rowSpan={values.length} style={{ verticalAlign: 'top', fontWeight: 'bold' }}>
                                        {key}
                                    </Table.Td>
                                )}
                                <ModelButton setSelected={setSelected} model={`${key}_${value}`} />
                            </Table.Tr>
                        ))
                    )}
                </Table.Tbody>
            </Table>
            }
        </Card>
    );
}

export default Options;
