import { Router } from 'express';

const router = Router();

/**
 * Endpoint Geocoding: Menerjemahkan nama jalan, gedung, atau alamat spesifik
 * (misal "jalan duta indah II", "blok m plaza", "kemang timur") menjadi koordinat { lat, lon }.
 *
 * Menggunakan prioritas:
 * 1. Deteksi koordinat langsung (format "lat, lon" atau "lon, lat")
 * 2. Google Maps Geocoding API (jika GOOGLE_MAPS_API_KEY tersedia)
 * 3. Fallback OpenStreetMap Photon / Nominatim (gratis, akurat, tanpa kuota)
 */
router.get('/', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    return res.status(400).json({ ok: false, error: 'Query q diperlukan' });
  }

  // 1. Cek apakah pengguna langsung mengetik koordinat angka
  const coordMatch = query.match(/^([-+]?\d{1,2}(?:\.\d+)?)[,\s]+([-+]?\d{1,3}(?:\.\d+)?)$/);
  if (coordMatch) {
    const a = Number(coordMatch[1]);
    const b = Number(coordMatch[2]);
    // Di Indonesia: lat berkisar -11 s/d 6, lon berkisar 95 s/d 141
    const lat = Math.abs(a) <= 90 && a < 15 ? a : b;
    const lon = lat === a ? b : a;
    return res.json({
      ok: true,
      places: [
        {
          id: `coord-${lat.toFixed(4)}-${lon.toFixed(4)}`,
          nama: `Titik Koordinat [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
          area: 'Koordinat Kustom',
          lat,
          lon,
        },
      ],
    });
  }

  const googleKey = process.env.GOOGLE_MAPS_API_KEY || '';

  // 2. Coba Google Maps Geocoding jika kunci tersedia
  if (googleKey) {
    try {
      const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&components=country:ID&language=id&key=${encodeURIComponent(googleKey)}`;
      const gRes = await fetch(gUrl);
      if (gRes.ok) {
        const gData = await gRes.json();
        if (gData.status === 'OK' && Array.isArray(gData.results) && gData.results.length > 0) {
          const places = gData.results.slice(0, 6).map((item, idx) => {
            const loc = item.geometry?.location || {};
            // Ambil nama singkat dan nama area
            const parts = item.formatted_address.split(',');
            const nama = parts[0]?.trim() || item.formatted_address;
            const area = parts.slice(1, 3).join(',').trim() || 'DKI Jakarta';
            return {
              id: `gmaps-${item.place_id || idx}`,
              nama,
              area,
              alamatLengkap: item.formatted_address,
              lat: loc.lat,
              lon: loc.lng,
            };
          });
          return res.json({ ok: true, source: 'google', places });
        }
      }
    } catch (e) {
      console.warn('[geocode] Google Geocoding fallback to Photon:', e.message);
    }
  }

  // 3. Fallback ke Photon (OSM geocoder cepat, bebas CORS & tanpa auth, diutamakan area Jabodetabek)
  try {
    const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=-6.2088&lon=106.8456&limit=6&lang=en`;
    const pRes = await fetch(photonUrl);
    if (pRes.ok) {
      const pData = await pRes.json();
      const features = Array.isArray(pData.features) ? pData.features : [];
      if (features.length > 0) {
        const places = features.map((f, idx) => {
          const props = f.properties || {};
          const [lon, lat] = f.geometry?.coordinates || [106.8456, -6.2088];
          const nama = props.name || props.street || query;
          const areaParts = [props.district, props.city || props.county, props.state].filter(Boolean);
          const area = areaParts.length > 0 ? areaParts.join(', ') : 'Indonesia';
          return {
            id: `osm-${props.osm_id || idx}`,
            nama,
            area,
            lat,
            lon,
          };
        });
        return res.json({ ok: true, source: 'osm-photon', places });
      }
    }
  } catch (e) {
    console.warn('[geocode] Photon geocoding error:', e.message);
  }

  // 4. Fallback ke OpenStreetMap Nominatim
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=id&format=json&limit=5&addressdetails=1`;
    const nRes = await fetch(nomUrl, {
      headers: { 'User-Agent': 'JakSafe-Navigation-App/1.0' },
    });
    if (nRes.ok) {
      const nData = await nRes.json();
      if (Array.isArray(nData) && nData.length > 0) {
        const places = nData.map((item) => {
          const addr = item.address || {};
          const nama = item.name || addr.road || addr.suburb || query;
          const area = [addr.suburb || addr.city_district, addr.city || addr.regency].filter(Boolean).join(', ') || 'Jakarta';
          return {
            id: `nom-${item.place_id}`,
            nama,
            area,
            lat: Number(item.lat),
            lon: Number(item.lon),
          };
        });
        return res.json({ ok: true, source: 'osm-nominatim', places });
      }
    }
  } catch (e) {
    console.warn('[geocode] Nominatim geocoding error:', e.message);
  }

  return res.json({ ok: true, source: 'none', places: [] });
});

export default router;

