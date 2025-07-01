
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client"; // Required for client-side fetching

import { Card, Button, Tabs, ScrollArea, Group, Title, Text, ActionIcon, Flex, Table, Loader, Progress, Menu, Burger, Modal, Textarea} from '@mantine/core';
import { useEffect, useRef, useState } from "react";

import classes from './manage.module.css';

import {IconX, IconCheck, IconRefresh, IconTableDown, IconTrash, IconPencil} from '@tabler/icons-react';
import {useApi} from '../../api';
import { showNotification } from '@mantine/notifications';

interface DownloadResponse {
    download_id: string;
    status: string;
    message: string;
    progress: number;
}

function EditModel({ model }: { model: string }) {
    const [modalOpened, setModalOpened] = useState(false);
    const [modelData, setModelData] = useState<any>(null);

    const [editable, setEditable] = useState(false);

    const api = useApi();
    const fetchModelData = async () => {
        try {
            const result = await api.get(`/v1/model/${model.replace('/', '_')}/metadata`);
            const data = await result.data;
            setModelData(data);
        } catch (error) {
            console.error('Error fetching model data:', error);
        }
    }

    const fetchEditableStatus = async () => {
        try {
            const result = await api.get(`/v1/model`);
            const data = await result.data[`${model}`];
            setEditable(data.editable);
        } catch (error) {
            console.error('Error fetching editable status:', error);
        }
    };


    const waitForComplete = async () => {
        setEditable(false);
        // Poll for status
        const interval = setInterval(async () => {
            await fetchEditableStatus();
            if (editable) {
                clearInterval(interval);
            }
        }, 2000);
    };

    const handleEdit = async (modelData) => {
        showNotification({
            color: 'blue',
            message: 'Saving model data...'
        });
        try {
            await api.patch(`/v1/model/${model.replace('/', '_')}/metadata`, modelData)
            waitForComplete()
        } catch (error) {
            showNotification({
                color: 'red',
                message: 'Error saving model data',                
            });
        } finally {
            setModalOpened(false);
        }
    }

    useEffect(() => {
        fetchEditableStatus();
        // Fetch model data when the modal opens
        if (modalOpened) {
            fetchModelData();
        }
    }, [modalOpened, model]);

    return (
        <>
            <Button onClick={() => {fetchModelData(); setModalOpened(true)}} leftSection={<IconPencil />} color='orange' disabled={!editable}>
                Edit
            </Button>
            <Modal
                opened={modalOpened}
                onClose={() => setModalOpened(false)}
                title={`Edit Model: ${model}`}
                size="lg"
            >
                    <Flex direction="column" gap="md">
                        {modelData ? (
                            Object.entries(modelData).map(([key, value]) => (
                                <Group key={key} justify="apart">
                                    <Textarea
                                        w="100%"
                                        label={key}
                                        autosize
                                        minRows={2}
                                        value={
                                            typeof value === 'object' && value !== null
                                                ? JSON.stringify(value, null, 2)
                                                : String(value || '')
                                        }
                                        onChange={e => {
                                            let newValue = e.target.value;
                                            if (typeof value === 'object' && value !== null) {
                                                try {
                                                    newValue = JSON.parse(e.target.value);
                                                } catch {
                                                    // keep as string if not valid JSON
                                                }
                                            }
                                            setModelData((prev: any) => ({
                                                ...prev,
                                                [key]: newValue
                                            }));
                                        }}
                                        styles={{
                                            input: {
                                                fontFamily: typeof value === 'object' && value !== null ? 'monospace' : undefined
                                            }
                                        }}
                                    />
                                </Group>
                            ))
                        ) : (
                            <Loader />
                        )}
                    </Flex>
                    <Button mt="md" 
                        fullWidth
                        onClick={() => {
                            handleEdit(modelData)
                    }}>
                        Save Changes
                    </Button>
            </Modal>
        </>
    );
}

function ModelButton({ model, setSelected }: { model: string; setSelected: (value: string) => void }) {
    const [downloadStatus, setDownloadStatus] = useState<DownloadResponse>({} as DownloadResponse);
    const api = useApi();

    const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
    
    const getDownloadStatus = async () => {
        const result = await api.get(`/v1/model`);
        const data = await result.data[model].download;

        setDownloadStatus(data);
        if (downloadStatus.status === "completed" || downloadStatus.status === 'errored') {
            if (progressIntervalRef.current) {
                clearInterval(progressIntervalRef.current);
                progressIntervalRef.current = null;
            }
        }
        if (downloadStatus.status === "in_progress") {
            progressIntervalRef.current = setInterval(() => {
                getDownloadStatus();
            }, 2500);
        }
    };

    const handleDownload = async () => {
        const result = await api.get(`/v1/model`);
        const data = await result.data[`${model}`];
        setDownloadStatus(data.download);


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
            const result = await api.delete(`/v1/model/${model.replace('/', '_')}`);
            const data = await result.data;
            setDownloadStatus(data);
        } catch (error) {
            console.error('Error deleting model:', error);
        }
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
            <Button disabled={downloadStatus.status !== 'completed'} onClick={() => handleDelete()} leftSection={<IconTrash />}  color='red'>
                Delete
            </Button>,
            <EditModel model={model} />,
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
                    <Text size='sm' style={{'wordBreak': 'break-all', 'display':'flex'}}>{model.split('/',2)[1]}</Text>
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
            const res = await api.get('/v1/model');
            const data = Object.keys(res.data);
            const grouped: Record<string, string[]> = {};
            data.forEach((item: string) => {
                const [group, model] = item.split('/');
                if (!grouped[group]) {
                    grouped[group] = [];
                }
                grouped[group].push(model);
            });
            setData(grouped);
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
                    <ActionIcon onClick={fetchModelOptions} style={{ display: 'inline' }}>
                        <IconRefresh/>
                    </ActionIcon>
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
                        Array.isArray(values)
                            ? values.map((value: string, index: number) => (
                                <Table.Tr key={`${key}/${value}`}>
                                    {index === 0 && (
                                        <Table.Td rowSpan={values.length} style={{ verticalAlign: 'top', fontWeight: 'bold' }}>
                                            {key}
                                        </Table.Td>
                                    )}
                                    <ModelButton setSelected={setSelected} model={`${key}/${value}`} />
                                </Table.Tr>
                            ))
                            : null
                    )}
                </Table.Tbody>
            </Table>
            }
        </Card>
    );
}

export default Options;
