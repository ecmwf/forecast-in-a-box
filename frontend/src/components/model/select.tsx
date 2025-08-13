
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client"; // Required for client-side fetching

import { Card, Button, Tabs, ScrollArea, Group, Title, Text, ActionIcon, Flex, Table, Loader, Progress, Menu, Burger, Space, Divider} from '@mantine/core';
import { useEffect, useRef, useState } from "react";

import classes from './manage.module.css';

import {IconX, IconCheck, IconRefresh, IconTableDown, IconTrash} from '@tabler/icons-react';
import {useApi} from '../../api';


interface OptionsProps {
    selected: string;
    setSelected: (value: string) => void;
}

function SelectModel({ selected, setSelected }: OptionsProps) {
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
        <Card padding="">
            <Card.Section>
                <Flex gap='lg'>
                    <Title order={2}>Models</Title>
                    <ActionIcon onClick={fetchModelOptions} style={{ display: 'inline' }}>
                        <IconRefresh/>
                    </ActionIcon>
                </Flex>
            </Card.Section>
            {loading ? <p>Loading...</p> :
            <ScrollArea>
                {!modelOptions || Object.keys(modelOptions).length === 0 ? (
                    <Text p="center" mt="md">No models available.</Text>
                ) : (
                    Object.entries(modelOptions).map(([group, models]) => (
                        <div key={group} style={{ marginBottom: 24 }}>
                            <Title order={3} mb="xs">{group}</Title>
                            <Divider mb="md" />
                            <Flex gap="md" wrap="wrap">
                                {models.map((model) => (
                                    <Card
                                        key={`${group}_${model}`}
                                        shadow="sm"
                                        padding="md"
                                        radius="md"
                                        withBorder
                                        className={`${classes['option-card']} ${selected === `${group}_${model}` ? classes['selected'] : ''}`} style={{ minWidth: 200, maxWidth: 300 }}

                                        onClick={() => setSelected(`${group}_${model}`)}
                                    >
                                        <Title order={4}>
                                            {model}
                                        </Title>
                                        <Card.Section>
                                            <Space h="md" />
                                        </Card.Section>
                                    </Card>
                                ))}
                            </Flex>
                        </div>
                    ))
                )}
            </ScrollArea>
            }
        </Card>
    );
}

export default SelectModel;
