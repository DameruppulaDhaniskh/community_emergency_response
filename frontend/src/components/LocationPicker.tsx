import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, Search, AlertCircle, Check } from 'lucide-react';

interface LocationPickerProps {
  value?: {
    latitude?: number | string | null;
    longitude?: number | string | null;
    label?: string;
  };
  onChange: (loc: { latitude: number; longitude: number; label?: string } | null) => void;
  required?: boolean;
  label?: string;
  hint?: string;
  height?: string | number;
  initialCenter?: [number, number];
}

// Crisp custom SVG pin icon that is draggable
const pickerIcon = L.divIcon({
  className: 'custom-picker-pin',
  html: `
    <div style="
      position: relative;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: translate(-18px, -36px);
      cursor: grab;
    ">
      <div style="
        width: 36px;
        height: 36px;
        background: #D9381E;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 4px 12px rgba(217, 56, 30, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2.5px solid #ffffff;
      ">
        <div style="
          width: 12px;
          height: 12px;
          background: #ffffff;
          border-radius: 50%;
        "></div>
      </div>
      <div style="
        position: absolute;
        bottom: -5px;
        width: 14px;
        height: 5px;
        background: rgba(0,0,0,0.3);
        border-radius: 50%;
        filter: blur(1px);
      "></div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 36],
});

export const LocationPicker: React.FC<LocationPickerProps> = ({
  value,
  onChange,
  required = false,
  label = 'Pin Location on Map',
  hint = 'Drag the pin or click on the map to set your location.',
  height = '240px',
  initialCenter = [12.9716, 77.5946], // Default Bengaluru center
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const latNum =
    value?.latitude !== null && value?.latitude !== undefined && value?.latitude !== ''
      ? parseFloat(String(value.latitude))
      : null;
  const lngNum =
    value?.longitude !== null && value?.longitude !== undefined && value?.longitude !== ''
      ? parseFloat(String(value.longitude))
      : null;
  const hasCoords = latNum !== null && !isNaN(latNum) && lngNum !== null && !isNaN(lngNum);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [geoLocating, setGeoLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const [manualLat, setManualLat] = useState<string>(latNum ? latNum.toFixed(6) : '');
  const [manualLng, setManualLng] = useState<string>(lngNum ? lngNum.toFixed(6) : '');

  // Keep manual inputs synced with incoming prop
  useEffect(() => {
    if (latNum !== null && !isNaN(latNum)) setManualLat(latNum.toFixed(6));
    if (lngNum !== null && !isNaN(lngNum)) setManualLng(lngNum.toFixed(6));
  }, [latNum, lngNum]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const center: [number, number] = hasCoords ? [latNum!, lngNum!] : initialCenter;
      const map = L.map(mapContainerRef.current, {
        center,
        zoom: hasCoords ? 16 : 14,
        zoomControl: true,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      // Click on map to place/move marker
      map.on('click', (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        updateLocation(lat, lng);
      });

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Update or create marker
    if (hasCoords) {
      if (!markerRef.current) {
        const marker = L.marker([latNum!, lngNum!], {
          icon: pickerIcon,
          draggable: true,
        }).addTo(map);

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          updateLocation(pos.lat, pos.lng);
        });

        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng([latNum!, lngNum!]);
      }
      map.setView([latNum!, lngNum!], map.getZoom() || 16);
    } else {
      if (markerRef.current) {
        map.removeLayer(markerRef.current);
        markerRef.current = null;
      }
    }

    setTimeout(() => {
      map.invalidateSize();
    }, 150);
  }, [hasCoords, latNum, lngNum]);

  // Clean up
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  const updateLocation = (lat: number, lng: number, placeLabel?: string) => {
    const roundedLat = parseFloat(lat.toFixed(6));
    const roundedLng = parseFloat(lng.toFixed(6));
    setManualLat(roundedLat.toFixed(6));
    setManualLng(roundedLng.toFixed(6));
    onChange({
      latitude: roundedLat,
      longitude: roundedLng,
      label: placeLabel || value?.label || '',
    });
  };

  // Search places with debounce
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 3) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            searchQuery
          )}&limit=4&addressdetails=1`
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data || []);
        }
      } catch {
        // Silently fail network search in offline/restricted environment
      } finally {
        setIsSearching(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectResult = (item: { display_name: string; lat: string; lon: string }) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    if (!isNaN(lat) && !isNaN(lng)) {
      updateLocation(lat, lng, item.display_name.split(',')[0]);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([lat, lng], 16);
      }
      setSearchResults([]);
      setSearchQuery('');
    }
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation is not supported by your browser.');
      return;
    }

    setGeoLocating(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLocating(false);
        const { latitude, longitude } = pos.coords;
        updateLocation(latitude, longitude, 'Current Device Location');
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([latitude, longitude], 17);
        }
      },
      (err) => {
        setGeoLocating(false);
        setGeoError(err.message || 'Unable to retrieve your current location.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleManualApply = () => {
    const parsedLat = parseFloat(manualLat);
    const parsedLng = parseFloat(manualLng);
    if (!isNaN(parsedLat) && !isNaN(parsedLng) && parsedLat >= -90 && parsedLat <= 90 && parsedLng >= -180 && parsedLng <= 180) {
      updateLocation(parsedLat, parsedLng);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setView([parsedLat, parsedLng], 16);
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-neutral-800">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={geoLocating}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:text-red-700 transition cursor-pointer"
        >
          <Navigation className={`w-3.5 h-3.5 ${geoLocating ? 'animate-spin' : ''}`} />
          {geoLocating ? 'Finding...' : 'Use My Current Location'}
        </button>
      </div>

      {hint && <p className="text-xs text-neutral-500">{hint}</p>}

      {geoError && (
        <div className="flex items-center gap-1.5 p-2 rounded-lg bg-red-50 text-red-700 text-xs border border-red-200">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{geoError}</span>
        </div>
      )}

      {/* Address Search Bar */}
      <div className="relative">
        <div className="flex items-center rounded-xl border border-neutral-300 bg-white px-3 py-1.5 shadow-xs focus-within:border-red-500 focus-within:ring-2 focus-within:ring-red-200">
          <Search className="w-4 h-4 text-neutral-400 shrink-0 mr-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search society, landmark, or street name..."
            className="w-full text-xs text-neutral-900 bg-transparent focus:outline-hidden"
          />
          {isSearching && <span className="text-[10px] text-neutral-400 animate-pulse">Searching...</span>}
        </div>

        {/* Search Results Dropdown */}
        {searchResults.length > 0 && (
          <div className="absolute z-1000 mt-1 w-full rounded-xl border border-neutral-200 bg-white py-1 shadow-lg max-h-48 overflow-y-auto text-xs">
            {searchResults.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelectResult(item)}
                className="w-full px-3 py-2 text-left hover:bg-neutral-50 flex items-start gap-2 text-neutral-700"
              >
                <MapPin className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                <span className="line-clamp-1">{item.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map View */}
      <div className="overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-xs relative">
        <div
          ref={mapContainerRef}
          style={{ height: typeof height === 'number' ? `${height}px` : height, width: '100%' }}
        />
        {!hasCoords && (
          <div className="absolute inset-0 bg-neutral-900/10 pointer-events-none flex items-center justify-center">
            <span className="bg-white/90 backdrop-blur-xs px-3 py-1.5 rounded-full text-xs font-medium text-neutral-700 shadow-sm border border-neutral-200">
              Click map or search above to place pin
            </span>
          </div>
        )}
      </div>

      {/* Coordinate Display & Manual Fallback */}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
        <div className="flex items-center gap-1.5 bg-neutral-100 px-2.5 py-1.5 rounded-lg border border-neutral-200">
          <span className="text-neutral-500 font-medium">Lat:</span>
          <input
            type="text"
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            placeholder="12.971600"
            className="w-20 font-mono text-neutral-800 bg-transparent focus:outline-hidden"
          />
        </div>
        <div className="flex items-center gap-1.5 bg-neutral-100 px-2.5 py-1.5 rounded-lg border border-neutral-200">
          <span className="text-neutral-500 font-medium">Lng:</span>
          <input
            type="text"
            value={manualLng}
            onChange={(e) => setManualLng(e.target.value)}
            placeholder="77.594600"
            className="w-20 font-mono text-neutral-800 bg-transparent focus:outline-hidden"
          />
        </div>
        <button
          type="button"
          onClick={handleManualApply}
          className="px-2.5 py-1.5 rounded-lg bg-neutral-200 hover:bg-neutral-300 text-neutral-700 font-medium transition cursor-pointer"
        >
          Set Pin
        </button>

        {hasCoords && (
          <span className="ml-auto inline-flex items-center gap-1 text-emerald-600 font-medium">
            <Check className="w-3.5 h-3.5" />
            Pin Saved
          </span>
        )}
      </div>
    </div>
  );
};

export default LocationPicker;

