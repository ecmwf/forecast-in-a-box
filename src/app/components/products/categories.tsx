"use client"; // Required for client-side fetching

import { Card, Button, Tabs, Stack } from '@mantine/core';
import { useEffect, useState } from "react";

import classes from './categories.module.css';

interface CategoriesProps {
    apiPath: string;
    cardProps?: React.ComponentProps<typeof Card>;
    tabProps?: React.ComponentProps<typeof Tabs>;
    setSelected: (value: string) => void;
}

function Categories({ apiPath, cardProps, tabProps, setSelected }: CategoriesProps) {
    const [data, setData] = useState<{ title: string; description: string; options: string[] }[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(apiPath)
            .then((res) => res.json())
            .then((data) => {
                setData(data);
                setLoading(false);
            });
    }, []);

    console.log(data);

    return (
        <>
            {loading ? <p>Loading...</p> : 
            <Card padding='sm'>
                <Tabs orientation="vertical" classNames={classes} h='100%' {...tabProps}>
                    <Tabs.List>
                    {Object.entries(data).map(([key, item]) => (
                        <Tabs.Tab value={key}>{item.title}</Tabs.Tab>
                    ))}
                    </Tabs.List>

                    {Object.entries(data).map(([key, item]) => (
                        <Tabs.Panel value={key}>
                            <>
                                <p>{item.description}</p>
                                <Stack justify="center">
                                    {item.options.map((option, idx) => (
                                        <Button key={idx} style={{ margin: '5px' }} onClick={() => setSelected(option)}>
                                            {option}
                                        </Button>
                                    ))}
                                </Stack>
                            </>
                        </Tabs.Panel>
                    ))}
                </Tabs>
            </Card>
            }
        </>
    );
}

export default Categories;
