import mapboxgl from 'mapbox-gl';

const LIGHT_STYLE = 'mapbox://styles/mapbox/light-v11';
const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

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
  private pendingStyleSwitch: string | null = null;
  private isAnimating = false;
  private initError: string | null = null;
  private handlersRegistered = false; // Track if handlers were registered
  private styleSwitchPending = false; // Prevent multiple style switches
  private resizeObserver: ResizeObserver | null = null; // Track container size changes

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
    const initialStyle = initialZoom >= 14 ? SATELLITE_STYLE : LIGHT_STYLE;
    this.currentStyle = initialStyle;

    try {
      this.map = new mapboxgl.Map({
        container: this.config.container,
        style: initialStyle,
        center: initialCenter,
        zoom: initialZoom,
        attributionControl: false,
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
    
    // Check style switch on idle (after user stops interacting) instead of on every zoom
    this.map.on('idle', () => {
      if (this.isDestroyed || !this.map || !this.styleReady) return;
      this.checkStyleSwitch();
    });
  }

  private checkStyleSwitch() {
    if (!this.map || !this.styleReady || this.styleSwitchPending) return;
    
    // Don't switch styles during animations - it interrupts flyTo
    if (this.isAnimating) return;

    const zoom = this.map.getZoom();
    const shouldBeSatellite = zoom >= 15;
    const needsSatellite = shouldBeSatellite && this.currentStyle !== SATELLITE_STYLE;
    const needsLight = !shouldBeSatellite && this.currentStyle !== LIGHT_STYLE;

    if (needsSatellite || needsLight) {
      this.styleSwitchPending = true;
      // Delay style switch to avoid interrupting user interaction
      setTimeout(() => {
        this.styleSwitchPending = false;
        if (!this.map || !this.styleReady || this.isAnimating) return;
        
        const currentZoom = this.map.getZoom();
        if (currentZoom >= 15 && this.currentStyle !== SATELLITE_STYLE) {
          this.switchStyle(SATELLITE_STYLE);
        } else if (currentZoom < 15 && this.currentStyle !== LIGHT_STYLE) {
          this.switchStyle(LIGHT_STYLE);
        }
      }, 500);
    }
  }

  private switchStyle(newStyle: string) {
    if (!this.map || this.currentStyle === newStyle) return;

    // Mark as not ready during switch
    this.styleReady = false;
    this.currentStyle = newStyle;

    // Store state
    const center = this.map.getCenter();
    const zoom = this.map.getZoom();
    const bearing = this.map.getBearing();
    const pitch = this.map.getPitch();
    const dataToRestore = this.currentData;

    this.map.setStyle(newStyle);

    this.map.once('style.load', () => {
      if (!this.map || this.isDestroyed) return;

      // Restore position
      this.map.jumpTo({ center, zoom, bearing, pitch });

      // Restore data
      this.currentData = dataToRestore;

      // Re-setup everything
      this.onStyleReady();
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

    // Add parcel layers first (below markers)
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
            'line-width': 1.5,
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
            'circle-color': '#16a34a', // Original green (green-600)
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
            'circle-color': '#16a34a', // Original green (green-600)
            'circle-radius': 8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
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
      const llUuid = props.ll_uuid || featureId?.toString();
      const center = e.lngLat;

      // First try ll_uuid match, then fall back to spatial matching
      // Always prefer our database data over Regrid tile data
      let propertyInfo = llUuid ? this.findPropertyByLlUuid(llUuid) : null;
      if (!propertyInfo) {
        propertyInfo = this.findPropertyByLocation(center.lng, center.lat);
      }

      // Only show tooltip if we have property data from our database
      // This prevents showing sub-parcel addresses like "APT 925"
      if (!propertyInfo) {
        if (this.hoverPopup) this.hoverPopup.remove();
        return;
      }

      const commonName = propertyInfo.commonName;
      const address = propertyInfo.address || 'Unknown Address';

      let popupContent = `<div style="font-size: 12px; max-width: 220px;">`;
      if (commonName) {
        popupContent += `<div style="font-weight: 600; margin-bottom: 2px;">${commonName}</div>`;
      }
      popupContent += `<div style="color: #374151;">${address}</div>`;
      popupContent += `</div>`;

      if (this.hoverPopup) {
        this.hoverPopup.setLngLat(center).setHTML(popupContent).addTo(this.map);
      }
    }
  };

  private onParcelLeave = () => {
    if (!this.map) return;

    this.map.getCanvas().style.cursor = '';

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

    const setVisibility = (layerId: string, visible: boolean) => {
      if (this.map?.getLayer(layerId)) {
        this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
      }
    };

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

  flyTo(lat: number, lon: number, zoom: number = 16) {
    if (!this.map) return;
    
    // Prevent style switching during animation
    this.isAnimating = true;
    
    this.map.flyTo({
      center: [lon, lat],
      zoom,
      duration: 1500,
    });
    
    // Re-enable style switching after animation completes
    this.map.once('moveend', () => {
      this.isAnimating = false;
      // Check if we need to switch styles after animation
      this.checkStyleSwitch();
    });
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