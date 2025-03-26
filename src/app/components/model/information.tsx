import React, { useEffect, useState } from 'react';
import { SimpleGrid, Flex, Divider, LoadingOverlay, Text, Stack, Title, Paper} from '@mantine/core';


import {ModelSpecification} from '../interface'


interface InformationProps {
    selected: string | null;
}

function InformationWindow({ selected }: InformationProps) {
    const [information, setInformation] = useState<string | null>(null);
    const [loading, setLoading] = useState<boolean>(false);

    useEffect(() => {
        if (selected) {
            setLoading(true);
            fetch(`/api/py/models/info/${selected}`)
                .then((res) => res.json())
                .then((modelOptions) => {
                    setInformation(modelOptions);
                    setLoading(false);
                })
                .catch(() => {
                    setLoading(false);
                });
        }
    }, [selected]);

    console.log(information)

    if (!selected) {
        return (
                <p>Select a model for information</p>
        )
    }

    if (information && information.local_area) {
        const { local_area, ...rest } = information;
        setInformation(rest);
    }

    return (
        <>
            <Title order={3} p=''>{selected}</Title>
            <LoadingOverlay visible={loading}/>
            {/* <Stack mih={50}
                gap="xs"
                justify="flex-start"
                align="stretch"
            > */}
            <SimpleGrid cols={1}>

            {information && Object.entries(information).map(([key, value]) => (
                <Paper shadow="xs" p="xs">
                    <Title order={5}>{key}:</Title>
                    {typeof value === 'object' && !Array.isArray(value) && value !== null ? (
                        <Stack maw='80%' style={{ marginLeft: '10px' }} gap='xs'>
                            {Object.entries(value).map(([subKey, subValue]) => (
                                <Text p='' m='' key={subKey} lineClamp={3}>{subKey}: {JSON.stringify(subValue, null, 2)}</Text>
                            ))}
                        </Stack>
                    ) : (
                        <Text maw='80%' lineClamp={3} style={{ marginLeft: '10px' }}>{JSON.stringify(value, null, 2)}</Text>
                    )}
                </Paper>
            ))}
            </SimpleGrid>
            {/* </Stack> */}
        </>
    );
};

export default InformationWindow;