
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

'use client';
import { Container, Space, Title, Text, Button, Card, Grid, Group, Alert, Center } from '@mantine/core';

import classes from './blurb.module.css';


const Blurb = () => {

    return (
        <Container fluid classNames={classes}>
            <Container size="lg">
            <Space h="xl" />

                <Center>
                    <Text size="md" style={{ color: "white" }}>
                        Forecast-In-A-Box is a prototype AI solution concept piloted by ECMWF, through an effort jointly funded by <a href="https://destination-earth.eu/" target="_blank" rel="noopener noreferrer" style={{ color: "#4dabf7" }}>Destination Earth</a> and ECMWF core activities. It showcases a way to containerise and package complete AI-based forecasting pipelines, bringing together ECMWF's open-source software and AI models — such as anemoi, EarthKit, AIFS, PProc and other components of the ECMWF stack — to cover all stages of the forecasting process, from using data inputs from ECMWF's analyses to the execution of AI models, post-processing, and visualisation.
                        It allows to run any model that subscribes to the Anemoi-Inference interface.
                        For more information read: <a href="https://destine.ecmwf.int/news/forecast-in-a-box-portable-ai-forecasting-workflows-within-the-destine-digital-twin-engine/" target="_blank" rel="noopener noreferrer" style={{ color: "#4dabf7" }}>AI-driven solutions for the Digital Twin Engine</a>.
                    </Text>
                </Center>
            </Container>

            <Space h="md" />
            <Space h="xl" />

            {/* <Divider color="#424270" /> */}
        </Container>
    )
}

export default Blurb;
