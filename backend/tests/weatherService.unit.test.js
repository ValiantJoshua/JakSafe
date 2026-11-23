import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  findNearestAdm4,
  getHybridWeather,
  clearWeatherCache,
  WeatherError,
} from '../src/services/weatherService.js';

describe('Unit Test: Hybrid Weather Service (BMKG + Open-Meteo Fallback)', () => {
  beforeEach(() => {
    clearWeatherCache();
  });

  it('findNearestAdm4 resolves Jabodetabek coordinates and returns null outside coverage', () => {
    const jkt = findNearestAdm4(-6.192, 106.823);
    assert.ok(jkt && jkt.station.adm4, 'Jakarta Pusat should match a verified BMKG ADM4 station');
    assert.ok(jkt.distanceM < 14000);

    const surabaya = findNearestAdm4(-7.2575, 112.7521);
    assert.equal(surabaya, null);
  });

  it('uses BMKG as primary source for Jabodetabek and caches subsequent requests', async () => {
    let calls = 0;
    const fakeFetch = async (url) => {
      calls += 1;
      assert.match(url, /api\.bmkg\.go\.id\/publik\/prakiraan-cuaca\?adm4=/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{
            lokasi: { kotkab: 'Kota Adm. Jakarta Pusat', kecamatan: 'Menteng', desa: 'Menteng' },
            cuaca: [[{
              utc_datetime: new Date().toISOString().slice(0, 19).replace('T', ' '),
              local_datetime: '2026-11-23 15:00:00',
              t: 30,
              hu: 72,
              ws: 11.5,
              wd: 'NE',
              tcc: 55,
              vs_text: '> 10 km',
              weather_desc: 'Berawan',
              weather_desc_en: 'Mostly Cloudy',
            }]],
          }],
        }),
      };
    };

    const w1 = await getHybridWeather({ lat: -6.192, lon: 106.823 }, { fetchImpl: fakeFetch });
    assert.equal(w1.source, 'bmkg');
    assert.equal(w1.temperatureC, 30);
    assert.equal(w1.humidityPct, 72);
    assert.equal(w1.location.district, 'Menteng');
    assert.match(w1.attribution, /BMKG/);
    assert.equal(w1.cached, false);

    const w2 = await getHybridWeather({ lat: -6.192, lon: 106.823 }, { fetchImpl: fakeFetch });
    assert.equal(w2.cached, true);
    assert.equal(calls, 1);
  });

  it('falls back cleanly to Open-Meteo when BMKG returns 403 or errors', async () => {
    const fakeFetch = async (url) => {
      if (url.includes('api.bmkg.go.id')) {
        return { ok: false, status: 403, json: async () => ({}) };
      }
      assert.match(url, /api\.open-meteo\.com\/v1\/forecast/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          current: {
            time: '2026-11-23T15:00',
            temperature_2m: 28.4,
            apparent_temperature: 31.2,
            relative_humidity_2m: 78,
            precipitation: 1.4,
            weather_code: 61,
            cloud_cover: 85,
            wind_speed_10m: 9.2,
          },
        }),
      };
    };

    const w = await getHybridWeather({ lat: -6.192, lon: 106.823 }, { fetchImpl: fakeFetch });
    assert.equal(w.source, 'open-meteo');
    assert.equal(w.temperatureC, 28);
    assert.equal(w.isRain, true);
    assert.equal(w.condition, 'Hujan Ringan');
    assert.equal(w.precipitationMm, 1.4);
  });

  it('rejects invalid coordinates with WeatherError 400', async () => {
    await assert.rejects(
      () => getHybridWeather({ lat: 999, lon: 106.8 }),
      (err) => err instanceof WeatherError && err.status === 400,
    );
  });
});
