
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
import { Card, Button, Modal, Group, TextInput, NumberInput, Divider, Text} from '@mantine/core';
import GlobeSelect from './globe';
import SelectModel from './select';
import InformationWindow from './information';

import { ModelSpecification } from '../interface';
import {useApi} from '../../api';

interface ModelProps {
    selectedModel: ModelSpecification;
    coordinates: { lat: number; lon: number } | null;
    setCoordinates: (coords: { lat: number; lon: number } | null) => void;
    modelSpec: ModelSpecification;
    submit: (val: ModelSpecification) => void;
}


function Model({ selectedModel, coordinates, setCoordinates, modelSpec, submit }: ModelProps) {
    const [model, setModel] = useState<string>(selectedModel.model);
    const [modalOpened, setModalOpened] = useState(false);
    const [showGlobeSelect, setShowGlobeSelect] = useState(false);
    const api = useApi();
    

    // State for form inputs
    const [date, setDate] = useState<string | null>(selectedModel.date || null);
    const [leadTime, setLeadTime] = useState<number>(selectedModel.lead_time || 72);
    const [ensembleMembers, setEnsembleMembers] = useState<number>(selectedModel.ensemble_members || 1);

    const handleGlobeSubmit = () => {
        if (coordinates) {
            console.log('Submitting location:', selectedModel);
            // Add your submission logic here
        } else {
            console.log('No location selected');
        }
        setModalOpened(false);
    };

    const handleModelSubmit = () => {
        submit({ model: model, date: date, lead_time: leadTime, ensemble_members: ensembleMembers });
    };

    useEffect(() => {
        if (model) {
            api.get(`/v1/model/${model.replace('/', '_')}/info`)
                .then((res) => res.data)
                .then((modelOptions) => {
                    if (modelOptions.local_area) {
                        setShowGlobeSelect(true);
                    } else {
                        setShowGlobeSelect(false);
                    }
                });
        }
    }, [model]);

    return (
        <Card padding="">
            <SelectModel setSelected={setModel} />
            <Divider my="md" />
            <InformationWindow selected={model} />

            {showGlobeSelect && (
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
            )}
            <Modal
                opened={modalOpened}
                onClose={() => setModalOpened(false)}
                title="Select centre of LAM"
                size="auto"
            >
                <GlobeSelect handleSubmit={handleGlobeSubmit} setSelectedLocation={setCoordinates} globeProps={{ width: 600, height: 450 }} />
            </Modal>

            {/* Form for setting variables */}
            <Card padding="md" mt="md">
                <h2>Model Parameters</h2>
                <TextInput
                    label="Date"
                    placeholder="YYYYMMDD"
                    value={date || ""}
                    onChange={(event) => setDate(event.currentTarget.value)}
                />
                <NumberInput
                    label="Lead Time (hours)"
                    value={leadTime}
                    onChange={(value) => setLeadTime(value)}
                    min={0}
                />
                <NumberInput
                    label="Ensemble Members"
                    value={ensembleMembers}
                    onChange={(value) => setEnsembleMembers(value)}
                    min={1}
                    max={51}
                />
            </Card>

            <Button onClick={handleModelSubmit} disabled={!model || !date} mt="md">
                Continue
            </Button>
        </Card>
    );
}

export default Model;