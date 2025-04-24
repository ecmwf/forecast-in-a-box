"use client"; // Required for client-side fetching

import { Card, Button, Tabs, ScrollArea, Group, Title, Text, ActionIcon, Flex, Table, Loader, Progress} from '@mantine/core';
import { useEffect, useState } from "react";

import classes from './options.module.css';

import {IconDownload, IconCheck, IconRefresh, IconTableDown, IconTrash} from '@tabler/icons-react';

interface DownloadResponse {
    download_id: string;
    status: string;
    message: string;
    progress: number;
}

function ModelButton({ model, setSelected }: { model: string; setSelected: (value: string) => void }) {
    const [downloadStatus, setDownloadStatus] = useState<DownloadResponse>({} as DownloadResponse);
    const [installing, setInstalling] = useState<boolean>(false);

    const getDownloadStatus = async () => {
        const result = await fetch(`/api/py/models/download/${model}`);
        const data = await result.json();
        setDownloadStatus(data);
    };

    const handleDownload = async () => {
        const result = await fetch(`/api/py/models/download/${model}`, { method: 'POST' });
        const data = await result.json();
        setDownloadStatus(data);
        const interval = setInterval(async () => {
            await getDownloadStatus();
            if (downloadStatus.status === "completed" || downloadStatus.status === 'errored') {
                clearInterval(interval);
            }
        }, 1000);
        setTimeout(() => {
            clearInterval(interval);
        }, 20000);
        return () => clearInterval(interval); // Cleanup on component unmount
    };

    const handleDelete = async () => {
        try {
            const result = await fetch(`/api/py/models/${model}`, { method: 'DELETE' });
            const data = await result.json();
            setDownloadStatus(data);
        } catch (error) {
            console.error('Error deleting model:', error);
        }
    };

    const handleInstall = async () => {
        setInstalling(true);
        const result = await fetch(`/api/py/models/install/${model}`, { method: 'POST' });
        setInstalling(false);
    };

    useEffect(() => {
        getDownloadStatus();
    }, [model]);

    return (
        <Table.Tr>
            <Table.Td>
                <Button
                    classNames={classes}
                    onClick={() => setSelected(model)}
                    disabled={downloadStatus.status !== 'completed'}
                >
                    <Text size='sm' style={{'wordBreak': 'break-all', 'display':'flex'}}>{model}</Text>
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
        </Table.Tr>
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

    const fetchModelOptions = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/py/models/available');
            const data = await res.json();
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
            <Table striped highlightOnHover verticalSpacing="xs" className={classes['option-table']}>
                <Table.Thead>
                    <Table.Tr style={{ backgroundColor: "#f0f0f6", textAlign: "left" }}>
                        <Table.Th>Model</Table.Th>
                        <Table.Th>Download Status</Table.Th>
                        <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {!modelOptions || Object.keys(modelOptions).length === 0 ? (
                        <Table.Tr>
                            <Table.Td colSpan={3} style={{ textAlign: 'center' }}>
                                No models available.
                            </Table.Td>
                        </Table.Tr>
                    ) : null}
                    {modelOptions && Object.entries(modelOptions).flatMap(([key, values]) =>
                        values.map((value: string) => (
                            <ModelButton setSelected={setSelected} model={`${key}_${value}`} key={`${key}_${value}`} />
                        ))
                    )}
                </Table.Tbody>
            </Table>
            }
        </Card>
    );
}

export default Options;
