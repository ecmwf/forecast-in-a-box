import React, { useEffect, useState } from 'react';
import { Card, LoadingOverlay, Text, Stack, Title, Paper} from '@mantine/core';

interface InformationProps {
    selected: string | null;
}
const InformationWindow: React.FC<InformationProps> = ({ selected }) => {
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
            <Card shadow="" padding="md">
            <Card.Section>
                <h2>Information</h2>
                <p>Select a model for information</p>
            </Card.Section>
            </Card>
        )
    }

    if (information && information.local_area) {
        const { local_area, ...rest } = information;
        setInformation(rest);
    }

    return (
        <Card shadow="" padding="xs">
            <Card.Section>
                <h2>Information</h2>
                {/* <p>Model Information</p> */}
            </Card.Section>
            <Title order={3} p=''>{selected}</Title>
            <LoadingOverlay visible={loading}/>
            <Stack mih={50}
                gap="xs"
                justify="flex-start"
                align="stretch"
            >
            {information && Object.entries(information).map(([key, value]) => (
                <Paper style={{ display: 'flex'}} shadow="xs" p="xs">
                    <Title w='100px' order={5} style={{ display: 'inline-block', width: '150px' }}>{key}:</Title>
                    {typeof value === 'object' && !Array.isArray(value) && value !== null ? (
                        <Stack maw='80%' style={{ marginLeft: '10px' }}>
                            {Object.entries(value).map(([subKey, subValue]) => (
                                <Text p='' m='' key={subKey} lineClamp={3}>{subKey}: {JSON.stringify(subValue, null, 2)}</Text>
                            ))}
                        </Stack>
                    ) : (
                        <Text maw='80%' lineClamp={3} style={{ marginLeft: '10px' }}>{JSON.stringify(value, null, 2)}</Text>
                    )}
                </Paper>
            ))}
            </Stack>
        </Card>
    );
};

export default InformationWindow;