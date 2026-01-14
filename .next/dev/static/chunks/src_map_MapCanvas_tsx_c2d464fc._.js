(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/src/map/MapCanvas.tsx [app-client] (ecmascript, next/dynamic entry, async loader)", ((__turbopack_context__) => {

__turbopack_context__.v((parentImport) => {
    return Promise.all([
  "static/chunks/node_modules_mapbox-gl_dist_mapbox-gl_b0bb8555.js",
  "static/chunks/src_map_3be07eef._.js",
  {
    "path": "static/chunks/node_modules_mapbox-gl_dist_mapbox-gl_9438b0bd.css",
    "included": [
      "[project]/node_modules/mapbox-gl/dist/mapbox-gl.css [app-client] (css)"
    ]
  },
  "static/chunks/src_map_MapCanvas_tsx_7c3bb3b0._.js"
].map((chunk) => __turbopack_context__.l(chunk))).then(() => {
        return parentImport("[project]/src/map/MapCanvas.tsx [app-client] (ecmascript, next/dynamic entry)");
    });
});
}),
]);