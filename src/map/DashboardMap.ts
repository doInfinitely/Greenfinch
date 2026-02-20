import mapboxgl from 'mapbox-gl';
import { normalizeCommonName } from '@/lib/normalization';

const SATELLITE_STREETS_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';

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
  private propertyIndex: Map<string, { propertyKey: string; commonName: string | null; address: string | null; category?: string; subcategory?: string; llUuid?: string }> = new Map();
  private hoverPopup: mapboxgl.Popup | null = null;
  private hoveredParcelId: string | number | null = null;
  private currentStyle: string = SATELLITE_STREETS_STYLE;
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
    this.currentStyle = SATELLITE_STREETS_STYLE;

    // Dallas metro bounds - same as main map
    const DALLAS_BOUNDS: [[number, number], [number, number]] = [
      [-97.6, 32.4],
      [-96.3, 33.2],
    ];

    try {
      this.map = new mapboxgl.Map({
        container: this.config.container,
        style: SATELLITE_STREETS_STYLE,
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

    // Add parcel layers (below markers)
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

  private currentHoveredParcelId: string | null = null;
  private tooltipCache: Map<string, { displayName: string; address: string | null; category?: string; subcategory?: string }> = new Map();

  private onParcelHover = (e: mapboxgl.MapLayerMouseEvent) => {
    if (!this.map || !this.styleReady || !e.features?.length) return;

    const feature = e.features[0];
    const featureId = feature.id;

    // Update hover state for parcel fill
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
    }

    const props = feature.properties || {};
    const center = e.lngLat;
    
    const parcelnumb = props.parcelnumb || props.parcelnumb_no_formatting || props.apn;
    const llUuid = props.ll_uuid || (typeof featureId === 'string' ? featureId : null);
    const parcelId = parcelnumb || llUuid;
    
    if (!parcelId) {
      if (this.hoverPopup) this.hoverPopup.remove();
      this.currentHoveredParcelId = null;
      return;
    }

    // Always update position, check if we need new content
    const isSameParcel = parcelId === this.currentHoveredParcelId;
    this.currentHoveredParcelId = parcelId;

    // Check cache first (for API results)
    const cached = this.tooltipCache.get(parcelId);
    if (cached) {
      this.showTooltip(center, {
        commonName: cached.displayName,
        address: cached.address,
        category: cached.category,
        subcategory: cached.subcategory,
      });
      return;
    }

    // Try client-side matching by parcelnumb (instant)
    let propertyInfo = parcelnumb 
      ? this.findPropertyByParcelNumber(parcelnumb)
      : null;

    // If parcelnumb matching fails, try spatial proximity to nearest property marker
    if (!propertyInfo) {
      propertyInfo = this.findNearestProperty(center);
    }

    if (propertyInfo) {
      this.showTooltip(center, propertyInfo);
    } else if (parcelnumb && !isSameParcel) {
      // API fallback for constituent parcels - only fetch on new parcel
      // Pass Regrid props so we can show address if no match found
      this.fetchAndShowTooltip(center, parcelnumb, parcelId, props);
    } else {
      // No match in our database - show Regrid tile data (address, owner)
      const regridAddress = props.address || props.siteaddr || props.mail_addres;
      const owner = props.owner || props.owner1;
      if (regridAddress || owner) {
        this.showTooltip(center, {
          commonName: owner || null,
          address: regridAddress || null,
          isUnimported: true,
        });
      } else if (!isSameParcel) {
        if (this.hoverPopup) this.hoverPopup.remove();
      }
    }
  };

  private showTooltip(
    center: mapboxgl.LngLat, 
    propertyInfo: { commonName: string | null; address: string | null; category?: string; subcategory?: string; isUnimported?: boolean }
  ) {
    const displayName = propertyInfo.commonName 
      ? normalizeCommonName(propertyInfo.commonName) 
      : propertyInfo.address || 'Unknown Property';
    
    const popupContent = `<div style="font-size: 12px; max-width: 220px;">
      <div style="font-weight: 600;">${displayName}</div>
      ${propertyInfo.subcategory || propertyInfo.category ? `<div style="color: #6b7280; font-size: 11px; margin-top: 2px;">${propertyInfo.subcategory || propertyInfo.category}</div>` : ''}
    </div>`;
    
    if (this.hoverPopup && this.map) {
      this.hoverPopup.setLngLat(center).setHTML(popupContent).addTo(this.map);
    }
  }

  private async fetchAndShowTooltip(center: mapboxgl.LngLat, parcelnumb: string, parcelId: string, regridProps?: Record<string, any>) {
    try {
      const response = await fetch(`/api/parcels/resolve?parcelnumb=${encodeURIComponent(parcelnumb)}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.displayName) {
          // Cache the result
          this.tooltipCache.set(parcelId, {
            displayName: data.displayName,
            address: data.address,
            category: data.category,
            subcategory: data.subcategory,
          });
          
          // Only show if still hovering over the same parcel
          if (this.currentHoveredParcelId === parcelId) {
            this.showTooltip(center, {
              commonName: data.displayName,
              address: data.address,
              category: data.category,
              subcategory: data.subcategory,
            });
          }
          return;
        }
      }
      
      // No match found via API - try spatial proximity before showing raw Regrid data
      if (this.currentHoveredParcelId === parcelId) {
        const nearestProperty = this.findNearestProperty(center);
        if (nearestProperty) {
          this.tooltipCache.set(parcelId, {
            displayName: nearestProperty.commonName || nearestProperty.address || 'Unknown Property',
            address: nearestProperty.address,
            category: nearestProperty.category,
            subcategory: nearestProperty.subcategory,
          });
          this.showTooltip(center, nearestProperty);
        } else if (regridProps) {
          const regridAddress = regridProps.address || regridProps.siteaddr || regridProps.mail_addres;
          const owner = regridProps.owner || regridProps.owner1;
          if (regridAddress || owner) {
            this.showTooltip(center, {
              commonName: owner || null,
              address: regridAddress || null,
              isUnimported: true,
            });
          }
        }
      }
    } catch (err) {
      if (this.currentHoveredParcelId === parcelId) {
        const nearestProperty = this.findNearestProperty(center);
        if (nearestProperty) {
          this.showTooltip(center, nearestProperty);
        } else if (regridProps) {
          const regridAddress = regridProps.address || regridProps.siteaddr || regridProps.mail_addres;
          const owner = regridProps.owner || regridProps.owner1;
          if (regridAddress || owner) {
            this.showTooltip(center, {
              commonName: owner || null,
              address: regridAddress || null,
              isUnimported: true,
            });
          }
        }
      }
    }
  }

  private findPropertyByParcelNumber(parcelnumb: string): { propertyKey: string; commonName: string | null; address: string | null; category?: string; subcategory?: string } | null {
    const normalizedParcel = parcelnumb.replace(/[-\s]/g, '').toUpperCase();
    
    // Try exact match first
    const exact = this.propertyIndex.get(`pk:${normalizedParcel}`);
    if (exact) return exact;
    
    // Progressive prefix matching - try shorter prefixes until we find a match
    // Start from full length - 1 and work down to minimum of 10 chars
    for (let len = normalizedParcel.length - 1; len >= 10; len--) {
      const prefix = normalizedParcel.substring(0, len);
      const prefixMatch = this.propertyIndex.get(`prefix:${prefix}`);
      if (prefixMatch) return prefixMatch;
    }
    
    return null;
  }

  private findNearestProperty(lngLat: mapboxgl.LngLat): { propertyKey: string; commonName: string | null; address: string | null; category?: string; subcategory?: string } | null {
    if (this.currentData.features.length === 0) return null;

    const zoom = this.map?.getZoom() || 14;
    if (zoom < 14) return null;

    const maxDistDeg = zoom >= 16 ? 0.003 : 0.002;

    let nearest: { propertyKey: string; commonName: string | null; address: string | null; category?: string; subcategory?: string } | null = null;
    let nearestDist = maxDistDeg;

    for (const feature of this.currentData.features) {
      if (feature.geometry.type !== 'Point') continue;
      const [lon, lat] = (feature.geometry as GeoJSON.Point).coordinates;
      const dx = lon - lngLat.lng;
      const dy = lat - lngLat.lat;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < nearestDist) {
        nearestDist = dist;
        const props = feature.properties as any;
        if (props?.propertyKey) {
          nearest = {
            propertyKey: props.propertyKey,
            commonName: props.commonName || null,
            address: props.address || null,
            category: props.category || null,
            subcategory: props.subcategory || null,
          };
        }
      }
    }

    return nearest;
  }

  private onParcelLeave = () => {
    if (!this.map) return;

    this.map.getCanvas().style.cursor = '';
    this.currentHoveredParcelId = null;

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
    if (!e.features?.length || !this.config.onPropertyClick || !this.map) return;

    const markerFeatures = this.map.queryRenderedFeatures(e.point, {
      layers: this.map.getLayer('property-points') ? ['property-points'] : [],
    });
    if (markerFeatures && markerFeatures.length > 0) return;
    
    const feature = e.features[0];
    const props = feature.properties || {};
    const parcelnumb = props.parcelnumb || props.parcelnumb_no_formatting || props.apn;
    
    if (!parcelnumb) {
      console.warn('No parcel number found for clicked parcel');
      return;
    }
    
    // Try client-side match first (exact + progressive prefix matching)
    const propertyInfo = this.findPropertyByParcelNumber(parcelnumb);
    if (propertyInfo?.propertyKey) {
      this.config.onPropertyClick(propertyInfo.propertyKey);
      return;
    }

    // Try spatial proximity to nearest property marker
    const nearestProperty = this.findNearestProperty(e.lngLat);
    if (nearestProperty?.propertyKey) {
      this.config.onPropertyClick(nearestProperty.propertyKey);
      return;
    }
    
    // API fallback for parcels not found client-side
    try {
      const response = await fetch(`/api/parcels/resolve?parcelnumb=${encodeURIComponent(parcelnumb)}`);
      if (response.ok) {
        const data = await response.json();
        if (data.propertyKey) {
          this.config.onPropertyClick(data.propertyKey);
          return;
        }
      }
    } catch (err) {
      console.warn('Parcel lookup failed', err);
    }
  };

  private findPropertyByLlUuid(llUuid: string): { propertyKey: string; commonName: string | null; address: string | null; category?: string; subcategory?: string } | null {
    return this.propertyIndex.get(`ll:${llUuid}`) || null;
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
    this.buildPropertyIndex();
    
    if (!this.map) return;

    const source = this.map.getSource('properties') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(this.currentData);
    }
  }

  private buildPropertyIndex() {
    this.propertyIndex.clear();
    
    for (const feature of this.currentData.features) {
      const props = feature.properties as any;
      if (!props?.propertyKey) continue;
      
      const info = {
        propertyKey: props.propertyKey,
        commonName: props.commonName || null,
        address: props.address || null,
        category: props.category || null,
        subcategory: props.subcategory || null,
        llUuid: props.llUuid || null,
      };
      
      // Index by normalized propertyKey (for exact parcelnumb matching)
      const normalizedKey = props.propertyKey.replace(/[-\s]/g, '').toUpperCase();
      this.propertyIndex.set(`pk:${normalizedKey}`, info);
      
      // Index by all prefix lengths (10 chars to full length - 1) for progressive matching
      // This allows matching Regrid parcels like 005457000D01A5800 to DCAD 005457000D01A0000
      // by finding the longest matching prefix
      for (let len = normalizedKey.length - 1; len >= 10; len--) {
        const prefix = normalizedKey.substring(0, len);
        const existingKey = `prefix:${prefix}`;
        const existing = this.propertyIndex.get(existingKey);
        
        // Store this property if no existing, or if this one is "better" (more trailing zeros = parent property)
        if (!existing) {
          this.propertyIndex.set(existingKey, info);
        } else {
          // Prefer property with more trailing zeros (parent properties like 005453000K01A0000 vs 005453000K01A0100)
          const existingNormalized = existing.propertyKey.replace(/[-\s]/g, '').toUpperCase();
          const existingTrailingZeros = (existingNormalized.match(/0+$/) || [''])[0].length;
          const newTrailingZeros = (normalizedKey.match(/0+$/) || [''])[0].length;
          if (newTrailingZeros > existingTrailingZeros) {
            this.propertyIndex.set(existingKey, info);
          }
        }
      }
      
      // Also index by llUuid if available
      if (props.llUuid) {
        this.propertyIndex.set(`ll:${props.llUuid}`, info);
      }
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