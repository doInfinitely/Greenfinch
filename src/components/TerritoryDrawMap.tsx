'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';

interface TerritoryDrawMapProps {
  accessToken: string;
  initialGeometry?: GeoJSON.Polygon | null;
  onGeometryChange: (geometry: GeoJSON.Polygon | null) => void;
}

export default function TerritoryDrawMap({
  accessToken,
  initialGeometry,
  onGeometryChange,
}: TerritoryDrawMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const onGeometryChangeRef = useRef(onGeometryChange);
  onGeometryChangeRef.current = onGeometryChange;

  const handleDrawUpdate = useCallback(() => {
    if (!drawRef.current) return;
    const data = drawRef.current.getAll();
    if (data.features.length > 0) {
      const feature = data.features[data.features.length - 1];
      if (feature.geometry.type === 'Polygon') {
        onGeometryChangeRef.current(feature.geometry as GeoJSON.Polygon);
      }
    } else {
      onGeometryChangeRef.current(null);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = accessToken;

    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [-96.93, 32.97],
        zoom: 10,
        attributionControl: false,
      });

      mapRef.current = map;

      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {
          polygon: true,
          trash: true,
        },
        defaultMode: 'simple_select',
      });

      drawRef.current = draw;
      map.addControl(draw, 'top-left');
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      map.on('draw.create', handleDrawUpdate);
      map.on('draw.update', handleDrawUpdate);
      map.on('draw.delete', handleDrawUpdate);

      map.on('load', () => {
        if (initialGeometry) {
          const featureId = draw.add({
            type: 'Feature',
            properties: {},
            geometry: initialGeometry,
          });
          // Fit map to the polygon bounds
          const coords = initialGeometry.coordinates[0];
          if (coords.length > 0) {
            let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
            for (const [lng, lat] of coords) {
              if (lng < minLng) minLng = lng;
              if (lng > maxLng) maxLng = lng;
              if (lat < minLat) minLat = lat;
              if (lat > maxLat) maxLat = lat;
            }
            map.fitBounds(
              [[minLng, minLat], [maxLng, maxLat]],
              { padding: 40, maxZoom: 14, duration: 0 }
            );
          }
        }
      });
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'Map initialization failed');
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        drawRef.current = null;
      }
    };
  }, [accessToken, initialGeometry, handleDrawUpdate]);

  if (mapError) {
    return (
      <div className="w-full h-[300px] flex items-center justify-center bg-gray-100 rounded-md">
        <p className="text-gray-500 text-sm">Map unavailable: {mapError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="w-full h-[300px] rounded-md overflow-hidden border" />
      <p className="text-xs text-muted-foreground">
        Click the polygon tool (top-left) to draw a territory boundary. Click points to define the shape, then double-click to finish.
      </p>
    </div>
  );
}
