import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONITORED_CORRIDORS,
  classifyCorridorAlert,
  recordVisionHazardObservation,
  clearVisionHazardObservations,
  getActiveHazardAlerts,
  findAlertsAlongRoute,
} from '../src/services/hazardAlertService.js';

describe('Unit Test: Peringatan Area Rawan (HazardAlertService)', () => {
  beforeEach(() => {
    clearVisionHazardObservations();
  });

  after(() => {
    clearVisionHazardObservations();
  });

  it('mengklasifikasikan koridor saat hujan lebat dan curah hujan aktif ke tingkat Siaga/Waspada', () => {
    const grogol = MONITORED_CORRIDORS.find((c) => c.id === 'grogol-nurdin');
    const thamrin = MONITORED_CORRIDORS.find((c) => c.id === 'thamrin-bundaran');
    assert.ok(grogol);
    assert.ok(thamrin);

    const stormAlert = classifyCorridorAlert(thamrin, {
      weather: { precipitationMm: 9.2, weatherCode: 95, weatherLabel: 'Hujan petir', fetchedAt: '2026-11-14T00:00:00Z' },
    });
    assert.equal(stormAlert.severity, 'siaga');
    assert.ok(stormAlert.signals.includes('Hujan Lebat Real-Time'));

    const rainFloodRisk = classifyCorridorAlert(grogol, {
      weather: { precipitationMm: 2.1, weatherCode: 61, weatherLabel: 'Hujan ringan–sedang' },
    });
    assert.equal(rainFloodRisk.severity, 'siaga');
  });

  it('menaikkan status koridor menjadi Siaga ketika AI Vision mendeteksi genangan air', async () => {
    const semanggi = MONITORED_CORRIDORS.find((c) => c.id === 'semanggi-gatot-subroto');
    recordVisionHazardObservation({
      cameraId: semanggi.cameraId,
      cameraName: semanggi.corridor,
      lat: semanggi.lat,
      lon: semanggi.lon,
      analysis: {
        genangan_air: true,
        tingkat_genangan: 'parah',
        kondisi_jalan: 'macet',
        catatan_singkat: 'Air menutup lajur kiri depan JPO Polda',
        confidence: 0.92,
      },
    });

    const result = await getActiveHazardAlerts({
      weatherByRegion: {
        'Jakarta Selatan': { region: 'Jakarta Selatan', precipitationMm: 0, weatherCode: 1, weatherLabel: 'Berawan' },
      },
    });
    const matched = result.alerts.find((a) => a.id === semanggi.id);
    assert.ok(matched);
    assert.equal(matched.severity, 'siaga');
    assert.ok(matched.signals.includes('AI Vision CCTV (Genangan)'));
    assert.match(matched.summary, /genangan/i);
  });

  it('menemukan hanya area rawan yang benar-benar dilintasi geometri rute dalam radius aman', async () => {
    // Rute melewati Simpang Semanggi (-6.2238, 106.8142) & Thamrin (-6.1885, 106.8235), jauh dari Grogol & Tanjung Priok
    const geometry = [
      [106.8235, -6.1885],
      [106.8200, -6.2050],
      [106.8142, -6.2238],
    ];
    const alerts = MONITORED_CORRIDORS.map((c) => classifyCorridorAlert(c, {}));
    const hits = await findAlertsAlongRoute(geometry, { radiusM: 600, alerts });

    assert.ok(hits.some((a) => a.id === 'semanggi-gatot-subroto'));
    assert.ok(hits.some((a) => a.id === 'thamrin-bundaran'));
    assert.equal(hits.some((a) => a.id === 'tanjung-priok-atp'), false);
  });
});

