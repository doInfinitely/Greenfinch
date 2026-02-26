'use client';

import { useRef, useEffect, useState } from 'react';

interface StreetViewProps {
  apiKey: string;
  lat: number;
  lon: number;
  heading?: number;
  pitch?: number;
}

declare global {
  interface Window {
    initGoogleStreetView?: () => void;
  }
}

function loadGoogleMapsApi(apiKey: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.maps) {
      resolve();
      return;
    }

    const existingScript = document.getElementById('google-maps-script');
    if (existingScript) {
      if ((existingScript as any)._loaded || (typeof google !== 'undefined' && google.maps)) {
        resolve();
      } else {
        const onLoad = () => resolve();
        existingScript.addEventListener('load', onLoad);
        const checkInterval = setInterval(() => {
          if (typeof google !== 'undefined' && google.maps) {
            clearInterval(checkInterval);
            existingScript.removeEventListener('load', onLoad);
            resolve();
          }
        }, 200);
        setTimeout(() => {
          clearInterval(checkInterval);
          existingScript.removeEventListener('load', onLoad);
          if (typeof google !== 'undefined' && google.maps) {
            resolve();
          } else {
            reject(new Error('Google Maps load timeout'));
          }
        }, 15000);
      }
      return;
    }

    window.initGoogleStreetView = () => {
      const s = document.getElementById('google-maps-script');
      if (s) (s as any)._loaded = true;
      resolve();
    };

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry&callback=initGoogleStreetView`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
}

export default function StreetView({ apiKey, lat, lon, heading = 0, pitch = 10 }: StreetViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const miniMapRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<unknown>(null);
  const miniMapInstanceRef = useRef<unknown>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 1024);
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !apiKey) return;

    let mounted = true;

    const hardTimeout = setTimeout(() => {
      if (mounted && statusRef.current === 'loading') {
        setStatus('unavailable');
      }
    }, 12000);

    const initStreetView = async () => {
      try {
        await loadGoogleMapsApi(apiKey);

        if (!mounted || !containerRef.current) return;

        const sv = new google.maps.StreetViewService();
        const propertyLocation = new google.maps.LatLng(lat, lon);
        const desktop = window.innerWidth >= 1024;

        const radiusAttempts = [50, 150, 500];

        const tryRadius = (index: number) => {
          if (!mounted || !containerRef.current) return;
          if (index >= radiusAttempts.length) {
            setStatus('unavailable');
            return;
          }

          sv.getPanorama(
            {
              location: propertyLocation,
              radius: radiusAttempts[index],
              source: google.maps.StreetViewSource.OUTDOOR,
              preference: google.maps.StreetViewPreference.NEAREST,
            },
            (data, panoStatus) => {
              if (!mounted || !containerRef.current) return;

              if (panoStatus === google.maps.StreetViewStatus.OK && data?.location?.latLng) {
                const panoLocation = data.location.latLng;

                const computedHeading = google.maps.geometry?.spherical?.computeHeading(
                  panoLocation,
                  propertyLocation
                ) ?? heading;

                const panorama = new google.maps.StreetViewPanorama(containerRef.current!, {
                  pano: data.location.pano!,
                  pov: {
                    heading: computedHeading,
                    pitch,
                  },
                  zoom: 0,
                  clickToGo: desktop,
                  linksControl: desktop,
                  motionTracking: false,
                  motionTrackingControl: false,
                  addressControl: true,
                  fullscreenControl: true,
                  panControl: true,
                  enableCloseButton: false,
                });

                panoramaRef.current = panorama;

                if (desktop && miniMapRef.current) {
                  const miniMap = new google.maps.Map(miniMapRef.current, {
                    center: panoLocation,
                    zoom: 15,
                    disableDefaultUI: true,
                    zoomControl: true,
                    mapTypeId: google.maps.MapTypeId.ROADMAP,
                    streetViewControl: true,
                    gestureHandling: 'greedy',
                  });

                  miniMap.setStreetView(panorama);
                  miniMapInstanceRef.current = miniMap;

                  const propertyMarker = new google.maps.Marker({
                    position: propertyLocation,
                    map: miniMap,
                    title: 'Property Location',
                    icon: {
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 6,
                      fillColor: '#16a34a',
                      fillOpacity: 1,
                      strokeColor: '#ffffff',
                      strokeWeight: 2,
                    },
                  });
                  void propertyMarker;
                }

                setStatus('ready');
              } else {
                tryRadius(index + 1);
              }
            }
          );
        };

        tryRadius(0);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load Street View');
          setStatus('unavailable');
        }
      }
    };

    initStreetView();

    return () => {
      mounted = false;
      clearTimeout(hardTimeout);
      if (panoramaRef.current) {
        panoramaRef.current = null;
      }
      if (miniMapInstanceRef.current) {
        miniMapInstanceRef.current = null;
      }
    };
  }, [apiKey, lat, lon, heading, pitch]);

  if (status === 'unavailable') {
    return (
      <div className="w-full h-full bg-gray-100 flex items-center justify-center">
        <div className="text-center p-4">
          <svg className="w-10 h-10 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <p className="text-sm text-gray-500">
            {error || 'Street View not available for this location'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {isDesktop && (
        <div
          ref={miniMapRef}
          data-testid="streetview-minimap"
          className="absolute bottom-4 left-4 rounded-md shadow-lg border border-gray-300 bg-white"
          style={{
            width: 200,
            height: 150,
            display: status === 'ready' ? 'block' : 'none',
            zIndex: 10,
          }}
        />
      )}
      {status === 'loading' && (
        <div className="absolute inset-0 bg-gray-100 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-2"></div>
            <p className="text-sm text-gray-500">Loading Street View...</p>
          </div>
        </div>
      )}
    </div>
  );
}
