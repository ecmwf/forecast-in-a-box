"use client"; // Required for client-side fetching

import { Card, Button, Tabs, ScrollArea, Paper, Text} from '@mantine/core';
import { useEffect, useState } from "react";

import classes from './options.module.css';

interface OptionsProps {
    cardProps?: React.ComponentProps<typeof Card>;
    tabProps?: React.ComponentProps<typeof Tabs>;
    setSelected: (value: string) => void;
}

function Options({ cardProps, tabProps, setSelected }: OptionsProps) {
    const [modelOptions, setData] = useState<Record<string, string[]>>();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/py/models/available')
            .then((res) => res.json())
            .then((modelOptions) => {
                setData(modelOptions);
                setLoading(false);
            });
    }, []);

    console.log(modelOptions);

    return (
         <Card {...cardProps} padding=''>
            <Card.Section>
                <h2>Models</h2>
                <p>Please choose a model</p>
            </Card.Section>
            {loading ? <p>Loading...</p> : 
            <ScrollArea>
            {modelOptions && Object.entries(modelOptions).map(([key, values]) => (
                <Paper shadow='sm' className={classes['option-group']}>
                    <Text className={classes['heading']}>{key}</Text>
                    <Paper p='sm' className={classes['option-list']}>
                    {values.map((value: string) => (
                        <Button className={classes['button']} key={value} onClick={() => setSelected(value)}>{value}</Button>
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
