"use client"; // Required for client-side fetching
import React, { useState, useEffect } from 'react';
import { Card, Button, Modal, Group } from '@mantine/core';
import GlobeSelect from './globe';
import Options from './options';
import InformationWindow from './information';

interface ModelProps {
    selectedModel: string | null;
    setSelectedModel: (value: string | null) => void;
    coordinates: {lat: number, lon: number} | null;
    setCoordinates: (coords: {lat: number, lon: number} | null) => void;
    submit: () => void;
}
const Model: React.FC<ModelProps> = ({ selectedModel, setSelectedModel, coordinates, setCoordinates, submit }) => {
    
    const [showGlobeSelect, setShowGlobeSelect] = useState(false);
    const [modalOpened, setModalOpened] = useState(false);

    const handleGlobeSubmit = () => {
        if (coordinates) {
            console.log('Submitting location:', selectedModel);
            // Add your submission logic here
        } else {
            console.log('No location selected');
        }
        setModalOpened(false);
    };

    useEffect(() => {
        if (selectedModel) {
            fetch(`/api/py/models/info/${selectedModel}`)
                .then((res) => res.json())
                .then((modelOptions) => {
                    if (modelOptions.local_area) {
                        setShowGlobeSelect(true);
                    } else {
                        setShowGlobeSelect(false);
                    }
                });
        }
    }, [selectedModel]);


    return (
        <Card padding=''>
            <Group justify="space-between" grow align="flex-start">
                <Options cardProps={{w: '30vw' }} setSelected={setSelectedModel}/>
                <InformationWindow selected={selectedModel}/>
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
                size='auto'
            >
                <GlobeSelect handleSubmit={handleGlobeSubmit} setSelectedLocation={setCoordinates} globeProps={{ width: 600, height: 450 }}/>
            </Modal>
            <Button onClick={submit} disabled={!selectedModel}>Submit</Button>
        </Card>
    );
};

export default Model;