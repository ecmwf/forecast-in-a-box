"use client"; // Required for client-side fetching

import { Card, Button, Tabs, ScrollArea, Group, Title, Text, ActionIcon, Flex, Table, Loader, Progress, Menu, Burger} from '@mantine/core';
import { useEffect, useRef, useState } from "react";

import classes from './options.module.css';

import {IconX, IconCheck, IconRefresh, IconTableDown, IconTrash} from '@tabler/icons-react';
import {useApi} from '../../api';

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
        const result = await api.get(`/v1/model/${model}/downloaded`);
        const data = await result.data;
        setDownloadStatus(data);
        if (downloadStatus.status === "completed" || downloadStatus.status === 'errored') {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
        }
        console.log('downloadStatus', data);
        if (downloadStatus.status === "in_progress") {
            progressIntervalRef.current = setInterval(() => {
                getDownloadStatus();
            }, 2500);
        }
    };

    const handleDownload = async () => {
        const result = await api.post(`/v1/model/${model}/download`);
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
            const result = await api.delete(`/v1/model/${model}`);
            const data = await result.data;
            setDownloadStatus(data);
        } catch (error) {
            console.error('Error deleting model:', error);
        }
    };

    const handleInstall = async () => {
        setInstalling(true);
        const result = await api.post(`/v1/model/${model}/install`);
        setInstalling(false);
    };

    useEffect(() => {
        getDownloadStatus();
    }, [model]);

    const UserButtons = (): JSX.Element[] => {
        return [
            <Button
                color='green'
                onClick={() => handleDownload()}
                disabled={downloadStatus.status !== 'not_downloaded' && downloadStatus.status !== 'errored'}
                // leftSection={<IconDownload />}
                size='sm'
            >
                {downloadStatus.status === 'errored' ? 'Retry' : 'Download'}
            </Button>,
            // <Button disabled={downloadStatus.status !== 'completed'} onClick={() => handleInstall()} leftSection={<IconTableDown />} variant="outline" color='blue'>
            //     {installing ? <Loader size={16} /> : 'Install'}
            // </Button>,
            <Button disabled={downloadStatus.status !== 'completed'} onClick={() => handleDelete()} leftSection={<IconTrash />}  color='red'>
                Delete
            </Button>
            ];
    };

    return (
        <>
            <Table.Td>
                <Button
                    classNames={classes}
                    onClick={() => setSelected(model)}
                    disabled={downloadStatus.status !== 'completed'}
                    variant='outline'
                >
                    <Text size='sm' style={{'wordBreak': 'break-all', 'display':'flex'}}>{model.split('_',2)[1]}</Text>
                </Button>
            </Table.Td>
            <Table.Td>
                {downloadStatus.status === 'completed' ? (
                    <IconCheck color="green" />
                ): downloadStatus.status === 'in_progress' ? (
                    <><Progress value={downloadStatus.progress} /> <Text size='xs'>{downloadStatus.progress}%</Text></>
                ): (
                    <IconX color="red" />
                )}
            </Table.Td>
            <Table.Td>
                <Menu shadow="md">
                <Menu.Target>
                    <Burger hiddenFrom ="xs"/>
                </Menu.Target>
                <Menu.Dropdown>
                    {UserButtons().map((button, index) => (
                    <Menu.Item key={index}>
                    {button}
                    </Menu.Item>
                    ))}
                </Menu.Dropdown>
                </Menu>
                <Group visibleFrom='xs' gap='xs'>
                    {UserButtons().map((button, index) => (
                         <div key={index}>
                            {button}
                        </div>
                    ))}
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
            const res = await api.get('/v1/model/available');
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
                        <Table.Th>Group</Table.Th>
                        <Table.Th>Model</Table.Th>
                        <Table.Th>Status</Table.Th>
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
