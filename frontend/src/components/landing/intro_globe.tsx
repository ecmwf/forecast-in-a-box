
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

'use client';

import ReactGlobe from 'react-globe.gl';

import React, { useRef, useEffect, useState} from 'react';

import * as THREE from 'three';
import { Button, Group, Center, ActionIcon, Space, Tooltip} from '@mantine/core';

import points from '../reduced-gg-points.json'
import coastlinesHigh from '../coastlines-low.json';

const globeMaterial = new THREE.MeshBasicMaterial();
const defaultPOV = { lat: 52, lng: 16, altitude: 1.4 };

const FRAME_WIDTH = 600;  // Adjust based on your image dimensions
const FRAME_HEIGHT = 300;
const COLUMNS = 20;  // Matches the number of columns in the sprite sheet
const TOTAL_FRAMES = 280;


const processCoastlines = (data) => {


  let paths = [];
  data.features.forEach(({ geometry, properties }) => {
    if (geometry.type === "MultiLineString") {
      // For MultiLineString, each array inside coordinates is a separate line segment
      geometry.coordinates.forEach(segment => {
        paths.push({
          coords: segment, // Directly use the segment without further flattening
          properties
        });
      });
    } else {
      // Handle simple LineString (not provided in your example, but just in case)
      paths.push({
        coords: geometry.coordinates,
        properties
      });
    }
  });
  return paths;
};

const SimpleGlobe = ({showGlobe, setShowGlobe}) => {
  const [mode, setMode] = useState("gridcells");
  const globeEl = useRef(null);
  const canvasRef = useRef(null);
  const coastlines = processCoastlines(coastlinesHigh);
  const [globeReady, setGlobeReady] = useState(false);
  const [spriteSheet, setSpriteSheet] = useState(null);
  const [index, setIndex] = useState(0);
  const [globeImageUrl, setGlobeImageUrl] = useState("");

  useEffect(() => {
    const img = new Image();
    img.src = "./era5/sprite_sheet.png";  // Load the sprite sheet
    img.onload = () => {
      setSpriteSheet(img);
    };
  }, []);

  useEffect(() => {
    // function to disable zoom and set the globe rotation
    const initializeGlobe = () => {
      const globe = globeEl.current;
      if (globe && globe.controls) {
        const controls = globe.controls();
        
        controls.autoRotate = true;
        controls.autoRotateSpeed = 2;
        controls.enableZoom = false;

        globe.pointOfView(defaultPOV);

        setGlobeReady(true); // Mark the globe as ready
      }
    };

    // continuously try to set the globe to rotate
    // once the globe is available, stop
    const interval = setInterval(() => {
      initializeGlobe();
      if (globeReady) {
        clearInterval(interval);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [globeReady]);

  useEffect(() => {
    if (!spriteSheet) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const updateFrame = () => {
      const col = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);

      ctx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);  // Clear previous frame
      ctx.drawImage(
        spriteSheet,
        col * FRAME_WIDTH,
        row * FRAME_HEIGHT,
        FRAME_WIDTH,
        FRAME_HEIGHT,
        0,
        0,
        FRAME_WIDTH,
        FRAME_HEIGHT
      );

    };

    updateFrame();
        const interval = setInterval(() => {
      setIndex((prevIndex) => (prevIndex + 1) % TOTAL_FRAMES);
    }, 25);

    return () => clearInterval(interval);
  }, [spriteSheet, index]);


  return (
    <>
    <canvas ref={canvasRef} width={FRAME_WIDTH} height={FRAME_HEIGHT}  style={{ display: "none"}}/>
    <Center>
      </Center>
      <Space h="md" />
      <Center>
      <div style={{ position: 'relative', width: 400, height: 400 }}>
        <ReactGlobe
          ref={globeEl}
          pathsData={coastlines}
          pathPoints="coords"
          pathPointLat={p => p[1]}
          pathPointLng={p => p[0]}
          pathPointAlt={0.001}
          pathColor={() => '#222'}
          pathStroke={0.5}
          pathTransitionDuration={0}
          globeImageUrl={canvasRef.current ? canvasRef.current.toDataURL() : ""}
          globeMaterial={globeMaterial}
          // pointsData={points}
          // pointLat="lat"
          // pointLng="lon"
          // pointColor={() => "#dedede"}
          backgroundColor="#ffffff00"
          showAtmosphere={false}
          atmosphereColor="#3366ff"
          width={400}
          height={400}
          atmosphereAltitude={0.1}
          pointAltitude={0}
        />
  
        {/* Floating Action Icon in Bottom-Right */}
      </div>
      </Center>
      </>
  );
  
}

export default SimpleGlobe;