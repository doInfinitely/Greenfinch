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

interface ParcelIndexEntry {
  pk: string;
  n: string | null;
  a: string | null;
  c: string | null;
  s: string | null;
}

export class DashboardMap {
  private map: mapboxgl.Map | null = null;
  private config: DashboardMapConfig;
  private isDestroyed = false;
  private currentData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  private debugLogging = true;
  private parcelIndexLoaded = false;
  private parcelIndex: Map<string, ParcelIndexEntry> = new Map();
  private hoverPopup: mapboxgl.Popup | null = null;
  private hoveredParcelId: string | number | null = null;
  private currentStyle: string = SATELLITE_STREETS_STYLE;
  private styleReady = false;
  private isAnimating = false;
  private initError: string | null = null;
  private handlersRegistered = false;
  private resizeObserver: ResizeObserver | null = null;
  private searchMarker: mapboxgl.Marker | null = null;
  private currentHoveredParcelId: string | null = null;

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

    this.map.on('sourcedata', (e) => {
      if (this.isDestroyed || !this.map || !this.styleReady) return;
      if (e.sourceId === 'regrid' && e.isSourceLoaded) {
        this.map.triggerRepaint();
      }
    });

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
    
    this.map.resize();
    
    this.emitBounds();

    setTimeout(() => {
      this.styleReady = true;
    }, 50);
  }

  private addSources() {
    if (!this.map) return;

    if (!this.map.getSource('properties')) {
      this.map.addSource('properties', {
        type: 'geojson',
        data: this.currentData,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 80,
      });
    }

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

    if ((this.config.regridToken || this.config.regridTileUrl) && this.map.getSource('regrid')) {
      if (!this.map.getLayer('parcels-fill')) {
        this.map.addLayer({
          id: 'parcels-fill',
          type: 'fill',
          source: 'regrid',
          'source-layer': 'parcels',
          paint: {
            'fill-color': '#16a34a',
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
            'line-color': '#22c55e',
            'line-width': 1,
          },
        });
      }
    }

    if (this.map.getSource('properties')) {
      if (!this.map.getLayer('clusters')) {
        this.map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'properties',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': '#16a34a',
            'circle-radius': ['step', ['get', 'point_count'], 22, 50, 30, 200, 40],
            'circle-opacity': 0.92,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff',
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
            'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
            'text-size': 13,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0,0,0,0.3)',
            'text-halo-width': 1,
          },
        });
      }

      if (!this.map.getLayer('property-points')) {
        this.map.addLayer({
          id: 'property-points',
          type: 'circle',
          source: 'properties',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': '#16a34a',
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
    
    if (this.handlersRegistered) return;
    this.handlersRegistered = true;

    this.map.on('click', 'clusters', this.onClusterClick);
    this.map.on('mouseenter', 'clusters', this.onCursorPointer);
    this.map.on('mouseleave', 'clusters', this.onCursorDefault);
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
    }

    const props = feature.properties || {};
    const center = e.lngLat;
    const parcelnumb = props.parcelnumb_no_formatting || props.parcelnumb || props.apn;
    const llUuid = props.ll_uuid || (feature.id ? String(feature.id) : null);

    if (!parcelnumb && !llUuid) {
      if (this.hoverPopup) this.hoverPopup.remove();
      this.currentHoveredParcelId = null;
      return;
    }

    const parcelId = parcelnumb || llUuid;
    if (parcelId === this.currentHoveredParcelId) return;
    this.currentHoveredParcelId = parcelId;

    this.resolveAndShowTooltip(center, parcelnumb, llUuid, props);
  };

  private resolveParcelNumber(parcelnumb: string): ParcelIndexEntry | null {
    const normalized = parcelnumb.replace(/[-\s]/g, '').toUpperCase();
    const exact = this.parcelIndex.get(normalized);
    if (exact) return exact;

    for (let len = normalized.length - 1; len >= 10; len--) {
      const prefix = `prefix:${normalized.substring(0, len)}`;
      const prefixMatch = this.parcelIndex.get(prefix);
      if (prefixMatch) return prefixMatch;
    }

    if (this.debugLogging) {
      console.log('[ParcelResolve] MISS for:', parcelnumb, '→ normalized:', normalized, '| index size:', this.parcelIndex.size);
    }
    return null;
  }

  private resolveAndShowTooltip(center: mapboxgl.LngLat, parcelnumb: string | null, llUuid: string | null, regridProps: Record<string, any>) {
    let entry: ParcelIndexEntry | null = null;
    if (parcelnumb) {
      entry = this.resolveParcelNumber(parcelnumb);
    }
    if (!entry && llUuid) {
      entry = this.parcelIndex.get(`ll:${llUuid}`) || null;
    }

    if (entry) {
      const displayName = entry.n
        ? normalizeCommonName(entry.n)
        : entry.a || 'Unknown Property';

      this.showTooltip(center, {
        displayName,
        address: entry.a,
        category: entry.c,
        subcategory: entry.s,
      });
    } else {
      const regridAddress = regridProps.address || regridProps.siteaddr || regridProps.mail_addres;
      if (regridAddress) {
        this.showTooltip(center, {
          displayName: regridAddress,
          address: regridAddress,
          category: null,
          subcategory: null,
        });
      } else {
        if (this.hoverPopup) this.hoverPopup.remove();
      }
    }
  }

  private showTooltip(
    center: mapboxgl.LngLat, 
    info: { displayName: string; address: string | null; category?: string | null; subcategory?: string | null }
  ) {
    const popupContent = `<div style="font-size: 12px; max-width: 220px;">
      <div style="font-weight: 600;">${info.displayName}</div>
      ${info.subcategory || info.category ? `<div style="color: #6b7280; font-size: 11px; margin-top: 2px;">${info.subcategory || info.category}</div>` : ''}
    </div>`;
    
    if (this.hoverPopup && this.map) {
      this.hoverPopup.setLngLat(center).setHTML(popupContent).addTo(this.map);
    }
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

  private onParcelClick = (e: mapboxgl.MapLayerMouseEvent) => {
    if (!e.features?.length || !this.config.onPropertyClick || !this.map) return;

    const feature = e.features[0];
    const props = feature.properties || {};
    const parcelnumb = props.parcelnumb_no_formatting || props.parcelnumb || props.apn;
    const llUuid = props.ll_uuid || (feature.id ? String(feature.id) : null);

    if (!parcelnumb && !llUuid) return;

    let entry: ParcelIndexEntry | null = null;
    if (parcelnumb) {
      entry = this.resolveParcelNumber(parcelnumb);
    }
    if (!entry && llUuid) {
      entry = this.parcelIndex.get(`ll:${llUuid}`) || null;
    }
    if (entry) {
      this.config.onPropertyClick(entry.pk);
    }
  };

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
    this.loadParcelIndex();
    
    if (!this.map) return;

    const source = this.map.getSource('properties') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(this.currentData);
    }
  }

  private async loadParcelIndex() {
    if (this.parcelIndexLoaded) return;
    this.parcelIndexLoaded = true;
    try {
      const response = await fetch('/api/parcels/parcel-index');
      if (!response.ok) return;
      const data: Record<string, ParcelIndexEntry> = await response.json();
      
      this.parcelIndex.clear();

      for (const [key, entry] of Object.entries(data)) {
        if (key.startsWith('ll:')) {
          this.parcelIndex.set(key, entry);
          continue;
        }

        const normalizedKey = key.replace(/[-\s]/g, '').toUpperCase();
        this.parcelIndex.set(normalizedKey, entry);

        for (let len = normalizedKey.length - 1; len >= 10; len--) {
          const prefixKey = `prefix:${normalizedKey.substring(0, len)}`;
          const existing = this.parcelIndex.get(prefixKey);
          if (!existing) {
            this.parcelIndex.set(prefixKey, entry);
          } else {
            const existingNorm = existing.pk.replace(/[-\s]/g, '').toUpperCase();
            const existingTrailingZeros = (existingNorm.match(/0+$/) || [''])[0].length;
            const newTrailingZeros = (normalizedKey.match(/0+$/) || [''])[0].length;
            if (newTrailingZeros > existingTrailingZeros) {
              this.parcelIndex.set(prefixKey, entry);
            }
          }
        }
      }
      
      if (this.debugLogging) {
        console.log('[ParcelIndex] Loaded', Object.keys(data).length, 'properties,', this.parcelIndex.size, 'total index entries (with prefixes)');
      }
    } catch (err) {
      console.warn('[ParcelIndex] Failed to load:', err);
    }
  }

  flyTo(lat: number, lon: number, zoom: number = 16, showMarker: boolean = true) {
    if (!this.map) return;
    
    this.isAnimating = true;
    
    if (showMarker) {
      this.setSearchMarker(lat, lon);
    }
    
    this.map.flyTo({
      center: [lon, lat],
      zoom,
      duration: 1500,
    });
    
    this.map.once('moveend', () => {
      this.isAnimating = false;
    });
  }

  setSearchMarker(lat: number, lon: number) {
    if (!this.map) return;
    
    this.clearSearchMarker();
    
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
