import React, { useRef, useEffect, useState } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import ImageLayer from 'ol/layer/Image.js';
import ImageStatic from 'ol/source/ImageStatic.js';
import TileLayer from 'ol/layer/Tile.js';
import TileWMS from 'ol/source/TileWMS.js';
import { getCenter } from 'ol/extent.js';
import { get as getProjection, transform, transformExtent } from 'ol/proj.js';
import { register } from 'ol/proj/proj4.js';
import proj4 from 'proj4';
import 'ol/ol.css';
import { Loader, Center, Container } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

// Register EPSG codes via proj4
proj4.defs('EPSG:3995', '+proj=stere +lat_0=90 +lat_ts=70 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:3031', '+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs');
proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +units=m +datum=ETRS89 +no_defs');
register(proj4 as any);

const extentsByProjection: Record<string, number[]> = {
  'EPSG:4326': [-180, -90, 180, 90],
  'EPSG:3857': [-20037508.34, -20037508.34, 20037508.34, 20037508.34],
  'EPSG:3995': [-9000000, -9000000, 9000000, 9000000],
  'EPSG:3031': [-9000000, -9000000, 9000000, 9000000], // covers Antarctica in Stereographic
  'EPSG:3035': [900000, 100000, 9000000, 7400000], // covers Europe in LAEA
};

export default function StaticImageMap({
  globeImageUrl,
  targetProjection = 'EPSG:4326',
}: {
  globeImageUrl: string;
  targetProjection?: string;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [doubleImageUrl, setDoubleImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false); // 🔄 Loading state
  const [center, setCenter] = useState<number[] | undefined>(undefined);
  const [zoom, setZoom] = useState<number | undefined>(undefined);


  const mobileMode = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    if (!globeImageUrl) return;
    setLoading(true); // 🔄 Start loading

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      ctx.drawImage(img, img.width, 0);
      setDoubleImageUrl(canvas.toDataURL());
      setLoading(false); // ✅ Done loading
    };
    img.src = globeImageUrl;
  }, [globeImageUrl]);

  const lastProjectionRef = useRef<string>(targetProjection);

  useEffect(() => {
    // if (!mapRef.current || !doubleImageUrl) return;

    const sourceProjection = 'EPSG:4326';
    const projection = getProjection(targetProjection);
    if (!projection) return;

    const imageExtent = [-540, -90, 180, 90];

    const imageLayer = new ImageLayer({
        source: new ImageStatic({
        url: doubleImageUrl,
        imageExtent,
        projection: sourceProjection,
        interpolate: false,
        }),
    });

  const coastlines = new TileLayer({
    source: new TileWMS({
      url: 'https://era-explorer.ecmwf-development.f.ewcloud.host/geoserver/wms?',
      params: {
        LAYERS: 'ne:coastlines',
        STYLES: 'era:matt_boundaries_white',
        FORMAT: 'image/png',
        TRANSPARENT: true,
        VERSION: '1.1.1',
        SRS: targetProjection,
      },
      projection: targetProjection,
      serverType: 'geoserver',
      transition: 0,
    }),
    opacity: 1,
  });

  const transformedExtent = extentsByProjection[targetProjection];

  // Reset zoom/center immediately if projection changed
  const projectionChanged = lastProjectionRef.current !== targetProjection;
  lastProjectionRef.current = targetProjection;

  const view = new View({
    projection,
    center: projectionChanged
      ? getCenter(transformedExtent)
      : center ?? getCenter(transformedExtent),
    zoom: projectionChanged
      ? (targetProjection === 'EPSG:3857' ? 1 : 2)
      : zoom ?? (targetProjection === 'EPSG:3857' ? 1 : 2),
    extent: transformedExtent,
  });

  const map = new Map({
    target: mapRef.current,
    layers: [imageLayer, coastlines],
    view,
    controls: mobileMode ? [] : undefined,
  });

  view.on('change:center', () => {
    const c = view.getCenter();
    if (c) setCenter(c);
  });
  view.on('change:resolution', () => {
    const z = view.getZoom();
    if (z !== undefined) setZoom(z);
  });

  return () => map.setTarget(undefined);
}, [doubleImageUrl, targetProjection]);


  return (
    <Container w='90vw' h='70vh'>
    <div
        ref={mapRef}
        style={{ width: '100%', height: '100%', cursor: 'grab' }}
        onMouseDown={(e) => {
            if (e.button === 0) e.currentTarget.style.cursor = 'grabbing';
        }}
        onMouseUp={(e) => {
            if (e.button === 0) e.currentTarget.style.cursor = 'grab';
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.cursor = 'grab';
        }}
        />
      {loading && (
        <Center style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(255, 255, 255, 0.6)',
          zIndex: 10
        }}>
          <Loader size="xl" color="#941333" />
        </Center>
      )}
    </Container>
  );
}
