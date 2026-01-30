'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface PropertyFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    propertyKey: string;
    address: string;
    city: string;
    zip: string;
    primaryOwner: string;
    commonName: string;
    category: string;
    subcategory: string;
    propertyClass: string;
    operationalStatus: string;
    enriched: boolean;
    lotSqft: number;
  };
}

interface MapViewProps {
  flyTo?: { lat: number; lon: number; zoom?: number } | null;
  onFlyComplete?: () => void;
  onPropertyClick?: (propertyKey: string) => void;
  properties?: PropertyFeature[];
  onMapMove?: (lat: number, lon: number, zoom: number) => void;
  onBoundsChange?: (bounds: { north: number; south: number; east: number; west: number }) => void;
  highlightProperty?: {
    propertyKey: string;
    address: string;
    commonName?: string | null;
    lat: number;
    lon: number;
  };
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
}

const LIGHT_STYLE = 'mapbox://styles/mapbox/light-v11';
const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

export default function MapView({ flyTo, onFlyComplete, onPropertyClick, properties, onMapMove, onBoundsChange, highlightProperty, initialCenter, initialZoom }: MapViewProps) {
  const router = useRouter();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const hoverPopup = useRef<mapboxgl.Popup | null>(null);
  const highlightMarker = useRef<mapboxgl.Marker | null>(null);
  const propertiesGeoJson = useRef<GeoJSON.FeatureCollection | null>(null);
  const hoveredParcelId = useRef<string | number | null>(null);
  const highlightedParcelId = useRef<string | number | null>(null);
  const layersAdded = useRef(false);
  const propertyHandlersAdded = useRef(false);
  const lastFlyToRef = useRef<string | null>(null);
  const currentStyle = useRef<string>(LIGHT_STYLE);
  const isStyleSwitching = useRef(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapToken, setMapToken] = useState<string>('');
  const [regridToken, setRegridToken] = useState<string>('');
  const [mapError, setMapError] = useState<string | null>(null);
  const [currentZoom, setCurrentZoom] = useState(13);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        if (data.mapboxToken) {
          setMapToken(data.mapboxToken);
        } else {
          setMapError('Map API key not configured');
        }
        if (data.regridToken) {
          setRegridToken(data.regridToken);
        }
      })
      .catch(() => setMapError('Failed to load map configuration'));
  }, []);

  const addPropertyLayers = useCallback((geojson: GeoJSON.FeatureCollection) => {
    if (!map.current) return;

    if (map.current.getSource('properties-cluster')) {
      const source = map.current.getSource('properties-cluster') as mapboxgl.GeoJSONSource;
      source.setData(geojson);
      return;
    }

    map.current.addSource('properties-cluster', {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterMaxZoom: 13,
      clusterRadius: 120,
      clusterMinPoints: 2,
    });

    map.current.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'properties-cluster',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#22c55e',
          50,
          '#16a34a',
          200,
          '#15803d',
          500,
          '#166534',
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          18,
          50,
          24,
          200,
          30,
          500,
          36,
        ],
      },
    });

    map.current.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'properties-cluster',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': [
          'case',
          ['>=', ['get', 'point_count'], 1000],
          ['concat', ['/', ['round', ['/', ['get', 'point_count'], 100]], 10], 'K'],
          ['to-string', ['get', 'point_count']],
        ],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 11,
      },
      paint: {
        'text-color': '#ffffff',
      },
    });

    const initialZoom = map.current.getZoom();
    const initialPointVisibility = initialZoom >= 14 ? 'visible' : 'none';
    const initialClusterVisibility = initialZoom < 14 ? 'visible' : 'none';
    
    map.current.setLayoutProperty('clusters', 'visibility', initialClusterVisibility);
    map.current.setLayoutProperty('cluster-count', 'visibility', initialClusterVisibility);

    map.current.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'properties-cluster',
      filter: ['!', ['has', 'point_count']],
      layout: {
        visibility: initialPointVisibility,
      },
      paint: {
        'circle-color': '#22c55e',
        'circle-radius': 8,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    layersAdded.current = true;
  }, []);

  const addRegridLayers = useCallback((token: string, routerRef: typeof router) => {
    if (!map.current || !token) return;
    
    if (map.current.getSource('regrid-parcels')) return;

    map.current.addSource('regrid-parcels', {
      type: 'vector',
      tiles: [`https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${token}`],
      minzoom: 10,
      maxzoom: 21,
      promoteId: 'll_uuid',
    });

    const initialVisibility = map.current.getZoom() >= 14 ? 'visible' : 'none';

    map.current.addLayer({
      id: 'parcels-fill',
      type: 'fill',
      source: 'regrid-parcels',
      'source-layer': 'parcels',
      layout: {
        visibility: initialVisibility,
      },
      paint: {
        'fill-color': '#22c55e',
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.2,
          0
        ],
      },
    });

    map.current.addLayer({
      id: 'parcels-outline',
      type: 'line',
      source: 'regrid-parcels',
      'source-layer': 'parcels',
      layout: {
        visibility: initialVisibility,
      },
      paint: {
        'line-color': '#22c55e',
        'line-width': 1.5,
      },
    });

    map.current.on('click', 'parcels-fill', async (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const llUuid = feature.properties?.ll_uuid;
        
        if (llUuid) {
          try {
            const response = await fetch(`/api/parcels/resolve?ll_uuid=${encodeURIComponent(llUuid)}`);
            if (response.ok) {
              const data = await response.json();
              if (data.propertyKey) {
                routerRef.push(`/property/${data.propertyKey}`);
              }
            }
          } catch (error) {
            console.error('Failed to resolve parcel:', error);
          }
        }
      }
    });

    map.current.on('mouseenter', 'parcels-fill', () => {
      if (!map.current || isStyleSwitching.current) return;
      map.current.getCanvas().style.cursor = 'pointer';
    });

    map.current.on('mousemove', 'parcels-fill', (e) => {
      if (!map.current || !map.current.isStyleLoaded() || isStyleSwitching.current) return;
      if (!e.features || e.features.length === 0) return;
      
      const feature = e.features[0];
      const featureId = feature.id;
      
      if (hoveredParcelId.current !== null && hoveredParcelId.current !== featureId) {
        try {
          map.current.setFeatureState(
            { source: 'regrid-parcels', sourceLayer: 'parcels', id: hoveredParcelId.current },
            { hover: false }
          );
        } catch (err) {
          // Ignore errors
        }
      }
      
      if (featureId !== undefined) {
        hoveredParcelId.current = featureId;
        try {
          map.current.setFeatureState(
            { source: 'regrid-parcels', sourceLayer: 'parcels', id: featureId },
            { hover: true }
          );
        } catch (err) {
          // Ignore errors
        }
      }
    });

    map.current.on('mouseleave', 'parcels-fill', () => {
      if (!map.current) return;
      
      map.current.getCanvas().style.cursor = '';
      
      if (hoveredParcelId.current !== null) {
        if (map.current.isStyleLoaded() && !isStyleSwitching.current && map.current.getSource('regrid-parcels')) {
          try {
            map.current.setFeatureState(
              { source: 'regrid-parcels', sourceLayer: 'parcels', id: hoveredParcelId.current },
              { hover: false }
            );
          } catch (err) {
            // Ignore errors
          }
        }
        hoveredParcelId.current = null;
      }
    });
  }, []);

  const setupPropertyEventHandlers = useCallback((routerRef: typeof router, propertyClickHandler?: (key: string) => void) => {
    if (!map.current || propertyHandlersAdded.current) return;
    propertyHandlersAdded.current = true;

    map.current.on('click', 'clusters', (e) => {
      if (!map.current) return;
      const features = map.current.queryRenderedFeatures(e.point, {
        layers: ['clusters'],
      });
      if (!features.length) return;
      
      const clusterId = features[0].properties?.cluster_id;
      const source = map.current.getSource('properties-cluster') as mapboxgl.GeoJSONSource;
      
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err || !map.current || zoom == null) return;
        
        const coordinates = (features[0].geometry as GeoJSON.Point).coordinates;
        
        map.current.easeTo({
          center: coordinates as [number, number],
          zoom: Math.min(zoom + 0.5, 17),
          duration: 500,
        });
      });
    });

    map.current.on('click', 'unclustered-point', (e) => {
      if (!e.features || e.features.length === 0) return;
      const props = e.features[0].properties;
      if (props?.propertyKey) {
        if (propertyClickHandler) {
          propertyClickHandler(props.propertyKey);
        } else {
          routerRef.push(`/property/${props.propertyKey}`);
        }
      }
    });

    map.current.on('mouseenter', 'clusters', () => {
      if (map.current) map.current.getCanvas().style.cursor = 'pointer';
    });
    map.current.on('mouseleave', 'clusters', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
    });

    map.current.on('mouseenter', 'unclustered-point', (e) => {
      if (!map.current || !hoverPopup.current) return;
      map.current.getCanvas().style.cursor = 'pointer';
      
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = feature.properties;
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
        
        const category = (props?.category || '').toLowerCase();
        const isResidential = category.includes('single') || category.includes('residential');
        
        let popupContent: string;
        if (isResidential) {
          popupContent = `<div style="font-size: 12px; max-width: 200px;">
            <span style="color: #6b7280; font-weight: 500;">Residential</span>
            <div style="font-weight: 500; margin-top: 2px;">${props?.address || 'No Address'}</div>
          </div>`;
        } else {
          const displayName = props?.commonName || props?.address || 'Unknown Property';
          const categoryLabel = props?.subcategory || props?.category || '';
          popupContent = `<div style="font-size: 12px; max-width: 200px;">
            <div style="font-weight: 500;">${displayName}</div>
            ${categoryLabel ? `<div style="color: #6b7280; font-size: 11px; margin-top: 2px;">${categoryLabel}</div>` : ''}
          </div>`;
        }
        
        hoverPopup.current
          .setLngLat(coordinates)
          .setHTML(popupContent)
          .addTo(map.current);
      }
    });
    
    map.current.on('mouseleave', 'unclustered-point', () => {
      if (map.current) map.current.getCanvas().style.cursor = '';
      if (hoverPopup.current) hoverPopup.current.remove();
    });
  }, []);

  const updateLayerVisibility = useCallback((zoom: number) => {
    if (!map.current) return;
    
    const regridVisibility = zoom >= 14 ? 'visible' : 'none';
    if (map.current.getLayer('parcels-fill')) {
      map.current.setLayoutProperty('parcels-fill', 'visibility', regridVisibility);
    }
    if (map.current.getLayer('parcels-outline')) {
      map.current.setLayoutProperty('parcels-outline', 'visibility', regridVisibility);
    }

    const pointVisibility = zoom >= 14 ? 'visible' : 'none';
    const clusterVisibility = zoom < 14 ? 'visible' : 'none';
    
    if (map.current.getLayer('unclustered-point')) {
      map.current.setLayoutProperty('unclustered-point', 'visibility', pointVisibility);
    }
    if (map.current.getLayer('clusters')) {
      map.current.setLayoutProperty('clusters', 'visibility', clusterVisibility);
    }
    if (map.current.getLayer('cluster-count')) {
      map.current.setLayoutProperty('cluster-count', 'visibility', clusterVisibility);
    }
  }, []);

  const readdAllLayers = useCallback(() => {
    if (!map.current) return;
    
    // Only reset layer flags, not handler flags - handlers persist across style changes
    layersAdded.current = false;
    
    if (propertiesGeoJson.current) {
      addPropertyLayers(propertiesGeoJson.current);
    }
    
    if (regridToken) {
      // Re-add regrid source and layers without re-registering handlers
      if (!map.current.getSource('regrid-parcels')) {
        map.current.addSource('regrid-parcels', {
          type: 'vector',
          tiles: [`https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${regridToken}`],
          minzoom: 10,
          maxzoom: 21,
          promoteId: 'll_uuid',
        });

        map.current.addLayer({
          id: 'parcels-fill',
          type: 'fill',
          source: 'regrid-parcels',
          'source-layer': 'parcels',
          paint: {
            'fill-color': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],
              'rgba(34, 197, 94, 0.3)',
              'rgba(34, 197, 94, 0.1)',
            ],
            'fill-opacity': 0.8,
          },
        });

        map.current.addLayer({
          id: 'parcels-outline',
          type: 'line',
          source: 'regrid-parcels',
          'source-layer': 'parcels',
          paint: {
            'line-color': '#22c55e',
            'line-width': 1.5,
          },
        });
      }
    }
    
    const zoom = map.current.getZoom();
    updateLayerVisibility(zoom);
  }, [addPropertyLayers, updateLayerVisibility, regridToken]);

  const handleStyleSwitch = useCallback((newStyle: string) => {
    if (!map.current || currentStyle.current === newStyle || isStyleSwitching.current) return;
    
    isStyleSwitching.current = true;
    
    const center = map.current.getCenter();
    const zoom = map.current.getZoom();
    const bearing = map.current.getBearing();
    const pitch = map.current.getPitch();
    
    currentStyle.current = newStyle;
    map.current.setStyle(newStyle);
    
    map.current.once('style.load', () => {
      if (!map.current) return;
      map.current.jumpTo({ center, zoom, bearing, pitch });
      readdAllLayers();
      isStyleSwitching.current = false;
    });
  }, [readdAllLayers]);

  useEffect(() => {
    if (!mapContainer.current || map.current || !mapToken) return;

    try {
      mapboxgl.accessToken = mapToken;

      const startZoom = initialZoom ?? 13;
      const startCenter: [number, number] = initialCenter 
        ? [initialCenter.lon, initialCenter.lat]
        : [-96.7877, 32.8667];
      const startStyle = startZoom >= 14 ? SATELLITE_STYLE : LIGHT_STYLE;
      currentStyle.current = startStyle;

      const DALLAS_BOUNDS: [[number, number], [number, number]] = [
        [-97.6, 32.4],
        [-96.3, 33.2],
      ];

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: startStyle,
        center: startCenter,
        zoom: startZoom,
        maxBounds: DALLAS_BOUNDS,
        minZoom: 9,
      });

      map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

      hoverPopup.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 15,
      });

      map.current.on('load', () => {
        setMapLoaded(true);
        if (onBoundsChange && map.current) {
          const bounds = map.current.getBounds();
          if (bounds) {
            onBoundsChange({
              north: bounds.getNorth(),
              south: bounds.getSouth(),
              east: bounds.getEast(),
              west: bounds.getWest(),
            });
          }
        }
      });

      map.current.on('zoom', () => {
        if (map.current) {
          const zoom = map.current.getZoom();
          setCurrentZoom(zoom);
          updateLayerVisibility(zoom);
        }
      });

      map.current.on('idle', () => {
        if (!map.current || isStyleSwitching.current) return;
        
        const zoom = map.current.getZoom();
        const shouldBeSatellite = zoom >= 14;
        const isSatellite = currentStyle.current === SATELLITE_STYLE;
        
        if (shouldBeSatellite && !isSatellite) {
          handleStyleSwitch(SATELLITE_STYLE);
        } else if (!shouldBeSatellite && isSatellite) {
          handleStyleSwitch(LIGHT_STYLE);
        }
      });

      map.current.on('moveend', () => {
        if (!map.current) return;
        
        const zoom = map.current.getZoom();
        const center = map.current.getCenter();
        
        if (onMapMove) {
          onMapMove(center.lat, center.lng, zoom);
        }
        
        if (onBoundsChange) {
          const bounds = map.current.getBounds();
          if (bounds) {
            onBoundsChange({
              north: bounds.getNorth(),
              south: bounds.getSouth(),
              east: bounds.getEast(),
              west: bounds.getWest(),
            });
          }
        }
      });
      
      map.current.on('error', (e) => {
        console.error('Mapbox error:', e);
      });
    } catch (err) {
      console.error('Map initialization error:', err);
      setMapError('Failed to initialize map. Your browser may not support WebGL.');
    }

    return () => {
      if (hoverPopup.current) {
        hoverPopup.current.remove();
      }
      if (map.current) {
        try {
          map.current.remove();
        } catch (e) {
          console.error('Error removing map:', e);
        }
        map.current = null;
      }
      propertyHandlersAdded.current = false;
    };
  }, [mapToken, updateLayerVisibility, handleStyleSwitch]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: properties || [],
    };

    propertiesGeoJson.current = geojson;
    
    if (!map.current.isStyleLoaded()) {
      map.current.once('style.load', () => {
        if (!map.current) return;
        if (map.current.getSource('properties-cluster')) {
          const source = map.current.getSource('properties-cluster') as mapboxgl.GeoJSONSource;
          source.setData(geojson);
        } else {
          addPropertyLayers(geojson);
          setupPropertyEventHandlers(router, onPropertyClick);
        }
      });
      return;
    }
    
    if (map.current.getSource('properties-cluster')) {
      const source = map.current.getSource('properties-cluster') as mapboxgl.GeoJSONSource;
      source.setData(geojson);
    } else {
      addPropertyLayers(geojson);
      setupPropertyEventHandlers(router, onPropertyClick);
    }
  }, [mapLoaded, properties, router, onPropertyClick, addPropertyLayers, setupPropertyEventHandlers]);

  useEffect(() => {
    if (!map.current || !mapLoaded || !regridToken) return;
    
    if (map.current.getSource('regrid-parcels')) return;

    if (!map.current.isStyleLoaded()) {
      map.current.once('style.load', () => {
        if (map.current && !map.current.getSource('regrid-parcels')) {
          addRegridLayers(regridToken, router);
        }
      });
      return;
    }

    addRegridLayers(regridToken, router);
  }, [mapLoaded, regridToken, router, addRegridLayers]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    
    // Clear the ref when flyTo becomes null so we can re-navigate to same location
    if (!flyTo) {
      lastFlyToRef.current = null;
      return;
    }

    // Create a key to identify this command
    const flyToKey = `${flyTo.lat.toFixed(6)}-${flyTo.lon.toFixed(6)}-${flyTo.zoom || 15}`;
    
    // Skip if we already processed this exact command
    if (lastFlyToRef.current === flyToKey) return;
    lastFlyToRef.current = flyToKey;

    map.current.flyTo({
      center: [flyTo.lon, flyTo.lat],
      zoom: flyTo.zoom || 15,
      duration: 1500,
    });
    
    if (onFlyComplete) {
      setTimeout(() => {
        onFlyComplete();
      }, 1600);
    }
  }, [flyTo, mapLoaded, onFlyComplete]);

  useEffect(() => {
    if (!map.current || !mapLoaded || !highlightProperty) return;

    if (highlightMarker.current) {
      highlightMarker.current.remove();
    }

    const el = document.createElement('div');
    el.className = 'highlight-marker';
    el.style.width = '24px';
    el.style.height = '24px';
    el.style.backgroundColor = '#22c55e';
    el.style.border = '3px solid #ffffff';
    el.style.borderRadius = '50%';
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';

    highlightMarker.current = new mapboxgl.Marker(el)
      .setLngLat([highlightProperty.lon, highlightProperty.lat])
      .addTo(map.current);

    const highlightParcelAtPoint = () => {
      if (!map.current || !map.current.getSource('regrid-parcels')) return;
      
      const point = map.current.project([highlightProperty.lon, highlightProperty.lat]);
      const features = map.current.queryRenderedFeatures(point, {
        layers: ['parcels-fill'],
      });

      if (highlightedParcelId.current !== null) {
        try {
          map.current.setFeatureState(
            { source: 'regrid-parcels', sourceLayer: 'parcels', id: highlightedParcelId.current },
            { hover: false }
          );
        } catch (e) {}
      }

      if (features.length > 0) {
        const featureId = features[0].id;
        if (featureId !== undefined) {
          highlightedParcelId.current = featureId;
          try {
            map.current.setFeatureState(
              { source: 'regrid-parcels', sourceLayer: 'parcels', id: featureId },
              { hover: true }
            );
          } catch (e) {
            // Ignore errors
          }
        }
      }
    };

    if (map.current.getSource('regrid-parcels') && map.current.getZoom() >= 14) {
      map.current.once('idle', highlightParcelAtPoint);
    }

    const onSourceData = (e: mapboxgl.MapSourceDataEvent) => {
      if (e.sourceId === 'regrid-parcels' && e.isSourceLoaded && map.current && map.current.getZoom() >= 14) {
        setTimeout(highlightParcelAtPoint, 200);
      }
    };

    map.current.on('sourcedata', onSourceData);

    return () => {
      if (map.current) {
        map.current.off('sourcedata', onSourceData);
      }
      if (highlightMarker.current) {
        highlightMarker.current.remove();
        highlightMarker.current = null;
      }
      if (map.current && highlightedParcelId.current !== null) {
        try {
          map.current.setFeatureState(
            { source: 'regrid-parcels', sourceLayer: 'parcels', id: highlightedParcelId.current },
            { hover: false }
          );
        } catch (e) {}
        highlightedParcelId.current = null;
      }
    };
  }, [mapLoaded, highlightProperty]);

  if (mapError) {
    return (
      <div className="w-full h-full bg-gray-100 flex items-center justify-center">
        <div className="text-center max-w-md p-8">
          <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Map Unavailable</h3>
          <p className="text-sm text-gray-500">{mapError}</p>
        </div>
      </div>
    );
  }

  if (!mapToken) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <div ref={mapContainer} className="w-full h-full" />
      {highlightProperty && mapLoaded && (
        <div className="absolute top-4 left-4 right-16 bg-white/95 backdrop-blur-sm rounded-lg px-4 py-3 shadow-lg z-10 max-w-[calc(100%-5rem)]">
          {highlightProperty.commonName && (
            <p className="font-semibold text-gray-900 truncate">{highlightProperty.commonName}</p>
          )}
          <p className={`truncate ${highlightProperty.commonName ? 'text-sm text-gray-600' : 'font-semibold text-gray-900'}`}>
            {highlightProperty.address}
          </p>
        </div>
      )}
      {mapLoaded && !highlightProperty && (
        <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg px-3 py-2 text-xs text-gray-600 shadow-sm">
          <span className="font-medium">Zoom:</span> {currentZoom.toFixed(1)}
          {currentZoom >= 14 && (
            <span className="ml-2 text-green-600">
              {currentZoom >= 15 ? 'Properties & parcels visible' : 'Parcel boundaries visible'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
