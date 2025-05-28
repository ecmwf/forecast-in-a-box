
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client"; // Required for client-side fetching

import { Card, Button, Tabs, ScrollArea, Group, Title, Text, ActionIcon, Flex, Table, Loader, Progress, Menu, Burger} from '@mantine/core';
import { useEffect, useRef, useState } from "react";

import classes from './options.module.css';

import {IconX, IconCheck, IconRefresh, IconTableDown, IconTrash} from '@tabler/icons-react';
import {useApi} from '../../api';


interface OptionsProps {
    setSelected: (value: string) => void;
}

function SelectModel({ setSelected }: OptionsProps) {
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
            <Table highlightOnHover verticalSpacing="xs" className={classes['option-table']}>
                <Table.Thead>
                    <Table.Tr style={{ backgroundColor: "#f0f0f6", textAlign: "left" }}>
                        <Table.Th>Group</Table.Th>
                        <Table.Th>Model</Table.Th>
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
                                <Table.Tr key={`${key}_${value}`}>
                                    {index === 0 && (
                                        <Table.Td rowSpan={values.length} style={{ verticalAlign: 'top', fontWeight: 'bold' }}>
                                            {key}
                                        </Table.Td>
                                    )}
                                    <Button
                                        classNames={classes}
                                        onClick={() => setSelected(`${key}_${value}`)}
                                        variant='outline'
                                    >
                                        <Text size='sm' style={{'wordBreak': 'break-all', 'display':'flex'}}>{value}</Text>
                                    </Button>
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

export default SelectModel;
