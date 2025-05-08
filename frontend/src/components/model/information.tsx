import React, { useEffect, useState } from 'react';
import { SimpleGrid, Text, Card, LoadingOverlay, Stack, Title, Paper} from '@mantine/core';

import {useApi} from '../../api';


interface InformationProps {
    selected: string | null;
}

function InformationWindow({ selected }: InformationProps) {
    const [information, setInformation] = useState<Record<string, any> | null>(null);
    const [loading, setLoading] = useState<boolean>(false);
    const api = useApi();
    

    useEffect(() => {
        if (selected) {
            setLoading(true);
            api.get(`/v1/model/${selected}/info`)
            .then((res) => {
                setInformation(res.data);
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
            });
        }
    }, [selected]);

    if (!selected) {
        return (
            <Card>
                <Card.Section>
                     <Title order={2}>Information</Title>
                </Card.Section>
                <Text>Select a model for information</Text>
            </Card>
        )
    }

    if (information && information.local_area) {
        const { local_area, ...rest } = information;
        setInformation(rest);
    }

    return (
        <Card>
            <Card.Section>
                 <Title order={2}>Information</Title>
            </Card.Section>
            
        <Title order={3} p=''>{selected}</Title>
            <LoadingOverlay visible={loading}/>
            <SimpleGrid cols={2}>

            {information && Object.entries(information).map(([key, value]) => (
                <Paper shadow="xs" p="xs" key={key}>
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
        </Card>
    );
};

export default InformationWindow;