import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ExternalLink, Copy, Check, MapPin, AlertCircle, Phone } from 'lucide-react';

interface LocationMapProps {
  latitude?: number | string | null;
  longitude?: number | string | null;
  accuracy?: number | null;
  residentName?: string;
  residentPhone?: string;
  height?: string | number;
  className?: string;
  zoom?: number;
}

// Custom crisp SVG pin icon for emergency incident
const incidentIcon = L.divIcon({
  className: 'custom-emergency-pin',
  html: `
    <div style="
      position: relative;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translate(-16px, -32px);
    ">
      <div style="
        width: 32px;
        height: 32px;
        background: #D9381E;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 4px 10px rgba(217, 56, 30, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid #ffffff;
      ">
        <div style="
          width: 10px;
          height: 10px;
          background: #ffffff;
          border-radius: 50%;
        "></div>
      </div>
      <div style="
        position: absolute;
        bottom: -4px;
        width: 12px;
        height: 4px;
        background: rgba(0,0,0,0.25);
        border-radius: 50%;
        filter: blur(1px);
      "></div>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

export const LocationMap: React.FC<LocationMapProps> = ({
  latitude,
  longitude,
  accuracy,
  residentName,
  residentPhone,
  height = '240px',
  className = '',
  zoom = 16,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [copied, setCopied] = useState(false);

  const latNum = latitude !== null && latitude !== undefined && latitude !== '' ? parseFloat(String(latitude)) : null;
  const lngNum = longitude !== null && longitude !== undefined && longitude !== '' ? parseFloat(String(longitude)) : null;
  const hasCoords = latNum !== null && !isNaN(latNum) && lngNum !== null && !isNaN(lngNum);

  useEffect(() => {
    if (!hasCoords || !mapContainerRef.current) return;

    // Initialize Leaflet map
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [latNum, lngNum],
        zoom: zoom,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    } else {
      mapInstanceRef.current.setView([latNum, lngNum], zoom);
    }

    const map = mapInstanceRef.current;

    // Clear existing markers/layers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Circle) {
        map.removeLayer(layer);
      }
    });

    // Add marker
    const marker = L.marker([latNum, lngNum], { icon: incidentIcon }).addTo(map);
    if (residentName) {
      marker.bindPopup(`<b>${residentName}</b><br/>Location captured`).openPopup();
    }

    // Add accuracy circle if provided
    if (accuracy && accuracy > 0) {
      L.circle([latNum, lngNum], {
        radius: accuracy,
        color: '#D9381E',
        fillColor: '#FFEDE5',
        fillOpacity: 0.35,
        weight: 1.5,
      }).addTo(map);
    }

    // Invalidate size after render to fix container sizing
    setTimeout(() => {
      map.invalidateSize();
    }, 150);

    return () => {
      // Keep instance or cleanup on unmount
    };
  }, [hasCoords, latNum, lngNum, accuracy, residentName, zoom]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  const handleCopy = () => {
    if (!hasCoords) return;
    const text = `${latNum?.toFixed(6)}, ${lngNum?.toFixed(6)}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!hasCoords) {
    return (
      <div
        className={`rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-center ${className}`}
        style={{ minHeight: '160px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      >
        <AlertCircle className="w-8 h-8 text-amber-600 mb-2" />
        <p className="font-semibold text-neutral-900 text-sm">Location not shared by device</p>
        <p className="text-xs text-neutral-600 mt-1 max-w-sm">
          The reporting device did not share GPS coordinates. Please call the resident directly to confirm their exact location.
        </p>
        {residentPhone && (
          <a
            href={`tel:${residentPhone}`}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 transition"
          >
            <Phone className="w-3.5 h-3.5" />
            Call Resident ({residentPhone})
          </a>
        )}
      </div>
    );
  }

  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${latNum},${lngNum}`;

  return (
    <div className={`overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs ${className}`}>
      {/* Map display */}
      <div
        ref={mapContainerRef}
        style={{ height: typeof height === 'number' ? `${height}px` : height, width: '100%', minHeight: '180px' }}
      />

      {/* Footer bar with coordinate pill & action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-neutral-50 border-t border-neutral-200 text-xs">
        <div className="flex items-center gap-2 text-neutral-600">
          <MapPin className="w-3.5 h-3.5 text-red-600 shrink-0" />
          <span className="font-mono text-[11px] font-medium text-neutral-800">
            {latNum?.toFixed(5)}, {lngNum?.toFixed(5)}
          </span>
          {accuracy && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-neutral-200 text-neutral-700 text-[10px]">
              &plusmn;{Math.round(accuracy)}m
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-100 transition cursor-pointer"
            title="Copy Coordinates"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-red-600 text-white font-medium hover:bg-red-700 transition"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open Maps</span>
          </a>
        </div>
      </div>
    </div>
  );
};

export default LocationMap;

