"use client"; // Required for client-side fetching

import React, { useState, useEffect, useCallback } from 'react';
import Globe from 'react-globe.gl';
import { Card, Button, NumberInput, Flex } from '@mantine/core';
import classes from './globe.module.css';

const ARC_REL_LEN = 0.4; // relative to whole arc
const FLIGHT_TIME = 2000;
const NUM_RINGS = 4;
const RINGS_MAX_R = 2; // deg
const RING_PROPAGATION_SPEED = 3; // deg/sec


interface GlobeSelectProps {
    handleSubmit: () => void;
    setSelectedLocation: (location: { lat: number; lon: number }) => void;
    cardProps?: React.ComponentProps<typeof Card>;
    globeProps?: React.ComponentProps<typeof Globe>;
}

const GlobeSelect: React.FC<GlobeSelectProps> = ({ handleSubmit, setSelectedLocation, cardProps, globeProps }) => {
    const [ringsData, setRingsData] = useState([]);
    const [markerData, setMarkerData] = useState([]);

    const [latitude, setLatitude] = useState<number>(0);
    const [longitude, setLongitude] = useState<number>(0);

    const markLocation = useCallback((coords: { lat: any; lng: any; }) => {
        const { lat: startLat, lng: startlon } = coords;

        // add and remove start rings
        const srcRing = { lat: startLat, lng: startlon };
        setRingsData(curRingsData => [...curRingsData, srcRing]);
        setTimeout(() => setRingsData(curRingsData => curRingsData.filter(r => r !== srcRing)), FLIGHT_TIME * ARC_REL_LEN);

        const currentMarker = { lat: startLat, lng: startlon, size: 30, color: 'red' };
        setMarkerData(curMarkerData => [...curMarkerData, currentMarker]);
        setMarkerData(curMarkerData => curMarkerData.filter(marker => marker === currentMarker));

        setLatitude(startLat);
        setLongitude(startlon);
        
    }, []);

    // Handlers for changing the latitude and longitude
    const handleLatChange = (e: number) => {
        const newLat = e;
        setLatitude(newLat);
        if (!isNaN(newLat) && !isNaN(longitude)) {
            markLocation({ lat: newLat, lng: longitude });
        }
    };

    const handlelonChange = (e: number) => {
        const newlon = e;
        setLongitude(newlon);
        if (!isNaN(newlon) && !isNaN(latitude)) {
            markLocation({ lat: latitude, lng: newlon });
        }
    };
    
    const handleSubmitClick = () => {
        if (latitude && longitude) {
            setSelectedLocation({ lat: parseFloat(latitude.toString()), lon: parseFloat(longitude.toString()) });
            handleSubmit();
        }
    };

    const filterEvents = (e) => {
        // Filter out polygon clicks
        return true;
    }


    // Countries
    const [countries, setCountries] = useState({ features: []});

    useEffect(() => {
      // load data
        fetch('/globe/ne_110m_countries.geojson').then(res => res.json()).then(setCountries);
    }, []);

    const markerSvg = `<svg viewBox="2 0 24 24" width="37" height="36" xmlns="http://www.w3.org/2000/svg" style="display: block; margin: auto;">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="10" fill="none" />
        <line x1="12" y1="2" x2="12" y2="6" stroke="currentColor" strokeWidth="4" />
        <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="4" />
        <line x1="2" y1="12" x2="6" y2="12" stroke="currentColor" strokeWidth="4" />
        <line x1="18" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="4" />
    </svg>`;


    return (
        <Card className={classes['globe-container']} {...cardProps}>
            <Card.Section>
                <Globe
                    {...globeProps}
                    globeTileEngineUrl={(x: number, y: number, z: number) => `https://cdn.lima-labs.com/${z}/${x}/${y}.png?api=demo`}
                    // globeTileEngineUrl={(x: number, y: number, l: number) => `https://tile.openstreetmap.org/${l}/${x}/${y}.png`}
                    globeImageUrl="/globe/earth-blue-marble.jpg"
                    backgroundColor="#ffffff"
                    onGlobeClick={markLocation}

                    pointerEventsFilter={filterEvents}

                    onPolygonClick={markLocation}
                    // polygonsData={countries.features.filter(d => d.properties.ISO_A2 !== 'AQ')} // Issues with clicking on the polygons not the map
                    polygonSideColor={() => 'rgba(0, 100, 0, 0.15)'}
                    polygonAltitude={-0.0001}
                    polygonStrokeColor={() => 'rgba(255, 255, 255, 0.5)'}
                    polygonCapColor={() => 'rgba(0, 100, 0, 0)'}

                    // pointOfView = {{ lat: 54.5260, lng: 15.2551, altitude: 3 }} // Not working
                    
                    ringsData={ringsData}
                    ringColor={() => t => `rgba(255,255,255,${1-t})`}
                    ringMaxRadius={RINGS_MAX_R}
                    ringPropagationSpeed={RING_PROPAGATION_SPEED}
                    ringRepeatPeriod={FLIGHT_TIME * ARC_REL_LEN / NUM_RINGS}
                    htmlElementsData={markerData}
                    htmlElement={d => {
                        const el = document.createElement('div');
                        el.innerHTML = markerSvg;
                        el.style.color = d.color;
                        el.style.width = `${d.size}px`;
                        el.style.transition = 'opacity 250ms';

                        el.style['pointer-events'] = 'auto';
                        el.style.cursor = 'pointer';
                        el.onclick = () => console.info(d);
                        return el;
                    }}
                    htmlElementVisibilityModifier={(el, isVisible) => el.style.opacity = isVisible ? 1 : 0}
                />
            </Card.Section>

            <Card.Section p='sm'>
                <Flex justify='center' gap='xl'>
                <NumberInput
                    label="Latitude"
                    value={latitude}
                    onChange={handleLatChange}
                    // className={classes['coordinate-input']}
                    decimalScale={3}
                    min={-90}
                    max={90}
                    stepHoldDelay={500}
                    stepHoldInterval={100}
                />
                <NumberInput
                    label="Longitude"
                    value={longitude}
                    onChange={handlelonChange}
                    // className={classes['coordinate-input']}
                    decimalScale={3}
                    min={-180}
                    max={180}
                    stepHoldDelay={500}
                    stepHoldInterval={100}
                />
                </Flex>
            </Card.Section>

            <Button onClick={handleSubmitClick} className={classes['submit-button']}>Submit Location</Button>
        </Card>
    );
};

export default GlobeSelect;