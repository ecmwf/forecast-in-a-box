
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client"; // Required for client-side fetching
import React, { useState, useEffect } from 'react';
import { Card, Button, Modal, Group, TextInput, NumberInput, Divider, Text, Loader} from '@mantine/core';
import GlobeSelect from './globe';
import SelectModel from './select';
// import InformationWindow from './information';

import { ModelSpecification } from '../interface';
import {useApi} from '../../api';

interface ModelProps {
    selectedModel: ModelSpecification;
    coordinates: { lat: number; lon: number } | null;
    setCoordinates: (coords: { lat: number; lon: number } | null) => void;
    modelSpec: ModelSpecification;
    submit: (val: ModelSpecification) => void;
}

import { withTheme } from '@rjsf/core';
import { Theme } from '@rjsf/mui';

const Form = withTheme(Theme);

import validator from '@rjsf/validator-ajv8';
import { UiSchema } from '@rjsf/utils';

const uiSchemaforForm: UiSchema = {
  'ui:submitButtonOptions': {
    norender: true,
  },
};

function Model({ selectedModel, coordinates, setCoordinates, modelSpec, submit }: ModelProps) {
    const [model, setModel] = useState<string>(selectedModel.model);
    // const [modalOpened, setModalOpened] = useState(false);

    const [modelConfig, setModelConfig] = useState<any>(modelSpec || {});
    const [modelForm, setModelForm] = useState<any>(null);

    const api = useApi();

    // const handleGlobeSubmit = () => {
    //     if (coordinates) {
    //         console.log('Submitting location:', selectedModel);
    //         // Add your submission logic here
    //     } else {
    //         console.log('No location selected');
    //     }
    //     setModalOpened(false);
    // };

    const handleModelSubmit = () => {
        submit({ model: model, ...modelConfig });
    };
    const onSubmit = async (data: any) => {
        console.log('Submitting model configuration:', data);
        setModelConfig(data);
        handleModelSubmit();
    }


    const fetchControlMetadata = async () => {
        const result = await api.get(`/v1/model/${model.replace('/', '_')}/form`);
        console.log('Model form data:', result.data);
        const spec = await result.data;
        setModelForm(spec);
    }
    useEffect(() => {
        fetchControlMetadata();
    }, [model]);



    return (
        <Card padding="">
            <SelectModel selected={model} setSelected={setModel} />
            <Divider my="md" />
            {/* <InformationWindow selected={model} /> */}

            {/* {showGlobeSelect && (
                <Group>
                    <Button onClick={() => setModalOpened(true)}>Open Globe</Button>
                    <Text>This does nothing at the moment, but shows how LAM's could be configured.</Text>
                    <Group>
                        {coordinates && (
                            <>
                                <p>Latitude: {coordinates.lat}</p>
                                <p>Longitude: {coordinates.lon}</p>
                            </>
                        )}
                    </Group>
                </Group>
            )} */}
            {/* <Modal
                opened={modalOpened}
                onClose={() => setModalOpened(false)}
                title="Select centre of LAM"
                size="auto"
            >
                <GlobeSelect handleSubmit={handleGlobeSubmit} setSelectedLocation={setCoordinates} globeProps={{ width: 600, height: 450 }} />
            </Modal> */}

            {/* Form for setting variables */}
            {model && modelForm && modelForm.jsonSchema ? (
                <Form
                    schema={modelForm.jsonSchema}
                    uiSchema={{ ...modelForm.uiSchema, ...uiSchemaforForm }}
                    validator={validator}
                    formData={modelSpec}
                    onSubmit={(e) => { onSubmit(e.formData); }}
                    onChange={(e) => { setModelConfig(e.formData); }}
                    showErrorList={"bottom"}
                    omitExtraData={true}
                    />
            ) : (
                <>
                    {/* <Text>Loading model...</Text>
                    <Loader/> */}
                </>
            )}

            {/* <Button onClick={handleModelSubmit} disabled={!model} mt="md">
                Continue
            </Button> */}
        </Card>
    );
}

export default Model;
