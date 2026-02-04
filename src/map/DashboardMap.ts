import mapboxgl from 'mapbox-gl';
import { normalizeCommonName } from '@/lib/normalization';

const LIGHT_STYLE = 'mapbox://styles/mapbox/light-v11';
const SATELLITE_RASTER_URL = 'mapbox://mapbox.satellite';

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface DashboardMapConfig {
  container: HTMLElement;
  accessToken: string;
  regridToken?: string;
  regridTileUrl?: string;
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
  onBoundsChange?: (bounds: MapBounds, zoom: number) => void;
  onPropertyClick?: (propertyKey: string) => void;
  onError?: (error: string) => void;
}

export class DashboardMap {
  private map: mapboxgl.Map | null = null;
  private config: DashboardMapConfig;
  private isDestroyed = false;
  private currentData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  private hoverPopup: mapboxgl.Popup | null = null;
  private hoveredParcelId: string | number | null = null;
  private currentStyle: string = LIGHT_STYLE;
  private styleReady = false;
  private isAnimating = false;
  private initError: string | null = null;
  private handlersRegistered = false; // Track if handlers were registered
  private resizeObserver: ResizeObserver | null = null; // Track container size changes
  private searchMarker: mapboxgl.Marker | null = null; // Search location marker

  constructor(config: DashboardMapConfig) {
    this.config = config;
    this.initialize();
  }

  private initialize() {
    mapboxgl.accessToken = this.config.accessToken;

    const initialZoom = this.config.initialZoom ?? 13;
    const initialCenter: [number, number] = this.config.initialCenter
      ? [this.config.initialCenter.lon, this.config.initialCenter.lat]
      : [-96.7784, 32.8639];
    this.currentStyle = LIGHT_STYLE;

    // Dallas metro bounds - same as main map
    const DALLAS_BOUNDS: [[number, number], [number, number]] = [
      [-97.6, 32.4],
      [-96.3, 33.2],
    ];

    try {
      this.map = new mapboxgl.Map({
        container: this.config.container,
        style: LIGHT_STYLE,
        center: initialCenter,
        zoom: initialZoom,
        attributionControl: false,
        minZoom: 9,
        maxBounds: DALLAS_BOUNDS,
      });
    } catch (error) {
      this.initError = error instanceof Error ? error.message : 'Map initialization failed';
      console.warn('Map initialization failed:', this.initError);
      return;
    }

    this.map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    this.map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    // Set up ResizeObserver to handle container size changes
    // This fixes coordinate mismatch when flex layout changes container dimensions
    this.resizeObserver = new ResizeObserver(() => {
      if (this.map && !this.isDestroyed) {
        this.map.resize();
      }
    });
    this.resizeObserver.observe(this.config.container);

    this.hoverPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 15,
    });

    this.map.on('load', () => {
      if (this.isDestroyed) return;
      this.onStyleReady();
    });

    this.map.on('error', (e) => {
      const errorMsg = e.error?.message || 'Map error occurred';
      console.warn('Mapbox error:', errorMsg);
      this.initError = errorMsg;
      this.config.onError?.(errorMsg);
    });

    this.map.on('moveend', () => {
      if (this.isDestroyed) return;
      this.emitBounds();
    });

    // Force repaint when new vector tiles are loaded
    this.map.on('sourcedata', (e) => {
      if (this.isDestroyed || !this.map || !this.styleReady) return;
      if (e.sourceId === 'regrid' && e.isSourceLoaded) {
        this.map.triggerRepaint();
      }
    });

    // Also trigger repaint after tiles finish loading
    this.map.on('idle', () => {
      if (this.isDestroyed || !this.map || !this.styleReady) return;
      this.map.triggerRepaint();
    });

    this.map.on('zoom', () => {
      if (this.isDestroyed || !this.map || !this.styleReady) return;
      this.updateLayerVisibility();
    });
    
  }


  private onStyleReady() {
    if (!this.map) return;

    this.addSources();
    this.addLayers();
    this.registerEventHandlers();
    this.updateLayerVisibility();
    
    // Resize to ensure coordinate system matches container dimensions
    // This is critical for flex layouts where container size may change
    this.map.resize();
    
    this.emitBounds();

    // Mark ready after a short delay to let tiles start loading
    setTimeout(() => {
      this.styleReady = true;
    }, 50);
  }

  private addSources() {
    if (!this.map) return;

    // Satellite raster source for zoom >= 15
    if (!this.map.getSource('satellite')) {
      this.map.addSource('satellite', {
        type: 'raster',
        url: SATELLITE_RASTER_URL,
        tileSize: 256,
      });
    }

    // Property points source
    if (!this.map.getSource('properties')) {
      this.map.addSource('properties', {
        type: 'geojson',
        data: this.currentData,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 160,
      });
    }

    // Regrid parcel source (use cached tile URL if available)
    const regridTileUrl = this.config.regridTileUrl || 
      (this.config.regridToken ? `https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${this.config.regridToken}` : null);
    
    if (regridTileUrl && !this.map.getSource('regrid')) {
      this.map.addSource('regrid', {
        type: 'vector',
        tiles: [regridTileUrl],
        minzoom: 10,
        maxzoom: 21,
        promoteId: 'll_uuid',
      });
    }
  }

  private addLayers() {
    if (!this.map) return;

    // Add satellite layer first (below everything else)
    if (this.map.getSource('satellite') && !this.map.getLayer('satellite-layer')) {
      this.map.addLayer({
        id: 'satellite-layer',
        type: 'raster',
        source: 'satellite',
        layout: {
          visibility: 'none', // Hidden by default, shown when zoom >= 15
        },
        paint: {
          'raster-opacity': 1,
        },
      });
    }

    // Add parcel layers (above satellite, below markers)
    if ((this.config.regridToken || this.config.regridTileUrl) && this.map.getSource('regrid')) {
      if (!this.map.getLayer('parcels-fill')) {
        this.map.addLayer({
          id: 'parcels-fill',
          type: 'fill',
          source: 'regrid',
          'source-layer': 'parcels',
          paint: {
            'fill-color': '#16a34a', // Green-600 for hover effect
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],
              0.25,
              0,
            ],
          },
        });
      }

      if (!this.map.getLayer('parcels-outline')) {
        this.map.addLayer({
          id: 'parcels-outline',
          type: 'line',
          source: 'regrid',
          'source-layer': 'parcels',
          paint: {
            'line-color': '#22c55e', // Bright green (green-500)
            'line-width': 1,
          },
        });
      }
    }

    // Add property layers on top
    if (this.map.getSource('properties')) {
      if (!this.map.getLayer('clusters')) {
        this.map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'properties',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#16a34a', // Green (green-600)
            'circle-radius': ['step', ['get', 'point_count'], 24, 50, 32, 200, 42],
          },
        });
      }

      if (!this.map.getLayer('cluster-count')) {
        this.map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'properties',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': '{point_count_abbreviated}',
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 13,
          },
          paint: { 'text-color': '#ffffff' },
        });
      }

      if (!this.map.getLayer('property-points')) {
        this.map.addLayer({
          id: 'property-points',
          type: 'circle',
          source: 'properties',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#16a34a', // Green (green-600)
            'circle-radius': 8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#facc15', // Yellow border for visibility
          },
        });
      }
    }
  }

  private registerEventHandlers() {
    if (!this.map) return;
    
    // Only register handlers once - they persist across style changes
    if (this.handlersRegistered) return;
    this.handlersRegistered = true;

    // Cluster click handler
    this.map.on('click', 'clusters', this.onClusterClick);
    this.map.on('click', 'property-points', this.onPropertyPointClick);
    this.map.on('mouseenter', 'clusters', this.onCursorPointer);
    this.map.on('mouseleave', 'clusters', this.onCursorDefault);
    this.map.on('mouseenter', 'property-points', this.onCursorPointer);
    this.map.on('mouseleave', 'property-points', this.onCursorDefault);
    this.map.on('mouseenter', 'parcels-fill', this.onCursorPointer);
    this.map.on('mousemove', 'parcels-fill', this.onParcelHover);
    this.map.on('mouseleave', 'parcels-fill', this.onParcelLeave);
    this.map.on('click', 'parcels-fill', this.onParcelClick);
  }

  private onClusterClick = (e: mapboxgl.MapLayerMouseEvent) => {
    if (!this.map || !e.features?.length) return;
    const clusterId = e.features[0].properties?.cluster_id;
    const coords = (e.features[0].geometry as GeoJSON.Point).coordinates as [number, number];
    const source = this.map.getSource('properties') as mapboxgl.GeoJSONSource;
    source.getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err || !this.map) return;
      this.map.easeTo({ center: coords, zoom: zoom || 14, duration: 500 });
    });
  };

  private onPropertyPointClick = (e: mapboxgl.MapLayerMouseEvent) => {
    if (!e.features?.length) return;
    const propertyKey = e.features[0].properties?.propertyKey;
    if (propertyKey && this.config.onPropertyClick) {
      this.config.onPropertyClick(propertyKey);
    }
  };

  private onCursorPointer = () => {
    if (this.map) this.map.getCanvas().style.cursor = 'pointer';
  };

  private onCursorDefault = () => {
    if (this.map) this.map.getCanvas().style.cursor = '';
  };

  private parcelHoverCache = new Map<string, { displayName: string; category?: string; subcategory?: string } | null>();
  private parcelHoverCacheTimestamps = new Map<string, number>();
  private currentHoveredLlUuid: string | null = null;
  private parcelHoverDebounceTimer: NodeJS.Timeout | null = null;
  private static CACHE_TTL = 5 * 60 * 1000;

  private onParcelHover = (e: mapboxgl.MapLayerMouseEvent) => {
    if (!this.map || !this.styleReady || !e.features?.length) return;

    const feature = e.features[0];
    const featureId = feature.id;

    if (this.hoveredParcelId !== null && this.hoveredParcelId !== featureId) {
      try {
        this.map.setFeatureState(
          { source: 'regrid', sourceLayer: 'parcels', id: this.hoveredParcelId },
          { hover: false }
        );
      } catch (err) {
        // Ignore
      }
    }

    if (featureId !== undefined) {
      this.hoveredParcelId = featureId;
      try {
        this.map.setFeatureState(
          { source: 'regrid', sourceLayer: 'parcels', id: featureId },
          { hover: true }
        );
      } catch (err) {
        // Ignore
      }

      const props = feature.properties || {};
      const llUuid = props.ll_uuid || (typeof featureId === 'string' ? featureId : null);
      const center = e.lngLat;

      if (!llUuid) {
        if (this.hoverPopup) this.hoverPopup.remove();
        return;
      }

      if (llUuid === this.currentHoveredLlUuid) return;
      this.currentHoveredLlUuid = llUuid;

      if (this.parcelHoverDebounceTimer) {
        clearTimeout(this.parcelHoverDebounceTimer);
      }

      this.parcelHoverDebounceTimer = setTimeout(async () => {
        if (this.currentHoveredLlUuid !== llUuid || !this.map) return;

        const now = Date.now();
        const cachedTimestamp = this.parcelHoverCacheTimestamps.get(llUuid);
        if (cachedTimestamp && (now - cachedTimestamp) < DashboardMap.CACHE_TTL && this.parcelHoverCache.has(llUuid)) {
          const cached = this.parcelHoverCache.get(llUuid);
          if (cached && this.hoverPopup) {
            const popupContent = `<div style="font-size: 12px; max-width: 220px;">
              <div style="font-weight: 600;">${cached.displayName}</div>
              ${cached.subcategory || cached.category ? `<div style="color: #6b7280; font-size: 11px; margin-top: 2px;">${cached.subcategory || cached.category}</div>` : ''}
            </div>`;
            this.hoverPopup.setLngLat(center).setHTML(popupContent).addTo(this.map);
          }
          return;
        }

        try {
          const response = await fetch(`/api/parcels/resolve?ll_uuid=${encodeURIComponent(llUuid)}`);
          if (response.ok) {
            const data = await response.json();
            const displayName = data.displayName || 'Unknown Property';
            this.parcelHoverCache.set(llUuid, { displayName, category: data.category, subcategory: data.subcategory });
            this.parcelHoverCacheTimestamps.set(llUuid, Date.now());

            if (this.currentHoveredLlUuid === llUuid && this.hoverPopup && this.map) {
              const popupContent = `<div style="font-size: 12px; max-width: 220px;">
                <div style="font-weight: 600;">${displayName}</div>
                ${data.subcategory || data.category ? `<div style="color: #6b7280; font-size: 11px; margin-top: 2px;">${data.subcategory || data.category}</div>` : ''}
              </div>`;
              this.hoverPopup.setLngLat(center).setHTML(popupContent).addTo(this.map);
            }
          } else {
            this.parcelHoverCache.set(llUuid, null);
            this.parcelHoverCacheTimestamps.set(llUuid, Date.now());
            if (this.hoverPopup) this.hoverPopup.remove();
          }
        } catch (error) {
          console.error('Failed to resolve parcel for tooltip:', error);
          if (this.hoverPopup) this.hoverPopup.remove();
        }
      }, 100);
    }
  };

  private onParcelLeave = () => {
    if (!this.map) return;

    this.map.getCanvas().style.cursor = '';

    if (this.parcelHoverDebounceTimer) {
      clearTimeout(this.parcelHoverDebounceTimer);
      this.parcelHoverDebounceTimer = null;
    }
    this.currentHoveredLlUuid = null;

    if (this.hoveredParcelId !== null && this.styleReady) {
      try {
        this.map.setFeatureState(
          { source: 'regrid', sourceLayer: 'parcels', id: this.hoveredParcelId },
          { hover: false }
        );
      } catch (err) {
        // Ignore
      }
      this.hoveredParcelId = null;
    }

    if (this.hoverPopup) {
      this.hoverPopup.remove();
    }
  };

  private onParcelClick = async (e: mapboxgl.MapLayerMouseEvent) => {
    if (!e.features?.length) return;
    
    const feature = e.features[0];
    const llUuid = feature.id as string || feature.properties?.ll_uuid;
    
    // Try to find property by ll_uuid via API lookup (most accurate)
    if (llUuid && this.config.onPropertyClick) {
      try {
        const response = await fetch(`/api/properties/by-parcel/${encodeURIComponent(llUuid)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.propertyKey) {
            this.config.onPropertyClick(data.propertyKey);
            return;
          }
        }
      } catch (err) {
        console.warn('Parcel lookup failed, using fallback', err);
      }
      
      // Fallback: try client-side ll_uuid matching
      const propertyInfo = this.findPropertyByLlUuid(llUuid);
      if (propertyInfo?.propertyKey) {
        this.config.onPropertyClick(propertyInfo.propertyKey);
        return;
      }
    }
    
    // Final fallback to location-based matching
    const center = e.lngLat;
    const propertyInfo = this.findPropertyByLocation(center.lng, center.lat);
    if (propertyInfo?.propertyKey && this.config.onPropertyClick) {
      this.config.onPropertyClick(propertyInfo.propertyKey);
    }
  };

  private findPropertyByLlUuid(llUuid: string): { propertyKey: string; commonName: string | null; address: string | null } | null {
    for (const feature of this.currentData.features) {
      const props = feature.properties as any;
      if (props?.llUuid === llUuid) {
        return {
          propertyKey: props?.propertyKey || null,
          commonName: props?.commonName || null,
          address: props?.address || null,
        };
      }
    }
    return null;
  }

  private findPropertyByLocation(lng: number, lat: number): { propertyKey: string; commonName: string | null; address: string | null } | null {
    // Use larger tolerance to match clicks within parcels (about 200m)
    // This helps match sub-parcels (like apartment units) to their parent property
    const tolerance = 0.002;
    for (const feature of this.currentData.features) {
      if (feature.geometry.type === 'Point') {
        const [fLng, fLat] = feature.geometry.coordinates;
        if (Math.abs(fLng - lng) < tolerance && Math.abs(fLat - lat) < tolerance) {
          const props = feature.properties as any;
          return {
            propertyKey: props?.propertyKey || null,
            commonName: props?.commonName || null,
            address: props?.address || null,
          };
        }
      }
    }
    return null;
  }

  private getPropertyAddress(propertyKey: string): string | null {
    for (const feature of this.currentData.features) {
      const props = feature.properties as any;
      if (props?.propertyKey === propertyKey) {
        return props?.address || null;
      }
    }
    return null;
  }

  private updateLayerVisibility() {
    if (!this.map) return;

    const zoom = this.map.getZoom();
    const showParcels = zoom >= 15;
    const showClusters = zoom < 15;
    const showSatellite = zoom >= 15;

    const setVisibility = (layerId: string, visible: boolean) => {
      if (this.map?.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    };

    setVisibility('satellite-layer', showSatellite);
    setVisibility('clusters', showClusters);
    setVisibility('cluster-count', showClusters);
    setVisibility('property-points', showParcels);
    setVisibility('parcels-fill', showParcels);
    setVisibility('parcels-outline', showParcels);
  }

  private emitBounds() {
    if (!this.map || !this.config.onBoundsChange) return;
    const bounds = this.map.getBounds();
    if (!bounds) return;
    this.config.onBoundsChange({
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
    }, this.map.getZoom());
  }

  setData(geojson: GeoJSON.FeatureCollection) {
    this.currentData = geojson;
    if (!this.map) return;

    const source = this.map.getSource('properties') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(this.currentData);
    }
  }

  flyTo(lat: number, lon: number, zoom: number = 16, showMarker: boolean = true) {
    if (!this.map) return;
    
    // Prevent style switching during animation
    this.isAnimating = true;
    
    // Show search marker at the location
    if (showMarker) {
      this.setSearchMarker(lat, lon);
    }
    
    this.map.flyTo({
      center: [lon, lat],
      zoom,
      duration: 1500,
    });
    
    // Re-enable after animation completes
    this.map.once('moveend', () => {
      this.isAnimating = false;
    });
  }

  setSearchMarker(lat: number, lon: number) {
    if (!this.map) return;
    
    // Remove existing marker if any
    this.clearSearchMarker();
    
    // Create marker element with a distinctive search pin style
    const el = document.createElement('div');
    el.className = 'search-marker';
    el.innerHTML = `
      <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.164 0 0 7.164 0 16c0 12 16 24 16 24s16-12 16-24c0-8.836-7.164-16-16-16z" fill="#ef4444"/>
        <circle cx="16" cy="16" r="6" fill="white"/>
      </svg>
    `;
    el.style.cursor = 'pointer';
    
    this.searchMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lon, lat])
      .addTo(this.map);
  }

  clearSearchMarker() {
    if (this.searchMarker) {
      this.searchMarker.remove();
      this.searchMarker = null;
    }
  }

  destroy() {
    this.isDestroyed = true;
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.hoverPopup) {
      this.hoverPopup.remove();
      this.hoverPopup = null;
    }
    this.clearSearchMarker();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  getInitError(): string | null {
    return this.initError;
  }

  isInitialized(): boolean {
    return this.map !== null && !this.initError;
  }
}