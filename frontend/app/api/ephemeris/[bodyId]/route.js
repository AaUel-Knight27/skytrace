import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Memory cache for Horizons ephemeris data
// Map<bodyId, { timestamp: number, data: any }>
const ephemerisCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours

export const HORIZONS_BODY_MAP = {
  mercury: { id: '199', name: 'Mercury' },
  venus: { id: '299', name: 'Venus' },
  earth: { id: '399', name: 'Earth' },
  mars: { id: '499', name: 'Mars' },
  ceres: { id: '2000001', name: 'Ceres' },
  jupiter: { id: '599', name: 'Jupiter' },
  saturn: { id: '699', name: 'Saturn' },
  uranus: { id: '799', name: 'Uranus' },
  neptune: { id: '899', name: 'Neptune' },
  pluto: { id: '999', name: 'Pluto' },
  eris: { id: '136199', name: 'Eris' },
  sedna: { id: '90377', name: '90377 Sedna' }
};

function parseHorizonsVectors(resultText) {
  const soeIdx = resultText.indexOf('$$SOE');
  const eoeIdx = resultText.indexOf('$$EOE');
  if (soeIdx === -1 || eoeIdx === -1) {
    throw new Error('Horizons response missing $$SOE/$$EOE vector block');
  }

  const block = resultText.slice(soeIdx + 5, eoeIdx);
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const vectors = [];

  for (let i = 0; i < lines.length; ) {
    if (lines[i].includes('=') && lines[i].includes('A.D.')) {
      const parts = lines[i].split('=');
      const jd = parseFloat(parts[0].trim());
      const dateStr = parts[1] ? parts[1].trim() : '';
      i++;

      const posLine = lines[i] || '';
      i++;
      const velLine = lines[i] || '';
      i++;

      const posMatch = posLine.match(/X\s*=\s*([-+0-9.E]+)\s*Y\s*=\s*([-+0-9.E]+)\s*Z\s*=\s*([-+0-9.E]+)/i);
      const velMatch = velLine.match(/VX\s*=\s*([-+0-9.E]+)\s*VY\s*=\s*([-+0-9.E]+)\s*VZ\s*=\s*([-+0-9.E]+)/i);

      if (posMatch && velMatch) {
        vectors.push({
          jd,
          dateStr,
          x: parseFloat(posMatch[1]),
          y: parseFloat(posMatch[2]),
          z: parseFloat(posMatch[3]),
          vx: parseFloat(velMatch[1]),
          vy: parseFloat(velMatch[2]),
          vz: parseFloat(velMatch[3])
        });
      }
    } else {
      i++;
    }
  }

  return vectors;
}

// In-flight request deduplication map to prevent concurrent thundering herd on Horizons API
const inFlightFetches = new Map();

function loadDiskFallback(bodyId) {
  const candidatePaths = [
    path.join(process.cwd(), 'public', 'data', 'fallback', 'ephemeris', `${bodyId}.json`),
    path.join(process.cwd(), 'frontend', 'public', 'data', 'fallback', 'ephemeris', `${bodyId}.json`)
  ];

  for (const fallbackPath of candidatePaths) {
    try {
      if (fs.existsSync(fallbackPath)) {
        const raw = fs.readFileSync(fallbackPath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          ...parsed,
          isFallback: true,
          provenance: `Source: JPL Horizons (Cached offline fallback, snapshot ${parsed.fetchedAt || '2026-10'})`
        };
      }
    } catch {
      // quiet fallback
    }
  }
  return null;
}

// Pre-seed cache from verified disk snapshots on module init for instant cold start
for (const [key] of Object.entries(HORIZONS_BODY_MAP)) {
  const initialData = loadDiskFallback(key);
  if (initialData) {
    ephemerisCache.set(key, { timestamp: 0, data: initialData });
  }
}

async function fetchLiveHorizons(bodyId, cid, startTime = '2025-01-01', stopTime = '2027-07-01') {
  const url = `https://ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='${cid}'&EPHEM_TYPE=VECTORS&CENTER='500@10'&START_TIME='${startTime}'&STOP_TIME='${stopTime}'&STEP_SIZE='5d'&OUT_UNITS='AU-D'&REF_PLANE='ECLIPTIC'`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SkyTrace/2.0 (NASA Space Apps)' }
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Horizons returned HTTP ${res.status}`);
    }

    const json = await res.json();
    const resultText = json.result || '';
    const vectors = parseHorizonsVectors(resultText);

    return {
      bodyId,
      horizonsCommand: cid,
      provenance: `Source: JPL Horizons (Live REST API, fetched ${new Date().toISOString()})`,
      fetchedAt: new Date().toISOString(),
      isFallback: false,
      step: '5d',
      count: vectors.length,
      vectors
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const bodyId = (resolvedParams?.bodyId || '').toLowerCase();

  // Special case: Planet X is a candidate, not a confirmed body
  if (bodyId === 'planetx') {
    return NextResponse.json({
      bodyId: 'planetx',
      name: 'Planet X (Hypothesis)',
      provenance: 'Source: simulated candidate orbit (Battygin & Brown 2016 / 2021)',
      candidate: true,
      isFallback: false,
      statusLabel: 'Candidate — not yet confirmed',
      vectors: []
    });
  }

  // Special case: The Sun is the barycentric/heliocentric origin
  if (bodyId === 'sun') {
    return NextResponse.json({
      bodyId: 'sun',
      name: 'The Sun',
      provenance: 'Source: Heliocentric Origin (0,0,0)',
      candidate: false,
      isFallback: false,
      vectors: []
    });
  }

  const mapping = HORIZONS_BODY_MAP[bodyId];
  if (!mapping) {
    return NextResponse.json({ error: `Unknown body: ${bodyId}` }, { status: 404 });
  }

  // Check in-memory cache (can be bypassed with ?refresh=true or ?fresh=1 for live sync ticks)
  const { searchParams } = new URL(request.url);
  const forceFresh = searchParams.get('refresh') === 'true' || searchParams.get('fresh') === '1';
  const startTime = searchParams.get('start') || '2025-01-01';
  const stopTime = searchParams.get('stop') || '2027-07-01';
  const cached = ephemerisCache.get(bodyId);
  const now = Date.now();

  // Return non-stale live cache immediately if fresh and not forced
  if (!forceFresh && cached && cached.data && !cached.data.isFallback && now - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'X-SkyTrace-Source': 'memory-cache'
      }
    });
  }

  // Deduplicate live fetch via shared in-flight Promise
  const flightKey = `${bodyId}_${startTime}_${stopTime}`;

  // If request is not forcing fresh, and we already have cached disk snapshot data:
  // serve it immediately without blocking the client on external network calls,
  // and trigger background live Horizons revalidation for observer Earth
  if (!forceFresh && cached && cached.data && cached.data.isFallback) {
    if (bodyId === 'earth' && !inFlightFetches.has(flightKey)) {
      const bgPromise = fetchLiveHorizons(bodyId, mapping.id, startTime, stopTime)
        .then((liveData) => {
          ephemerisCache.set(bodyId, { timestamp: Date.now(), data: liveData });
        })
        .catch(() => {})
        .finally(() => {
          inFlightFetches.delete(flightKey);
        });
      inFlightFetches.set(flightKey, bgPromise);
    }

    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'X-SkyTrace-Source': 'disk-fallback'
      }
    });
  }

  try {
    let livePromise = inFlightFetches.get(flightKey);
    if (!livePromise) {
      livePromise = fetchLiveHorizons(bodyId, mapping.id, startTime, stopTime).finally(() => {
        inFlightFetches.delete(flightKey);
      });
      inFlightFetches.set(flightKey, livePromise);
    }

    const liveData = await livePromise;
    ephemerisCache.set(bodyId, { timestamp: now, data: liveData });
    return NextResponse.json(liveData, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'X-SkyTrace-Source': 'jpl-horizons-live'
      }
    });
  } catch (liveErr) {
    // If live fetch is aborted, times out, or fails, gracefully return cached or committed fallback
    if (cached && cached.data) {
      return NextResponse.json(cached.data, {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
          'X-SkyTrace-Source': cached.data.isFallback ? 'disk-fallback' : 'stale-cache'
        }
      });
    }

    const fallback = loadDiskFallback(bodyId);
    if (fallback) {
      ephemerisCache.set(bodyId, { timestamp: now, data: fallback });
      return NextResponse.json(fallback, {
        headers: {
          'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
          'X-SkyTrace-Source': 'disk-fallback'
        }
      });
    }

    return NextResponse.json(
      { error: `Ephemeris unavailable for ${bodyId}`, details: liveErr.message },
      { status: 502 }
    );
  }
}

