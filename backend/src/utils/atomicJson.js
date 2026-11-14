import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const lastGoodDataByPath = new Map();

function cloneSnapshot(val) {
  try {
    return structuredClone(val);
  } catch {
    return JSON.parse(JSON.stringify(val));
  }
}

/**
 * Baca berkas JSON lokal dengan fallback nilai awal jika berkas belum ada,
 * serta pemulihan dari snapshot terakhir yang valid jika terjadi korupsi parsial.
 * @template T
 * @param {string} filePath
 * @param {() => T} createDefault
 * @param {{ createIfMissing?: boolean }} [opts]
 * @returns {T}
 */
export function readJsonFile(filePath, createDefault, { createIfMissing = true } = {}) {
  const resolved = path.resolve(filePath);
  try {
    if (!fs.existsSync(resolved)) {
      const initial = createDefault();
      lastGoodDataByPath.set(resolved, cloneSnapshot(initial));
      if (createIfMissing) {
        writeJsonFileAtomic(resolved, initial);
      }
      return initial;
    }
    const raw = fs.readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw);
    lastGoodDataByPath.set(resolved, cloneSnapshot(parsed));
    return parsed;
  } catch (err) {
    console.warn(`[atomicJson] Gagal membaca ${path.basename(resolved)}:`, err?.message || err);
    try {
      if (fs.existsSync(resolved)) {
        const backupPath = `${resolved}.corrupt.${Date.now()}`;
        fs.copyFileSync(resolved, backupPath);
      }
    } catch {
      // Abaikan jika gagal menyalin file korup
    }
    if (lastGoodDataByPath.has(resolved)) {
      return cloneSnapshot(lastGoodDataByPath.get(resolved));
    }
    return createDefault();
  }
}

/**
 * Tulis berkas JSON secara atomik melalui berkas sementara unik per proses,
 * disertai penyimpanan snapshot di memori untuk mencegah kehilangan data saat konkurensi.
 * @param {string} filePath
 * @param {any} data
 */
export function writeJsonFileAtomic(filePath, data) {
  const resolved = path.resolve(filePath);
  const tmpPath = `${resolved}.tmp.${process.pid}.${crypto.randomUUID()}`;
  const payload = JSON.stringify(data, null, 2);
  lastGoodDataByPath.set(resolved, cloneSnapshot(data));
  try {
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, payload, 'utf8');
    try {
      fs.renameSync(tmpPath, resolved);
    } catch (renameErr) {
      if (renameErr?.code === 'EPERM' || renameErr?.code === 'EBUSY' || renameErr?.code === 'EACCES') {
        fs.writeFileSync(resolved, payload, 'utf8');
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    console.error(`[atomicJson] Gagal menyimpan ${path.basename(resolved)}:`, err?.message || err);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // Abaikan kegagalan pembersihan file sementara
    }
  }
}
