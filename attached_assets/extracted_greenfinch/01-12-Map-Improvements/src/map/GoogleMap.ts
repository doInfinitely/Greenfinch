import { setOptions, importLibrary } from '@googlemaps/js-api-loader';
import { GoogleMapsOverlay } from '@deck.gl/google-maps';
import { MVTLayer } from '@deck.gl/geo-layers';
import { MarkerClusterer } from '@googlemaps/markerclusterer';

let googleMapsOptionsSet = false;

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface GoogleMapConfig {
  container: HTMLElement;
  apiKey: string;
  regridToken?: string;
  initialCenter?: { lat: number; lon: number };
  initialZoom?: number;
  onBoundsChange?: (bounds: MapBounds, zoom: number) => void;
  onPropertyClick?: (propertyKey: string) => void;
}

interface PropertyFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    propertyKey: string;
    address: string;
    commonName: string | null;
    enriched: boolean;
  };
}

export class GoogleMapController {
  private map: google.maps.Map | null = null;
  private config: GoogleMapConfig;
  private isDestroyed = false;
  private currentData: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  private pendingData: GeoJSON.FeatureCollection | null = null;
  private deckOverlay: GoogleMapsOverlay | null = null;
  private markers: google.maps.marker.AdvancedMarkerElement[] = [];
  private clusterer: MarkerClusterer | null = null;
  private infoWindow: google.maps.InfoWindow | null = null;
  private currentZoom = 10;
  private isSatellite = false;
  private isInitialized = false;
  private hoveredParcelId: string | number | null = null;
  private hoverDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: GoogleMapConfig) {
    this.config = config;
    this.initialize();
  }

  private async initialize() {
    if (!googleMapsOptionsSet) {
      setOptions({
        key: this.config.apiKey,
        v: 'weekly',
      });
      googleMapsOptionsSet = true;
    }

    try {
      await importLibrary('maps');
      await importLibrary('marker');
      if (this.isDestroyed) return;

      const initialCenter = this.config.initialCenter || { lat: 32.8639, lon: -96.7784 };
      const initialZoom = this.config.initialZoom || 12;

      this.map = new google.maps.Map(this.config.container, {
        center: { lat: initialCenter.lat, lng: initialCenter.lon },
        zoom: initialZoom,
        mapId: 'greenfinch-map',
        mapTypeId: 'roadmap',
        mapTypeControl: true,
        mapTypeControlOptions: {
          position: google.maps.ControlPosition.TOP_RIGHT,
        },
        fullscreenControl: false,
        streetViewControl: false,
      });

      this.currentZoom = initialZoom;
      this.infoWindow = new google.maps.InfoWindow();

      this.setupDeckOverlay();
      this.setupEventListeners();
      this.emitBounds();
      
      this.isInitialized = true;
      
      if (this.pendingData) {
        this.setData(this.pendingData);
        this.pendingData = null;
      }
    } catch (error) {
      console.error('Failed to load Google Maps:', error);
    }
  }

  private setupDeckOverlay() {
    if (!this.map || !this.config.regridToken) return;

    this.deckOverlay = new GoogleMapsOverlay({
      layers: this.createLayers(),
    });

    this.deckOverlay.setMap(this.map);
  }

  private createLayers() {
    const layers = [];
    const zoom = this.currentZoom;
    const showParcels = zoom >= 15;

    if (showParcels && this.config.regridToken) {
      layers.push(
        new MVTLayer({
          id: 'regrid-parcels',
          data: `https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${this.config.regridToken}`,
          minZoom: 10,
          maxZoom: 21,
          uniqueIdProperty: 'll_uuid',
          getFillColor: [0, 0, 0, 0],
          getLineColor: [34, 197, 94, 200],
          getLineWidth: 2,
          lineWidthUnits: 'pixels',
          pickable: true,
          autoHighlight: true,
          highlightColor: [34, 197, 94, 80],
          maxRequests: 6,
          loadOptions: {
            fetch: {
              cache: 'force-cache',
            },
          },
          onClick: (info: any) => {
            if (info.object) {
              this.handleParcelClick(info);
            }
          },
          onHover: (info: any) => {
            if (info.object && this.map) {
              this.config.container.style.cursor = 'pointer';
              
              if (this.hoverDebounceTimer) {
                clearTimeout(this.hoverDebounceTimer);
              }
              this.hoverDebounceTimer = setTimeout(() => {
                this.hoveredParcelId = info.object?.properties?.ll_uuid || null;
              }, 16);
            } else {
              this.config.container.style.cursor = '';
              this.hoveredParcelId = null;
            }
          },
        })
      );
    }

    return layers;
  }

  private handleParcelClick(info: any) {
    const coords = info.coordinate;
    if (!coords) return;

    const [lng, lat] = coords;
    const tolerance = 0.0005;

    for (const feature of this.currentData.features) {
      if (feature.geometry.type === 'Point') {
        const [fLng, fLat] = feature.geometry.coordinates as [number, number];
        if (Math.abs(fLng - lng) < tolerance && Math.abs(fLat - lat) < tolerance) {
          const props = feature.properties as any;
          if (props?.propertyKey && this.config.onPropertyClick) {
            this.config.onPropertyClick(props.propertyKey);
          }
          return;
        }
      }
    }
  }

  private setupEventListeners() {
    if (!this.map) return;

    this.map.addListener('idle', () => {
      if (this.isDestroyed) return;
      this.emitBounds();
    });

    this.map.addListener('zoom_changed', () => {
      if (this.isDestroyed || !this.map) return;
      const newZoom = this.map.getZoom() || 10;
      const oldZoom = this.currentZoom;
      this.currentZoom = newZoom;

      const wasAbove15 = oldZoom >= 15;
      const isAbove15 = newZoom >= 15;

      if (wasAbove15 !== isAbove15) {
        this.updateMapType();
        this.updateLayers();
        this.updateMarkerVisibility();
      }
    });
  }

  private updateMapType() {
    if (!this.map) return;
    const shouldBeSatellite = this.currentZoom >= 15;

    if (shouldBeSatellite && !this.isSatellite) {
      this.map.setMapTypeId('hybrid');
      this.isSatellite = true;
    } else if (!shouldBeSatellite && this.isSatellite) {
      this.map.setMapTypeId('roadmap');
      this.isSatellite = false;
    }
  }

  private updateLayers() {
    if (this.deckOverlay) {
      this.deckOverlay.setProps({
        layers: this.createLayers(),
      });
    }
  }

  private updateMarkerVisibility() {
    const showClusters = this.currentZoom < 15;

    this.markers.forEach(marker => {
      marker.map = showClusters ? null : this.map;
    });

    if (this.clusterer) {
      if (showClusters) {
        this.clusterer.addMarkers(this.markers);
      } else {
        this.clusterer.clearMarkers();
      }
    }
  }

  private emitBounds() {
    if (!this.map || !this.config.onBoundsChange) return;

    const bounds = this.map.getBounds();
    if (!bounds) return;

    const ne = bounds.getNorthEast();
    const sw = bounds.getSouthWest();

    this.config.onBoundsChange(
      {
        north: ne.lat(),
        south: sw.lat(),
        east: ne.lng(),
        west: sw.lng(),
      },
      this.map.getZoom() || 10
    );
  }

  setData(geojson: GeoJSON.FeatureCollection) {
    if (!this.isInitialized) {
      this.pendingData = geojson;
      return;
    }
    
    this.currentData = geojson;
    this.updateMarkers();
  }

  private async updateMarkers() {
    if (!this.map) return;

    this.markers.forEach(marker => {
      marker.map = null;
    });
    this.markers = [];

    if (this.clusterer) {
      this.clusterer.clearMarkers();
    }

    const { AdvancedMarkerElement } = await google.maps.importLibrary('marker') as google.maps.MarkerLibrary;

    for (const feature of this.currentData.features as PropertyFeature[]) {
      if (feature.geometry.type !== 'Point') continue;

      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties;

      const markerContent = document.createElement('div');
      markerContent.className = 'google-map-marker';
      markerContent.style.cssText = `
        width: 24px;
        height: 24px;
        background-color: ${props.enriched ? '#22c55e' : '#6b7280'};
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        cursor: pointer;
      `;

      const marker = new AdvancedMarkerElement({
        position: { lat, lng },
        content: markerContent,
        title: props.commonName || props.address,
      });

      marker.addListener('click', () => {
        if (this.config.onPropertyClick) {
          this.config.onPropertyClick(props.propertyKey);
        }
      });

      marker.addListener('mouseover', () => {
        if (this.infoWindow && this.map) {
          const content = props.enriched && props.commonName 
            ? `<div style="padding: 4px;"><strong>${props.commonName}</strong><br/>${props.address}</div>`
            : `<div style="padding: 4px;">${props.address}</div>`;
          this.infoWindow.setContent(content);
          this.infoWindow.open(this.map, marker);
        }
      });

      marker.addListener('mouseout', () => {
        if (this.infoWindow) {
          this.infoWindow.close();
        }
      });

      this.markers.push(marker);
    }

    this.clusterer = new MarkerClusterer({
      map: this.map,
      markers: this.currentZoom < 15 ? this.markers : [],
      renderer: {
        render: ({ count, position }) => {
          const content = document.createElement('div');
          content.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            background-color: #22c55e;
            border: 3px solid white;
            border-radius: 50%;
            color: white;
            font-weight: bold;
            font-size: 14px;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          `;
          content.textContent = String(count);

          return new google.maps.marker.AdvancedMarkerElement({
            position,
            content,
          });
        },
      },
    });

    if (this.currentZoom >= 15) {
      this.markers.forEach(marker => {
        marker.map = this.map;
      });
    }
  }

  flyTo(lat: number, lon: number, zoom?: number) {
    if (!this.map) return;
    this.map.panTo({ lat, lng: lon });
    if (zoom) {
      this.map.setZoom(zoom);
    }
  }

  destroy() {
    this.isDestroyed = true;

    if (this.hoverDebounceTimer) {
      clearTimeout(this.hoverDebounceTimer);
      this.hoverDebounceTimer = null;
    }

    if (this.deckOverlay) {
      this.deckOverlay.setMap(null);
      this.deckOverlay = null;
    }

    this.markers.forEach(marker => {
      marker.map = null;
    });
    this.markers = [];

    if (this.clusterer) {
      this.clusterer.clearMarkers();
      this.clusterer = null;
    }

    if (this.infoWindow) {
      this.infoWindow.close();
      this.infoWindow = null;
    }

    this.map = null;
  }
}
