"use client"; // Required for client-side fetching

import { Accordion, Card, Group, Button, AccordionProps } from '@mantine/core';
import { useEffect, useState } from "react";

interface CategoriesProps {
    apiPath: string;
    cardProps?: React.ComponentProps<typeof Card>;
    accordionProps?: React.ComponentProps<typeof Accordion>;
    setSelected: (value: string) => void;
}

function Categories({ apiPath, cardProps, accordionProps, setSelected }: CategoriesProps) {
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

    // console.log(data);

    return (
        <Card {...cardProps}>
            {loading ? <p>Loading...</p> : 
                <Accordion variant="separated" radius="lg" multiple {...accordionProps}>
                    {Object.entries(data).map(([key, item]) => (
                        <Accordion.Item key={key} value={item.title}>
                            <Accordion.Control>{item.title}</Accordion.Control>
                            <Accordion.Panel>
                                {item.description}
                                <div>
                                    <Group justify="center">
                                        {item.options.map((option, index) => (
                                            <Button key={index} style={{ margin: '5px' }} onClick={() => setSelected(option)}>
                                                {option}
                                            </Button>
                                        ))}
                                    </Group>
                                </div>
                            </Accordion.Panel>
                        </Accordion.Item>
                    ))}
                </Accordion>
            }
        </Card>
    );
}

export default Categories;
