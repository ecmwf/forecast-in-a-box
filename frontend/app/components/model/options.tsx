"use client"; // Required for client-side fetching

import { Card, Button, Tabs, ScrollArea, Paper, Title, Text, ActionIcon, Flex, SimpleGrid} from '@mantine/core';
import { useEffect, useState } from "react";

import classes from './options.module.css';

import {IconDownload, IconCheck, IconRefresh} from '@tabler/icons-react';


function ModelButton({ model, setSelected }: { model: string; setSelected: (value: string) => void }) {
    const [downloaded, setDownloaded] = useState<boolean>(false);
    const [downloading, setDownloading] = useState<boolean>(false);
    console.log(model, downloaded);

    useEffect(() => {
        const fetchDownloaded = async () => {
            const result = await fetch(`/api/py/models/downloaded/${model}`);
            setDownloaded(await result.json());
        };
        fetchDownloaded();
    }, [model]);

    const handleDownload = () => {
        console.log('Download', model);
        setDownloading(true);
        const download = async () => {
            const result = await fetch(`/api/py/models/download/${model}`);
            console.log('Downloaded:', result.json());
            setDownloaded(true);
            setDownloading(false);
        };
        download();
    };

    return downloaded ? (
        <Paper className={classes['option']} m="xs" p="">
            <IconCheck color="green" />
            <Button
                className={classes['button']}
                onClick={() => setSelected(model)}
            >
                {model}
            </Button>
        </Paper>
    ) : (
        <Paper className={classes['option']} m="xs" p="">
            <ActionIcon disabled={downloading} onClick={() => handleDownload()}>
                <IconDownload />
            </ActionIcon>
            <Button
                className={`${classes['button']} ${classes['button--disabled']}`}
                disabled
            >
                {model} 
                {downloading && <Text>   -  Loading...</Text>}
            </Button>
        </Paper>
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
            <ScrollArea>
            {modelOptions && Object.entries(modelOptions).map(([key, values]) => (
                <Paper shadow='' className={classes['option-group']} key={key}>
                    <Text className={classes['heading']}>{key}</Text>
                    <Paper p='sm' className={classes['option-list']}>
                    {values.map((value: string) => (
                        <ModelButton key={value} model={`${key}_${value}`} setSelected={setSelected} />
                    ))}
                </Paper>
            </Paper>
            ))}
            </ScrollArea>
            }
        </Card>
    );
}

export default Options;
