import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonFile, writeJsonFileAtomic } from '../utils/atomicJson.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXEC_LOG_PATH = path.resolve(__dirname, '../data/jaksafe_execution_logs.json');
const MAX_LOCAL_LOGS = 300;

export function getExecutionLogPath() {
  return process.env.JAKSAFE_EXECUTION_LOG_PATH
    ? path.resolve(process.env.JAKSAFE_EXECUTION_LOG_PATH)
    : DEFAULT_EXEC_LOG_PATH;
}

const DEFAULT_LOG_MODEL = process.env.GEMINI_REASONING_MODEL || 'gemini-3.5-flash-lite';

function inferModelTelemetry(payload) {
  const rawTel = payload?.modelTelemetry;
  if (rawTel && typeof rawTel === 'object' && rawTel.modelUsed) {
    return {
      preferredModel: rawTel.preferredModel || rawTel.primaryModel || rawTel.modelUsed,
      modelUsed: rawTel.modelUsed,
      fallbackOccurred: Boolean(rawTel.fallbackOccurred),
      fallbackCount: Number(rawTel.fallbackCount || 0),
      modelsTried: Array.isArray(rawTel.modelsTried) ? rawTel.modelsTried : [rawTel.modelUsed],
      aiMode: rawTel.aiMode || 'gemini-react',
      usedSummaryFallback: Boolean(rawTel.usedSummaryFallback),
    };
  }

  const steps = Array.isArray(payload?.reasoning) ? payload.reasoning : [];
  const isDeterministicFallback = steps.some((s) =>
    String(s?.thought || '').startsWith('Fallback mode:')
  );
  const inferredModel = isDeterministicFallback ? 'deterministic-fallback' : DEFAULT_LOG_MODEL;

  return {
    preferredModel: DEFAULT_LOG_MODEL,
    modelUsed: inferredModel,
    fallbackOccurred: isDeterministicFallback,
    fallbackCount: 0,
    modelsTried: [inferredModel],
    aiMode: isDeterministicFallback ? 'deterministic-fallback' : 'gemini-react',
    usedSummaryFallback: Boolean(rawTel?.usedSummaryFallback),
  };
}

function normalizeEndpoint(pt) {
  if (!pt || typeof pt !== 'object') return null;
  const lat = Number(pt.lat);
  const lon = Number(pt.lon);
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  const rawLabel = String(pt.label || pt.name || pt.nama || '').trim();
  const coordFallback = hasCoords ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : null;
  return {
    lat: hasCoords ? lat : null,
    lon: hasCoords ? lon : null,
    label: rawLabel || coordFallback,
  };
}

function toCompactExecutionEntry(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const route = payload.route
    ? {
      distanceM: payload.route.distanceM ?? null,
      durationS: payload.route.durationS ?? null,
      summary: payload.route.summary || null,
    }
    : null;

  const reasoning = Array.isArray(payload.reasoning)
    ? payload.reasoning.map((step) => ({
      step: step?.step,
      action: step?.action,
      thought: typeof step?.thought === 'string' ? step.thought.slice(0, 240) : '',
      durationMs: Number.isFinite(step?.durationMs) ? step.durationMs : 0,
    }))
    : [];

  return {
    requestId: payload.requestId || `req_${Date.now()}`,
    timestamp: payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString(),
    origin: normalizeEndpoint(payload.origin),
    destination: normalizeEndpoint(payload.destination),
    profile: payload.profile || 'car',
    preferences: { healthSensitive: Boolean(payload.preferences?.healthSensitive) },
    route,
    score: payload.score
      ? {
        totalScore: payload.score.totalScore ?? null,
        label: payload.score.label || null,
        color: payload.score.color || null,
      }
      : null,
    modelTelemetry: inferModelTelemetry(payload),
    reasoning,
    stepCount: reasoning.length,
    totalDurationMs: Number.isFinite(payload.totalDurationMs) ? Math.round(payload.totalDurationMs) : null,
    status: payload.status === 'failed' ? 'failed' : 'success',
    error: payload.error ? String(payload.error).slice(0, 300) : null,
  };
}

export function appendLocalExecutionLog(payload) {
  const entry = toCompactExecutionEntry(payload);
  if (!entry) return null;

  const file = getExecutionLogPath();
  const data = readJsonFile(file, () => ({ logs: [] }), { createIfMissing: false });
  const logs = Array.isArray(data?.logs) ? data.logs : [];
  logs.unshift(entry);
  if (logs.length > MAX_LOCAL_LOGS) {
    logs.length = MAX_LOCAL_LOGS;
  }
  writeJsonFileAtomic(file, { updatedAt: new Date().toISOString(), logs });
  return entry;
}

export function readLocalExecutionLogs() {
  const file = getExecutionLogPath();
  const data = readJsonFile(file, () => ({ logs: [] }), { createIfMissing: false });
  return Array.isArray(data?.logs) ? data.logs : [];
}

/**
 * Filter dan format daftar log eksekusi agen untuk audit trail admin.
 */
export function filterAndFormatExecutionLogs(
  logs,
  { limit = 30, status = 'all', scoreLabel = 'all', fallbackOnly = false } = {}
) {
  const maxItems = Math.min(Math.max(1, Number(limit) || 30), 200);
  const filtered = [];

  for (const raw of Array.isArray(logs) ? logs : []) {
    const entry = toCompactExecutionEntry(raw);
    if (!entry) continue;
    if (status && status !== 'all' && entry.status !== status) continue;
    if (scoreLabel && scoreLabel !== 'all' && (entry.score?.label || 'UNKNOWN') !== scoreLabel) continue;
    if (fallbackOnly && !entry.modelTelemetry?.fallbackOccurred) continue;
    filtered.push(entry);
    if (filtered.length >= maxItems) break;
  }

  return filtered;
}

/**
 * Hitung ringkasan performa agen dari kumpulan ExecutionLog (latensi, fallback Gemini, distribusi skor).
 */
export function summarizeExecutionLogs(logs, storage = 'local-fallback') {
  const list = Array.isArray(logs) ? logs : [];
  let successCount = 0;
  let failedCount = 0;
  let fallbackCount = 0;
  let summaryFallbackCount = 0;
  const durations = [];
  const scoreDistribution = { AMAN: 0, 'HATI-HATI': 0, HINDARI: 0, UNKNOWN: 0 };
  const profileDistribution = { car: 0, motor: 0, bike: 0, foot: 0 };
  const modelMap = new Map();

  for (const item of list) {
    if (item?.status === 'failed') failedCount += 1;
    else successCount += 1;

    const dur = Number(item?.totalDurationMs);
    if (Number.isFinite(dur) && dur >= 0) durations.push(dur);

    const lbl = item?.score?.label;
    if (lbl === 'AMAN' || lbl === 'HATI-HATI' || lbl === 'HINDARI') {
      scoreDistribution[lbl] += 1;
    } else {
      scoreDistribution.UNKNOWN += 1;
    }

    const prof = item?.profile || 'car';
    profileDistribution[prof] = (profileDistribution[prof] || 0) + 1;

    const tel = inferModelTelemetry(item);
    if (tel.fallbackOccurred) fallbackCount += 1;
    if (tel.usedSummaryFallback) summaryFallbackCount += 1;
    const modelName = tel.modelUsed;
    modelMap.set(modelName, (modelMap.get(modelName) || 0) + 1);
  }

  durations.sort((a, b) => a - b);
  const avgDurationMs = durations.length > 0
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : null;
  const p95Index = durations.length > 0
    ? Math.min(durations.length - 1, Math.floor(durations.length * 0.95))
    : -1;
  const p95DurationMs = p95Index >= 0 ? Math.round(durations[p95Index]) : null;
  const minDurationMs = durations.length > 0 ? Math.round(durations[0]) : null;
  const maxDurationMs = durations.length > 0 ? Math.round(durations[durations.length - 1]) : null;

  const totalExecutions = list.length;
  const fallbackRatePercent = totalExecutions > 0
    ? Math.round((fallbackCount / totalExecutions) * 1000) / 10
    : 0;

  const modelUsage = Array.from(modelMap.entries())
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count);

  return {
    storage,
    totalExecutions,
    successCount,
    failedCount,
    avgDurationMs,
    p95DurationMs,
    minDurationMs,
    maxDurationMs,
    fallbackCount,
    fallbackRatePercent,
    summaryFallbackCount,
    modelUsage,
    scoreDistribution,
    profileDistribution,
  };
}
