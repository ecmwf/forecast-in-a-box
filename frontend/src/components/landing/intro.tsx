
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

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
                <Grid.Col span={{ base: 12, sm: 12, md: 6, xl: 6 }}>
                <Group>
                    <Group gap={10} wrap="nowrap">
                        <Title style={{color: "white"}} size={40}>
                            Product generation on the fly, for any Anemoi model
                        </Title>
                    </Group>
                    {/* <Space h="sm" /> */}
                    <Text size="xl" style={{color: "white"}}>
                        Forecast-In-A-Box streamlines the product generation task allowing {' '}
                        <strong style={{color: "#6DABFF"}}>any</strong> user to get weather predictions
                        where they need it, when they need it.
                    </Text>
                    {/* <Text size="md" style={{color: "white"}}>
                        With a simple and intuitive interface, users can easily create many products,

                        "Whatever works for you"
                    </Text> */}
                    <Space h="md" />
                </Group>
                <Center>
                     <a href='/products'>
                        <Button color="#6DABFF" variant="outline" radius={"lg"} size={"xl"}><Title order={2} style={{color: "#6DABFF"}}>Get Started</Title></Button>
                    </a>

                </Center>
                <Space h="lg" />
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 12, md: 6, xl: 6 }}>
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
