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
  private debugLogging = true;
  private bulkLoaded = false;
  private propertyIndex: Map<string, { propertyKey: string; commonName: string | null; address: string | null; category?: string; subcategory?: string; llUuid?: string }> = new Map();
  private hoverPopup: mapboxgl.Popup | null = null;
  private hoveredParcelId: string | number | null = null;
  private currentStyle: string = SATELLITE_STREETS_STYLE;
  private styleReady = false;
  private isAnimating = false;
  private initError: string | null = null;
  private handlersRegistered = false;
  private resizeObserver: ResizeObserver | null = null;
  private searchMarker: mapboxgl.Marker | null = null;

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
        clusterRadius: 160,
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
  private tooltipCache: Map<string, { displayName: string; address: string | null; category?: string; subcategory?: string; propertyKey?: string }> = new Map();
  private pendingApiCalls: Set<string> = new Set();

  private onParcelHover = (e: mapboxgl.MapLayerMouseEvent) => {
    if (this.debugLogging && !this.styleReady) {
      console.log('[ParcelHover] BLOCKED: styleReady=false');
    }
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
    
    const parcelnumb = props.parcelnumb || props.parcelnumb_no_formatting || props.apn;
    const llUuid = props.ll_uuid || (featureId != null ? String(featureId) : null);
    const parcelId = llUuid || parcelnumb;
    
    if (this.debugLogging) {
      console.log('[ParcelHover] featureId:', featureId, 'type:', typeof featureId, 'props.ll_uuid:', props.ll_uuid, 'parcelnumb:', parcelnumb, 'resolved llUuid:', llUuid, 'parcelId:', parcelId, 'indexSize:', this.propertyIndex.size);
    }
    
    if (!parcelId) {
      if (this.hoverPopup) this.hoverPopup.remove();
      this.currentHoveredParcelId = null;
      return;
    }

    const isSameParcel = parcelId === this.currentHoveredParcelId;
    this.currentHoveredParcelId = parcelId;

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

    let propertyInfo: ReturnType<typeof this.findPropertyByLlUuid> = null;
    if (llUuid) {
      propertyInfo = this.findPropertyByLlUuid(llUuid);
    }
    if (!propertyInfo && parcelnumb) {
      propertyInfo = this.findPropertyByParcelNumber(parcelnumb);
    }

    if (!propertyInfo) {
      propertyInfo = this.findPropertyMarkerAtPoint(e.point);
      if (this.debugLogging && propertyInfo && !isSameParcel) {
        console.log('[ParcelHover] marker fallback →', propertyInfo.propertyKey, propertyInfo.commonName);
      }
    }

    if (this.debugLogging && !isSameParcel) {
      console.log('[ParcelHover] clientMatch:', !!propertyInfo, propertyInfo ? `${propertyInfo.commonName || propertyInfo.address}` : 'none', 'hasLlIndex:', llUuid ? this.propertyIndex.has(`ll:${llUuid}`) : 'n/a');
    }

    if (propertyInfo) {
      this.tooltipCache.set(parcelId, {
        displayName: propertyInfo.commonName || propertyInfo.address || 'Unknown Property',
        address: propertyInfo.address,
        category: propertyInfo.category,
        subcategory: propertyInfo.subcategory,
        propertyKey: propertyInfo.propertyKey,
      });
      this.showTooltip(center, propertyInfo);
    } else if ((parcelnumb || llUuid) && !isSameParcel && !this.pendingApiCalls.has(parcelId)) {
      this.fetchAndShowTooltip(center, parcelnumb, parcelId, props, llUuid);
    } else if (!this.pendingApiCalls.has(parcelId)) {
      const regridAddress = props.address || props.siteaddr || props.mail_addres;
      if (regridAddress) {
        this.showTooltip(center, {
          commonName: null,
          address: regridAddress,
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

  private async fetchAndShowTooltip(center: mapboxgl.LngLat, parcelnumb: string | null, parcelId: string, regridProps?: Record<string, any>, llUuid?: string | null) {
    this.pendingApiCalls.add(parcelId);
    try {
      const params = new URLSearchParams();
      if (parcelnumb) params.set('parcelnumb', parcelnumb);
      if (llUuid) params.set('ll_uuid', llUuid);
      const response = await fetch(`/api/parcels/resolve?${params.toString()}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.displayName) {
          this.tooltipCache.set(parcelId, {
            displayName: data.displayName,
            address: data.address,
            category: data.category,
            subcategory: data.subcategory,
            propertyKey: data.propertyKey,
          });
          
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
      
      if (this.currentHoveredParcelId === parcelId && regridProps) {
        const regridAddress = regridProps.address || regridProps.siteaddr || regridProps.mail_addres;
        if (regridAddress) {
          this.tooltipCache.set(parcelId, {
            displayName: regridAddress,
            address: regridAddress,
          });
          this.showTooltip(center, {
            commonName: null,
            address: regridAddress,
            isUnimported: true,
          });
        }
      }
    } catch (err) {
      if (this.currentHoveredParcelId === parcelId && regridProps) {
        const regridAddress = regridProps.address || regridProps.siteaddr || regridProps.mail_addres;
        if (regridAddress) {
          this.showTooltip(center, {
            commonName: null,
            address: regridAddress,
            isUnimported: true,
          });
        }
      }
    } finally {
      this.pendingApiCalls.delete(parcelId);
    }
  }

  private findPropertyByParcelNumber(parcelnumb: string): { propertyKey: string; commonName: string | null; address: string | null; category?: string; subcategory?: string } | null {
    const normalizedParcel = parcelnumb.replace(/[-\s]/g, '').toUpperCase();
    
    const exact = this.propertyIndex.get(`pk:${normalizedParcel}`);
    if (exact) return exact;
    
    for (let len = normalizedParcel.length - 1; len >= 10; len--) {
      const prefix = normalizedParcel.substring(0, len);
      const prefixMatch = this.propertyIndex.get(`prefix:${prefix}`);
      if (prefixMatch) return prefixMatch;
    }
    
    return null;
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

    const hitbox: [mapboxgl.PointLike, mapboxgl.PointLike] = [
      [e.point.x - 3, e.point.y - 3],
      [e.point.x + 3, e.point.y + 3],
    ];
    const markerFeatures = this.map.queryRenderedFeatures(hitbox, {
      layers: this.map.getLayer('property-points') ? ['property-points'] : [],
    });
    if (markerFeatures && markerFeatures.length > 0) {
      const markerProps = markerFeatures[0].properties as any;
      if (markerProps?.propertyKey) {
        if (this.debugLogging) {
          console.log('[ParcelClick] Direct marker hit →', markerProps.propertyKey);
        }
        this.config.onPropertyClick(markerProps.propertyKey);
        return;
      }
    }
    
    const feature = e.features[0];
    const props = feature.properties || {};
    const parcelnumb = props.parcelnumb || props.parcelnumb_no_formatting || props.apn;
    const llUuid = props.ll_uuid || (feature.id != null ? String(feature.id) : null);
    
    const parcelId = llUuid || parcelnumb;

    if (this.debugLogging) {
      console.log('[ParcelClick] featureId:', feature.id, 'type:', typeof feature.id, 'llUuid:', llUuid, 'parcelnumb:', parcelnumb, 'parcelId:', parcelId);
    }

    if (parcelId) {
      const cached = this.tooltipCache.get(parcelId);
      if (cached?.propertyKey) {
        if (this.debugLogging) console.log('[ParcelClick] Cache hit →', cached.propertyKey);
        this.config.onPropertyClick(cached.propertyKey);
        return;
      }
    }
    
    if (llUuid) {
      const propertyInfo = this.findPropertyByLlUuid(llUuid);
      if (propertyInfo?.propertyKey) {
        if (this.debugLogging) console.log('[ParcelClick] ll_uuid match →', propertyInfo.propertyKey);
        this.config.onPropertyClick(propertyInfo.propertyKey);
        return;
      }
    }

    if (parcelnumb) {
      const propertyInfo = this.findPropertyByParcelNumber(parcelnumb);
      if (propertyInfo?.propertyKey) {
        if (this.debugLogging) console.log('[ParcelClick] parcelnumb match →', propertyInfo.propertyKey);
        this.config.onPropertyClick(propertyInfo.propertyKey);
        return;
      }
    }

    const markerMatch = this.findPropertyMarkerAtPoint(e.point);
    if (markerMatch?.propertyKey) {
      if (this.debugLogging) console.log('[ParcelClick] marker fallback →', markerMatch.propertyKey, markerMatch.commonName);
      this.config.onPropertyClick(markerMatch.propertyKey);
      return;
    }

    if (parcelnumb || llUuid) {
      try {
        const params = new URLSearchParams();
        if (parcelnumb) params.set('parcelnumb', parcelnumb);
        if (llUuid) params.set('ll_uuid', llUuid);
        if (this.debugLogging) console.log('[ParcelClick] API fallback →', params.toString());
        const response = await fetch(`/api/parcels/resolve?${params.toString()}`);
        if (response.ok) {
          const data = await response.json();
          if (data.propertyKey) {
            if (this.debugLogging) console.log('[ParcelClick] API resolved →', data.propertyKey);
            this.config.onPropertyClick(data.propertyKey);
            return;
          }
        }
      } catch (err) {
        console.warn('Parcel lookup failed', err);
      }
    }
    if (this.debugLogging) console.log('[ParcelClick] No match found');
  };

  private findPropertyByLlUuid(llUuid: string): { propertyKey: string; commonName: string | null; address: string | null; category?: string; subcategory?: string } | null {
    return this.propertyIndex.get(`ll:${llUuid}`) || null;
  }

  private findPropertyMarkerAtPoint(point: mapboxgl.Point, maxDistMeters: number = 300): { propertyKey: string; commonName: string | null; address: string | null; category?: string; subcategory?: string } | null {
    if (!this.map || !this.map.getLayer('property-points')) return null;
    const clickLngLat = this.map.unproject(point);
    const canvas = this.map.getCanvas();
    const viewportBbox: [mapboxgl.PointLike, mapboxgl.PointLike] = [[0, 0], [canvas.width, canvas.height]];
    const allMarkers = this.map.queryRenderedFeatures(viewportBbox, { layers: ['property-points'] });
    if (!allMarkers || allMarkers.length === 0) return null;

    let closest: { propertyKey: string; dist: number; props: any } | null = null;
    for (const marker of allMarkers) {
      const geom = marker.geometry as GeoJSON.Point;
      if (!geom || geom.type !== 'Point') continue;
      const [lng, lat] = geom.coordinates;
      const dlat = (lat - clickLngLat.lat) * 111320;
      const dlng = (lng - clickLngLat.lng) * 111320 * Math.cos(clickLngLat.lat * Math.PI / 180);
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);
      if (dist < maxDistMeters && (!closest || dist < closest.dist)) {
        const p = marker.properties as any;
        if (p?.propertyKey) {
          closest = { propertyKey: p.propertyKey, dist, props: p };
        }
      }
    }

    if (closest) {
      if (this.debugLogging) {
        console.log('[MarkerFallback] closest marker:', closest.propertyKey, 'dist:', Math.round(closest.dist), 'm');
      }
      const indexed = this.propertyIndex.get(`pk:${closest.propertyKey}`);
      if (indexed) return indexed;
      return {
        propertyKey: closest.propertyKey,
        commonName: closest.props.commonName || null,
        address: closest.props.address || null,
        category: closest.props.category,
        subcategory: closest.props.subcategory,
      };
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
    this.loadBulkParcelMappings();
    
    if (!this.map) return;

    const source = this.map.getSource('properties') as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(this.currentData);
    }
  }

  private async loadBulkParcelMappings() {
    if (this.bulkLoaded) return;
    this.bulkLoaded = true;
    try {
      const response = await fetch('/api/parcels/parcel-index');
      if (!response.ok) return;
      const data: Record<string, { pk: string; n: string | null; a: string | null; c: string | null; s: string | null }> = await response.json();
      
      let added = 0;
      for (const [key, info] of Object.entries(data)) {
        if (key.startsWith('ll:')) {
          if (!this.propertyIndex.has(key)) {
            const existing = this.propertyIndex.get(`pk:${info.pk.replace(/[-\s]/g, '').toUpperCase()}`);
            this.propertyIndex.set(key, {
              propertyKey: info.pk,
              commonName: info.n || existing?.commonName || null,
              address: info.a || existing?.address || null,
              category: info.c || existing?.category || undefined,
              subcategory: info.s || existing?.subcategory || undefined,
              llUuid: key.replace('ll:', ''),
            });
            added++;
          }
        } else {
          const normalizedKey = key.replace(/[-\s]/g, '').toUpperCase();
          if (!this.propertyIndex.has(`pk:${normalizedKey}`)) {
            this.propertyIndex.set(`pk:${normalizedKey}`, {
              propertyKey: info.pk,
              commonName: info.n || null,
              address: info.a || null,
              category: info.c || undefined,
              subcategory: info.s || undefined,
            });
            
            for (let len = normalizedKey.length - 1; len >= 10; len--) {
              const prefixKey = `prefix:${normalizedKey.substring(0, len)}`;
              if (!this.propertyIndex.has(prefixKey)) {
                this.propertyIndex.set(prefixKey, {
                  propertyKey: info.pk,
                  commonName: info.n || null,
                  address: info.a || null,
                  category: info.c || undefined,
                  subcategory: info.s || undefined,
                });
              }
            }
            added++;
          }
        }
      }
      if (this.debugLogging) {
        console.log('[BulkLookup] Loaded', Object.keys(data).length, 'entries, added', added, 'new entries. Index now:', this.propertyIndex.size);
      }
    } catch (err) {
      console.warn('[BulkLookup] Failed to load parcel mappings:', err);
    }
  }

  private buildPropertyIndex() {
    this.propertyIndex.clear();
    
    let llCount = 0;
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
      
      const normalizedKey = props.propertyKey.replace(/[-\s]/g, '').toUpperCase();
      this.propertyIndex.set(`pk:${normalizedKey}`, info);
      
      for (let len = normalizedKey.length - 1; len >= 10; len--) {
        const prefix = normalizedKey.substring(0, len);
        const existingKey = `prefix:${prefix}`;
        const existing = this.propertyIndex.get(existingKey);
        
        if (!existing) {
          this.propertyIndex.set(existingKey, info);
        } else {
          const existingNormalized = existing.propertyKey.replace(/[-\s]/g, '').toUpperCase();
          const existingTrailingZeros = (existingNormalized.match(/0+$/) || [''])[0].length;
          const newTrailingZeros = (normalizedKey.match(/0+$/) || [''])[0].length;
          if (newTrailingZeros > existingTrailingZeros) {
            this.propertyIndex.set(existingKey, info);
          }
        }
      }
      
      if (props.llUuid) {
        this.propertyIndex.set(`ll:${props.llUuid}`, info);
        llCount++;
      }
    }
    
    if (this.debugLogging) {
      console.log('[BuildIndex] features:', this.currentData.features.length, 'indexSize:', this.propertyIndex.size, 'llEntries:', llCount);
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
