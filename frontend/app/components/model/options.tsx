"use client"; // Required for client-side fetching

import { Card, Button, Tabs, ScrollArea, Paper, Title, Text, ActionIcon, Flex, Table, Loader} from '@mantine/core';
import { useEffect, useState } from "react";

import classes from './options.module.css';

import {IconDownload, IconCheck, IconRefresh, IconTableDown} from '@tabler/icons-react';


function ModelButton({ model, setSelected }: { model: string; setSelected: (value: string) => void }) {
    const [downloaded, setDownloaded] = useState<boolean>(false);
    const [downloading, setDownloading] = useState<boolean>(false);
    const [installing, setInstalling] = useState<boolean>(false);

    useEffect(() => {
        const fetchDownloaded = async () => {
            const result = await fetch(`/api/py/models/downloaded/${model}`);
            setDownloaded(await result.json());
        };
        fetchDownloaded();
    }, [model]);

    const handleDownload = () => {
        setDownloading(true);
        const download = async () => {
            const result = await fetch(`/api/py/models/download/${model}`);
            setDownloaded(true);
            setDownloading(false);
        };
        download();
    };
    const handleInstall = () => {
        setInstalling(true);
        const install = async () => {
            const result = await fetch(`/api/py/models/install/${model}`);
            setInstalling(false);
        }
        install();
    };

    return (
        <Table.Tr>
            <Table.Td>
                <Button
                    className={`${classes['button']} ${!downloaded ? classes['button--disabled'] : ''}`}
                    onClick={() => setSelected(model)}
                    disabled={!downloaded}
                >
                    {model}
                    {downloading && !downloaded && <Text> - Loading...</Text>}
                </Button>
            </Table.Td>
            <Table.Td>
                {downloaded ? (
                    <IconCheck color="green" />
                ): downloading ? (
                        <Loader/>
                ): (
                    <ActionIcon disabled={downloading} onClick={() => handleDownload()}>
                        <IconDownload />
                    </ActionIcon>
                    )}
            </Table.Td>
            <Table.Td>
                {installing ?
                    <Loader/>
                :
                <ActionIcon disabled={installing || !downloaded} onClick={() => handleInstall()}>
                    <IconTableDown />
                </ActionIcon>
                }
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
                        <Table.Th>Download</Table.Th>
                        <Table.Th>Install</Table.Th>
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
