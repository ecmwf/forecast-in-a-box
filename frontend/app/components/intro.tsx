'use client';
import React, { useState } from 'react';
import { Container, Space, Title, Text, Button, Card, Grid, Group, Divider, Center } from '@mantine/core';

import Globe from './intro_globe';

import classes from './intro.module.css';


const Intro = () => {

    const [showGlobe, setShowGlobe] = useState(true);

    return (
        <Container fluid classNames={classes}>
            <Divider color="#424270" />
            <Container size="lg">
            <Space h="xl" />
            <Space h="xl" />
                <Grid gutter={50}>
                <Grid.Col span={6}>
                <Group>
                    <Group gap={10} wrap="nowrap">
                        <Title style={{color: "white"}} size={40}>
                            Product generation on the fly, for any Anemoi model
                        </Title>
                    </Group>
                    {/* <Space h="sm" /> */}
                    <Text size="xl" style={{color: "white"}}>
                        Forecast-In-A-Box streamlines any product generation tasks allowing {' '}
                        <strong style={{color: "#6DABFF"}}>any</strong> forecaster to get 
                        the data they need, when they need it.
                    </Text>
                    <Space h="md" />
                </Group>
                <Center>
                     <a href='/products'>
                    <Button color="#6DABFF" variant="outline" radius={"lg"} size={"xl"}><Title order={2} style={{color: "#6DABFF"}}>Get Started</Title></Button>
                    </a>
                    
                </Center>
                <Space h="xl" />
                </Grid.Col>
                <Grid.Col span={6}>
                    <Globe showGlobe={showGlobe} setShowGlobe={setShowGlobe} />
                </Grid.Col>
                </Grid>
            </Container>
            <Space h="md" />
            <Space h="xl" />
            
            {/* <Divider color="#424270" /> */}
        </Container>
    )
}

export default Intro;