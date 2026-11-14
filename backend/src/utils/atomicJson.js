import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Baca berkas JSON lokal dengan fallback nilai awal jika berkas belum ada atau rusak.
 * @template T
 * @param {string} filePath
 * @param {() => T} createDefault
 * @param {{ createIfMissing?: boolean }} [opts]
 * @returns {T}
 */
export function readJsonFile(filePath, createDefault, { createIfMissing = true } = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      const initial = createDefault();
      if (createIfMissing) {
        writeJsonFileAtomic(filePath, initial);
      }
      return initial;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[atomicJson] Gagal membaca ${path.basename(filePath)}:`, err?.message || err);
    return createDefault();
  }
}

/**
 * Tulis berkas JSON secara atomik melalui berkas sementara unik per proses,
 * dengan fallback tulis langsung saat Windows/OneDrive menahan renameSync (EPERM/EBUSY).
 * @param {string} filePath
 * @param {any} data
 */
export function writeJsonFileAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${crypto.randomUUID()}`;
  const payload = JSON.stringify(data, null, 2);
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, payload, 'utf8');
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (renameErr) {
      if (renameErr?.code === 'EPERM' || renameErr?.code === 'EBUSY' || renameErr?.code === 'EACCES') {
        fs.writeFileSync(filePath, payload, 'utf8');
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    console.error(`[atomicJson] Gagal menyimpan ${path.basename(filePath)}:`, err?.message || err);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // Abaikan kegagalan pembersihan file sementara
    }
  }
}
