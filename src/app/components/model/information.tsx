import React, { useEffect, useState } from 'react';
import { Card, Text } from '@mantine/core';

interface InformationProps {
    selected: string | null;
}
const InformationWindow: React.FC<InformationProps> = ({ selected }) => {
    const [information, setInformation] = useState<string | null>(null);

    useEffect(() => {
        if (selected) {
            fetch(`/api/py/models/info/${selected}`)
                .then((res) => res.json())
                .then((modelOptions) => {
                    setInformation(modelOptions);
                });
        }
    }, [selected]);

    console.log(information)

    if (!selected) {
        return (
            <Card shadow="" padding="md">
            <Card.Section>
                <h2>Information</h2>
                <p>Model Information</p>
            </Card.Section>
            </Card>
        )
    }
    return (
        <Card shadow="" padding="md">
            <Card.Section>
                <h2>Information</h2>
                <p>Model Information</p>
            </Card.Section>
            <h3>{selected}</h3>
            {information && Object.entries(information).map(([key, value]) => (
                <div key={key} style={{ marginBottom: '10px' }}>
                    <Text weight={500} style={{ display: 'inline-block', width: '150px' }}>{key}:</Text>
                    <Text style={{ display: 'inline-block' }}>{value}</Text>
                </div>
            ))}
        </Card>
    );
};

export default InformationWindow;