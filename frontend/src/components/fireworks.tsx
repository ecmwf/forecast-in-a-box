
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import React, { useEffect, useRef } from 'react';
import { Fireworks } from 'fireworks-js';

interface FireworksComponentProps {
  trigger: boolean;
  onComplete?: () => void;
}

const FireworksComponent: React.FC<FireworksComponentProps> = ({ trigger, onComplete }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const fireworksRef = useRef<Fireworks | null>(null);


  useEffect(() => {
  if (trigger && containerRef.current) {
    // Clean up any existing canvas content
    containerRef.current.innerHTML = '';

    // Create fireworks
    fireworksRef.current = new Fireworks(containerRef.current, {
        acceleration: 1.05,
        friction: 0.98,
        gravity: 1.5,
        particles: 200,
        intensity: 60,
        explosion: 10,
        sound: {
            enabled: true,
            volume: {min: 50, max: 100},
        },
      });
    fireworksRef.current.start();

    const timeout = setTimeout(() => {
      fireworksRef.current?.stop();
      onComplete?.();
    }, 5000);

    return () => {
      clearTimeout(timeout);
      fireworksRef.current?.stop();
    };
  }
}, [trigger, onComplete]);


  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none', // So it doesn't block user interaction
        zIndex: 9999
      }}
    />
  );
};

export default FireworksComponent;
