(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/src/map/DashboardMap.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DashboardMap",
    ()=>DashboardMap
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$mapbox$2d$gl$2f$dist$2f$mapbox$2d$gl$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/mapbox-gl/dist/mapbox-gl.js [app-client] (ecmascript)");
;
const LIGHT_STYLE = 'mapbox://styles/mapbox/light-v11';
const SATELLITE_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
class DashboardMap {
    map = null;
    config;
    isDestroyed = false;
    currentData = {
        type: 'FeatureCollection',
        features: []
    };
    hoverPopup = null;
    hoveredParcelId = null;
    currentStyle = LIGHT_STYLE;
    styleReady = false;
    pendingStyleSwitch = null;
    constructor(config){
        this.config = config;
        this.initialize();
    }
    initialize() {
        __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$mapbox$2d$gl$2f$dist$2f$mapbox$2d$gl$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].accessToken = this.config.accessToken;
        const initialZoom = this.config.initialZoom ?? 13;
        const initialCenter = this.config.initialCenter ? [
            this.config.initialCenter.lon,
            this.config.initialCenter.lat
        ] : [
            -96.7784,
            32.8639
        ];
        const initialStyle = initialZoom >= 14 ? SATELLITE_STYLE : LIGHT_STYLE;
        this.currentStyle = initialStyle;
        this.map = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$mapbox$2d$gl$2f$dist$2f$mapbox$2d$gl$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].Map({
            container: this.config.container,
            style: initialStyle,
            center: initialCenter,
            zoom: initialZoom,
            attributionControl: false
        });
        this.map.addControl(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$mapbox$2d$gl$2f$dist$2f$mapbox$2d$gl$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].NavigationControl(), 'top-right');
        this.map.addControl(new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$mapbox$2d$gl$2f$dist$2f$mapbox$2d$gl$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].AttributionControl({
            compact: true
        }), 'bottom-right');
        this.hoverPopup = new __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$mapbox$2d$gl$2f$dist$2f$mapbox$2d$gl$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 15
        });
        this.map.on('load', ()=>{
            if (this.isDestroyed) return;
            this.onStyleReady();
        });
        this.map.on('moveend', ()=>{
            if (this.isDestroyed) return;
            this.emitBounds();
        });
        this.map.on('zoom', ()=>{
            if (this.isDestroyed || !this.map || !this.styleReady) return;
            this.updateLayerVisibility();
            this.checkStyleSwitch();
        });
    }
    checkStyleSwitch() {
        if (!this.map || !this.styleReady) return;
        const zoom = this.map.getZoom();
        const shouldBeSatellite = zoom >= 15;
        const needsSatellite = shouldBeSatellite && this.currentStyle !== SATELLITE_STYLE;
        const needsLight = !shouldBeSatellite && this.currentStyle !== LIGHT_STYLE;
        if (needsSatellite) {
            this.switchStyle(SATELLITE_STYLE);
        } else if (needsLight) {
            this.switchStyle(LIGHT_STYLE);
        }
    }
    switchStyle(newStyle) {
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
        this.map.once('style.load', ()=>{
            if (!this.map || this.isDestroyed) return;
            // Restore position
            this.map.jumpTo({
                center,
                zoom,
                bearing,
                pitch
            });
            // Restore data
            this.currentData = dataToRestore;
            // Re-setup everything
            this.onStyleReady();
        });
    }
    onStyleReady() {
        if (!this.map) return;
        this.addSources();
        this.addLayers();
        this.registerEventHandlers();
        this.updateLayerVisibility();
        this.emitBounds();
        // Mark ready after a short delay to let tiles start loading
        setTimeout(()=>{
            this.styleReady = true;
        }, 50);
    }
    addSources() {
        if (!this.map) return;
        // Property points source
        if (!this.map.getSource('properties')) {
            this.map.addSource('properties', {
                type: 'geojson',
                data: this.currentData,
                cluster: true,
                clusterMaxZoom: 14,
                clusterRadius: 160
            });
        }
        // Regrid parcel source
        if (this.config.regridToken && !this.map.getSource('regrid')) {
            this.map.addSource('regrid', {
                type: 'vector',
                tiles: [
                    `https://tiles.regrid.com/api/v1/parcels/{z}/{x}/{y}.mvt?token=${this.config.regridToken}`
                ],
                minzoom: 10,
                maxzoom: 21,
                promoteId: 'll_uuid'
            });
        }
    }
    addLayers() {
        if (!this.map) return;
        // Add parcel layers first (below markers)
        if (this.config.regridToken && this.map.getSource('regrid')) {
            if (!this.map.getLayer('parcels-fill')) {
                this.map.addLayer({
                    id: 'parcels-fill',
                    type: 'fill',
                    source: 'regrid',
                    'source-layer': 'parcels',
                    paint: {
                        'fill-color': '#22c55e',
                        'fill-opacity': [
                            'case',
                            [
                                'boolean',
                                [
                                    'feature-state',
                                    'hover'
                                ],
                                false
                            ],
                            0.25,
                            0
                        ]
                    }
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
                        'line-width': 1.5
                    }
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
                    filter: [
                        'has',
                        'point_count'
                    ],
                    paint: {
                        'circle-color': '#22c55e',
                        'circle-radius': [
                            'step',
                            [
                                'get',
                                'point_count'
                            ],
                            24,
                            50,
                            32,
                            200,
                            42
                        ]
                    }
                });
            }
            if (!this.map.getLayer('cluster-count')) {
                this.map.addLayer({
                    id: 'cluster-count',
                    type: 'symbol',
                    source: 'properties',
                    filter: [
                        'has',
                        'point_count'
                    ],
                    layout: {
                        'text-field': '{point_count_abbreviated}',
                        'text-font': [
                            'DIN Offc Pro Medium',
                            'Arial Unicode MS Bold'
                        ],
                        'text-size': 13
                    },
                    paint: {
                        'text-color': '#ffffff'
                    }
                });
            }
            if (!this.map.getLayer('property-points')) {
                this.map.addLayer({
                    id: 'property-points',
                    type: 'circle',
                    source: 'properties',
                    filter: [
                        '!',
                        [
                            'has',
                            'point_count'
                        ]
                    ],
                    paint: {
                        'circle-color': '#22c55e',
                        'circle-radius': 8,
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#ffffff'
                    }
                });
            }
        }
    }
    registerEventHandlers() {
        if (!this.map) return;
        // Remove existing handlers by using named functions would be better,
        // but for simplicity we just re-register (Mapbox handles duplicates)
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
    onClusterClick = (e)=>{
        if (!this.map || !e.features?.length) return;
        const clusterId = e.features[0].properties?.cluster_id;
        const coords = e.features[0].geometry.coordinates;
        const source = this.map.getSource('properties');
        source.getClusterExpansionZoom(clusterId, (err, zoom)=>{
            if (err || !this.map) return;
            this.map.easeTo({
                center: coords,
                zoom: zoom || 14,
                duration: 500
            });
        });
    };
    onPropertyPointClick = (e)=>{
        if (!e.features?.length) return;
        const propertyKey = e.features[0].properties?.propertyKey;
        if (propertyKey && this.config.onPropertyClick) {
            this.config.onPropertyClick(propertyKey);
        }
    };
    onCursorPointer = ()=>{
        if (this.map) this.map.getCanvas().style.cursor = 'pointer';
    };
    onCursorDefault = ()=>{
        if (this.map) this.map.getCanvas().style.cursor = '';
    };
    onParcelHover = (e)=>{
        if (!this.map || !this.styleReady || !e.features?.length) return;
        const feature = e.features[0];
        const featureId = feature.id;
        if (this.hoveredParcelId !== null && this.hoveredParcelId !== featureId) {
            try {
                this.map.setFeatureState({
                    source: 'regrid',
                    sourceLayer: 'parcels',
                    id: this.hoveredParcelId
                }, {
                    hover: false
                });
            } catch (err) {
            // Ignore
            }
        }
        if (featureId !== undefined) {
            this.hoveredParcelId = featureId;
            try {
                this.map.setFeatureState({
                    source: 'regrid',
                    sourceLayer: 'parcels',
                    id: featureId
                }, {
                    hover: true
                });
            } catch (err) {
            // Ignore
            }
            const props = feature.properties || {};
            const address = props.address || 'Unknown Address';
            const center = e.lngLat;
            const propertyInfo = this.findPropertyByLocation(center.lng, center.lat);
            const commonName = propertyInfo?.commonName;
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
    onParcelLeave = ()=>{
        if (!this.map) return;
        this.map.getCanvas().style.cursor = '';
        if (this.hoveredParcelId !== null && this.styleReady) {
            try {
                this.map.setFeatureState({
                    source: 'regrid',
                    sourceLayer: 'parcels',
                    id: this.hoveredParcelId
                }, {
                    hover: false
                });
            } catch (err) {
            // Ignore
            }
            this.hoveredParcelId = null;
        }
        if (this.hoverPopup) {
            this.hoverPopup.remove();
        }
    };
    onParcelClick = (e)=>{
        if (!e.features?.length) return;
        const center = e.lngLat;
        const propertyInfo = this.findPropertyByLocation(center.lng, center.lat);
        if (propertyInfo?.propertyKey && this.config.onPropertyClick) {
            this.config.onPropertyClick(propertyInfo.propertyKey);
        }
    };
    findPropertyByLocation(lng, lat) {
        const tolerance = 0.0005;
        for (const feature of this.currentData.features){
            if (feature.geometry.type === 'Point') {
                const [fLng, fLat] = feature.geometry.coordinates;
                if (Math.abs(fLng - lng) < tolerance && Math.abs(fLat - lat) < tolerance) {
                    const props = feature.properties;
                    return {
                        propertyKey: props?.propertyKey || null,
                        commonName: props?.commonName || null
                    };
                }
            }
        }
        return null;
    }
    updateLayerVisibility() {
        if (!this.map) return;
        const zoom = this.map.getZoom();
        const showParcels = zoom >= 15;
        const showClusters = zoom < 15;
        const setVisibility = (layerId, visible)=>{
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
    emitBounds() {
        if (!this.map || !this.config.onBoundsChange) return;
        const bounds = this.map.getBounds();
        if (!bounds) return;
        this.config.onBoundsChange({
            north: bounds.getNorth(),
            south: bounds.getSouth(),
            east: bounds.getEast(),
            west: bounds.getWest()
        }, this.map.getZoom());
    }
    setData(geojson) {
        this.currentData = geojson;
        if (!this.map) return;
        const source = this.map.getSource('properties');
        if (source) {
            source.setData(this.currentData);
        }
    }
    flyTo(lat, lon, zoom = 16) {
        if (!this.map) return;
        this.map.flyTo({
            center: [
                lon,
                lat
            ],
            zoom,
            duration: 1500
        });
    }
    destroy() {
        this.isDestroyed = true;
        if (this.hoverPopup) {
            this.hoverPopup.remove();
            this.hoverPopup = null;
        }
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/map/MapCanvas.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>__TURBOPACK__default__export__
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$map$2f$DashboardMap$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/src/map/DashboardMap.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
'use client';
;
;
;
const MapCanvas = /*#__PURE__*/ _s((0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["forwardRef"])(_c = _s(({ accessToken, regridToken, properties, initialCenter, initialZoom, onBoundsChange, onPropertyClick }, ref)=>{
    _s();
    const containerRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const mapRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const callbacksRef = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])({
        onBoundsChange,
        onPropertyClick
    });
    callbacksRef.current = {
        onBoundsChange,
        onPropertyClick
    };
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useImperativeHandle"])(ref, {
        "MapCanvas.useImperativeHandle": ()=>({
                flyTo: ({
                    "MapCanvas.useImperativeHandle": (lat, lon, zoom = 16)=>{
                        mapRef.current?.flyTo(lat, lon, zoom);
                    }
                })["MapCanvas.useImperativeHandle"]
            })
    }["MapCanvas.useImperativeHandle"]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "MapCanvas.useEffect": ()=>{
            if (!containerRef.current || mapRef.current) return;
            mapRef.current = new __TURBOPACK__imported__module__$5b$project$5d2f$src$2f$map$2f$DashboardMap$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["DashboardMap"]({
                container: containerRef.current,
                accessToken,
                regridToken,
                initialCenter,
                initialZoom,
                onBoundsChange: {
                    "MapCanvas.useEffect": (bounds, zoom)=>{
                        callbacksRef.current.onBoundsChange?.(bounds, zoom);
                    }
                }["MapCanvas.useEffect"],
                onPropertyClick: {
                    "MapCanvas.useEffect": (propertyKey)=>{
                        callbacksRef.current.onPropertyClick?.(propertyKey);
                    }
                }["MapCanvas.useEffect"]
            });
            return ({
                "MapCanvas.useEffect": ()=>{
                    if (mapRef.current) {
                        mapRef.current.destroy();
                        mapRef.current = null;
                    }
                }
            })["MapCanvas.useEffect"];
        }
    }["MapCanvas.useEffect"], [
        accessToken,
        regridToken,
        initialCenter,
        initialZoom
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "MapCanvas.useEffect": ()=>{
            if (!mapRef.current) return;
            mapRef.current.setData({
                type: 'FeatureCollection',
                features: properties
            });
        }
    }["MapCanvas.useEffect"], [
        properties
    ]);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        ref: containerRef,
        className: "w-full h-full"
    }, void 0, false, {
        fileName: "[project]/src/map/MapCanvas.tsx",
        lineNumber: 75,
        columnNumber: 10
    }, ("TURBOPACK compile-time value", void 0));
}, "ZPQkqTTDI4bWhmmQFul6pRZSxpY=")), "ZPQkqTTDI4bWhmmQFul6pRZSxpY=");
_c1 = MapCanvas;
MapCanvas.displayName = 'MapCanvas';
const __TURBOPACK__default__export__ = MapCanvas;
var _c, _c1;
__turbopack_context__.k.register(_c, "MapCanvas$forwardRef");
__turbopack_context__.k.register(_c1, "MapCanvas");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/src/map/MapCanvas.tsx [app-client] (ecmascript, next/dynamic entry)", ((__turbopack_context__) => {

__turbopack_context__.n(__turbopack_context__.i("[project]/src/map/MapCanvas.tsx [app-client] (ecmascript)"));
}),
]);

//# sourceMappingURL=src_map_3be07eef._.js.map