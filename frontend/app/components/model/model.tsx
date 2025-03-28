"use client"; // Required for client-side fetching
import React, { useState, useEffect } from 'react';
import { Card, Button, Modal, Group, TextInput, NumberInput } from '@mantine/core';
// import GlobeSelect from './globe';
import Options from './options';
import InformationWindow from './information';

import { ModelSpecification } from '../interface';

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
        console.log('Submitting model:', model);
        submit({ model: model, date: date, lead_time: leadTime, ensemble_members: ensembleMembers });
    };

    useEffect(() => {
        if (model) {
            fetch(`/api/py/models/info/${model}`)
                .then((res) => res.json())
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
            <Group justify="space-between" grow align="flex-start">
                <Options cardProps={{ w: '30vw' }} setSelected={setModel} />
                <Card padding="md">
                    <h2>Information</h2>
                    <InformationWindow selected={model} />
                </Card>
            </Group>

            {showGlobeSelect && (
                <Group>
                    <Button onClick={() => setModalOpened(true)}>Open Globe</Button>
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
                {/* <GlobeSelect handleSubmit={handleGlobeSubmit} setSelectedLocation={setCoordinates} globeProps={{ width: 600, height: 450 }} /> */}
            </Modal>

            {/* Form for setting variables */}
            <Card padding="md" mt="md">
                <h2>Model Parameters</h2>
                <TextInput
                    label="Date"
                    placeholder="YYYYMMDD"
                    value={date}
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
                />
            </Card>

            <Button onClick={handleModelSubmit} disabled={!model || !date} mt="md">
                Submit
            </Button>
        </Card>
    );
}

export default Model;