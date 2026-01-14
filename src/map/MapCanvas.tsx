'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { DashboardMap, MapBounds } from './DashboardMap';
import 'mapbox-gl/dist/mapbox-gl.css';

interface MapCanvasProps {
  accessToken: string;
  regridToken?: string;
  properties: GeoJSON.Feature[];
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
  onBoundsChange?: (bounds: MapBounds, zoom: number) => void;
  onPropertyClick?: (propertyKey: string) => void;
}

export interface MapCanvasHandle {
  flyTo: (lat: number, lon: number, zoom?: number) => void;
}

const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(({
  accessToken,
  regridToken,
  properties,
  initialCenter,
  initialZoom,
  onBoundsChange,
  onPropertyClick,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<DashboardMap | null>(null);
  const callbacksRef = useRef({ onBoundsChange, onPropertyClick });

  callbacksRef.current = { onBoundsChange, onPropertyClick };

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lon: number, zoom: number = 16) => {
      mapRef.current?.flyTo(lat, lon, zoom);
    },
  }));

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    mapRef.current = new DashboardMap({
      container: containerRef.current,
      accessToken,
      regridToken,
      initialCenter,
      initialZoom,
      onBoundsChange: (bounds, zoom) => {
        callbacksRef.current.onBoundsChange?.(bounds, zoom);
      },
      onPropertyClick: (propertyKey) => {
        callbacksRef.current.onPropertyClick?.(propertyKey);
      },
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, [accessToken, regridToken, initialCenter, initialZoom]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setData({
      type: 'FeatureCollection',
      features: properties,
    });
  }, [properties]);

  return <div ref={containerRef} className="w-full h-full" />;
});

MapCanvas.displayName = 'MapCanvas';

export default MapCanvas;
