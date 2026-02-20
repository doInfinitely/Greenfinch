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
      existingScript.addEventListener('load', () => resolve());
      return;
    }

    window.initGoogleStreetView = () => resolve();

    const script = document.createElement('script');
    script.id = 'google-maps-script';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry&callback=initGoogleStreetView`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });
}

export default function StreetView({ apiKey, lat, lon, heading = 0, pitch = 0 }: StreetViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panoramaRef = useRef<unknown>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || !apiKey) return;

    let mounted = true;

    const initStreetView = async () => {
      try {
        await loadGoogleMapsApi(apiKey);

        if (!mounted || !containerRef.current) return;

        const sv = new google.maps.StreetViewService();
        const location = new google.maps.LatLng(lat, lon);

        const isLikelyIndoor = (data: google.maps.StreetViewPanoramaData): boolean => {
          const desc = data.location?.description?.toLowerCase() || '';
          const indoorKeywords = ['lobby', 'interior', 'inside', 'room', 'floor', 'hallway', 'office', 'suite', 'unit', 'apt'];
          if (indoorKeywords.some(kw => desc.includes(kw))) return true;
          if (data.links && data.links.length === 0) return true;
          return false;
        };

        const isLikelyBackside = (data: google.maps.StreetViewPanoramaData): boolean => {
          const desc = data.location?.description?.toLowerCase() || '';
          const backsideKeywords = ['alley', 'parking', 'lot', 'rear', 'back', 'loading', 'dock', 'driveway', 'service'];
          return backsideKeywords.some(kw => desc.includes(kw));
        };

        const scorePanorama = (data: google.maps.StreetViewPanoramaData): number => {
          let score = 100;
          if (isLikelyIndoor(data)) return -1;
          if (isLikelyBackside(data)) score -= 50;
          const desc = data.location?.description?.toLowerCase() || '';
          if (desc.includes('st') || desc.includes('ave') || desc.includes('blvd') || desc.includes('rd') || desc.includes('dr') || desc.includes('way') || desc.includes('ln')) {
            score += 20;
          }
          if (data.links && data.links.length >= 2) score += 10;
          if (data.location?.latLng) {
            const dist = google.maps.geometry?.spherical?.computeDistanceBetween(data.location.latLng, location) ?? 999;
            if (dist < 30) score += 15;
            else if (dist < 80) score += 10;
            else if (dist < 150) score += 5;
          }
          return score;
        };

        const candidates: { data: google.maps.StreetViewPanoramaData; score: number }[] = [];

        const collectCandidates = (radiusIndex: number, searchRadii: number[], skipPanoIds: Set<string>) => {
          if (!mounted || !containerRef.current) return;
          if (radiusIndex >= searchRadii.length) {
            pickBest();
            return;
          }

          sv.getPanorama(
            {
              location,
              radius: searchRadii[radiusIndex],
              source: google.maps.StreetViewSource.OUTDOOR,
              preference: google.maps.StreetViewPreference.NEAREST,
            },
            (data, panoStatus) => {
              if (!mounted || !containerRef.current) return;

              if (panoStatus === google.maps.StreetViewStatus.OK && data?.location?.latLng) {
                const panoId = data.location.pano || '';
                if (!skipPanoIds.has(panoId)) {
                  skipPanoIds.add(panoId);
                  const score = scorePanorama(data);
                  if (score >= 0) {
                    candidates.push({ data, score });
                    if (score >= 100) {
                      pickBest();
                      return;
                    }
                  }
                }
              }
              collectCandidates(radiusIndex + 1, searchRadii, skipPanoIds);
            }
          );
        };

        const pickBest = () => {
          if (!mounted || !containerRef.current) return;

          if (candidates.length === 0) {
            setStatus('unavailable');
            return;
          }

          candidates.sort((a, b) => b.score - a.score);
          const best = candidates[0].data;
          const panoLocation = best.location!.latLng!;
          const computedHeading = google.maps.geometry?.spherical?.computeHeading(
            panoLocation,
            location
          ) ?? heading;

          panoramaRef.current = new google.maps.StreetViewPanorama(containerRef.current, {
            position: panoLocation,
            pov: { heading: computedHeading, pitch },
            zoom: 1,
            addressControl: true,
            showRoadLabels: true,
            linksControl: true,
            panControl: true,
            enableCloseButton: false,
            motionTracking: false,
            motionTrackingControl: false,
            fullscreenControl: true,
          });

          setStatus('ready');
        };

        collectCandidates(0, [50, 100, 200, 350], new Set());
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
      if (panoramaRef.current) {
        panoramaRef.current = null;
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
