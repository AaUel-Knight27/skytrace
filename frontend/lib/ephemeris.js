const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const AU_DAY_TO_KM_S = 1731.456836; // 1 AU/day in km/s

export function dateToJulian(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getTime() / 86400000 + 2440587.5;
}

export function julianToDate(jd) {
  return new Date((jd - 2440587.5) * 86400000);
}

export function auToSceneUnits(au, isTrueScale = false) {
  if (au <= 0) return 0;
  if (isTrueScale) {
    // 1 AU = 22 scene units (strictly linear, 1:1 geometric proportion)
    return au * 22.0;
  }
  // Visual scale: power-law scaling for breathtaking planetary visibility
  return 14 * Math.pow(au, 0.52);
}

export function solveKepler(M_rad, e, tolerance = 1e-6) {
  let E = M_rad;
  for (let iter = 0; iter < 15; iter++) {
    const f = E - e * Math.sin(E) - M_rad;
    const fPrime = 1 - e * Math.cos(E);
    const delta = f / fPrime;
    E -= delta;
    if (Math.abs(delta) < tolerance) break;
  }
  return E;
}

/**
 * Blends an old JPL Horizons state vector window with a freshly fetched vector window
 * across their overlapping Julian Date region using cubic Hermite (smoothstep) weighting.
 * Preserves C1 continuity in position and velocity so that reseeding the interpolator
 * causes zero discrete jump in 3D scene coordinates.
 */
export function blendVectorWindows(oldVectors, newVectors) {
  if (!oldVectors || oldVectors.length === 0) return newVectors || [];
  if (!newVectors || newVectors.length === 0) return oldVectors || [];

  const oldStart = oldVectors[0].jd;
  const oldEnd = oldVectors[oldVectors.length - 1].jd;
  const newStart = newVectors[0].jd;
  const newEnd = newVectors[newVectors.length - 1].jd;

  const overlapStart = Math.max(oldStart, newStart);
  const overlapEnd = Math.min(oldEnd, newEnd);

  // If no overlap, merge chronologically if sequential, or return new vectors
  if (overlapEnd <= overlapStart) {
    if (oldEnd < newStart) {
      return [...oldVectors, ...newVectors];
    }
    return newVectors;
  }

  const overlapSpan = overlapEnd - overlapStart;

  // Preserve prefix points from the earlier window (before overlapStart)
  const prefix = (oldStart < newStart ? oldVectors : newVectors).filter(
    (v) => v.jd < overlapStart
  );

  // Blend points within the overlapping region using cubic Hermite smoothstep
  const blendedOverlap = newVectors
    .filter((v) => v.jd >= overlapStart && v.jd <= overlapEnd)
    .map((v) => {
      const oldState = interpolateHorizonsVectors(oldVectors, v.jd);
      if (oldState) {
        // Cubic Hermite smoothstep weight: 0.0 at overlapStart -> 1.0 at overlapEnd
        const tau = Math.max(0, Math.min(1, (v.jd - overlapStart) / overlapSpan));
        const w = tau * tau * (3 - 2 * tau);
        const invW = 1 - w;

        return {
          ...v,
          x: invW * oldState.x + w * v.x,
          y: invW * oldState.y + w * v.y,
          z: invW * oldState.z + w * v.z,
          vx: invW * oldState.vx + w * v.vx,
          vy: invW * oldState.vy + w * v.vy,
          vz: invW * oldState.vz + w * v.vz
        };
      }
      return { ...v };
    });

  // Preserve suffix points from the later window (after overlapEnd)
  const suffix = (newEnd > oldEnd ? newVectors : oldVectors).filter(
    (v) => v.jd > overlapEnd
  );

  // Combine and deduplicate by Julian Date
  const combined = [...prefix, ...blendedOverlap, ...suffix];
  const seenJd = new Set();
  const deduped = [];
  for (const pt of combined) {
    if (!seenJd.has(pt.jd)) {
      seenJd.add(pt.jd);
      deduped.push(pt);
    }
  }

  deduped.sort((a, b) => a.jd - b.jd);
  return deduped;
}

/**
 * High-precision Hermite cubic spline interpolation between JPL Horizons state vectors.
 * Position and velocity in AU and AU/day are preserved continuously.
 */
export function interpolateHorizonsVectors(vectors, jd) {
  if (!vectors || vectors.length === 0) return null;

  // Real-time re-seed transition easing (smoothly blends old -> new across 2.5s)
  if (vectors._reseedTransition) {
    const { oldVectors, startTime, durationMs = 2500 } = vectors._reseedTransition;
    const elapsed = Date.now() - startTime;
    if (elapsed < durationMs && oldVectors && oldVectors.length > 0) {
      const trans = vectors._reseedTransition;
      vectors._reseedTransition = null;
      const oldState = interpolateHorizonsVectors(oldVectors, jd);
      const newState = interpolateHorizonsVectors(vectors, jd);
      vectors._reseedTransition = trans;

      if (oldState && newState) {
        const u = Math.max(0, Math.min(1, elapsed / durationMs));
        const alpha = u * u * (3 - 2 * u);
        const invAlpha = 1 - alpha;
        return {
          x: invAlpha * oldState.x + alpha * newState.x,
          y: invAlpha * oldState.y + alpha * newState.y,
          z: invAlpha * oldState.z + alpha * newState.z,
          vx: invAlpha * oldState.vx + alpha * newState.vx,
          vy: invAlpha * oldState.vy + alpha * newState.vy,
          vz: invAlpha * oldState.vz + alpha * newState.vz
        };
      } else if (newState) {
        return newState;
      } else if (oldState) {
        return oldState;
      }
    } else if (elapsed >= durationMs) {
      vectors._reseedTransition = null;
    }
  }

  if (vectors.length === 1) {
    const v = vectors[0];
    const dt = jd - v.jd;
    return {
      x: v.x + v.vx * dt,
      y: v.y + v.vy * dt,
      z: v.z + v.vz * dt,
      vx: v.vx,
      vy: v.vy,
      vz: v.vz
    };
  }

  const last = vectors[vectors.length - 1];

  // If date is outside the Horizons vector window, fall back to analytical Keplerian solver (no tangential drift)
  if (jd < vectors[0].jd || jd > last.jd) {
    return null;
  }

  if (jd === vectors[0].jd) return { ...vectors[0] };
  if (jd === last.jd) return { ...last };

  // Binary search for interval
  let low = 0;
  let high = vectors.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (vectors[mid].jd <= jd) {
      if (mid === vectors.length - 1 || vectors[mid + 1].jd > jd) {
        low = mid;
        break;
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const v0 = vectors[low];
  const v1 = vectors[Math.min(low + 1, vectors.length - 1)];
  const dt = v1.jd - v0.jd;
  if (dt <= 0) return { ...v0 };

  const t = (jd - v0.jd) / dt;
  const t2 = t * t;
  const t3 = t2 * t;

  // Hermite basis functions
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  const m0x = v0.vx * dt;
  const m0y = v0.vy * dt;
  const m0z = v0.vz * dt;
  const m1x = v1.vx * dt;
  const m1y = v1.vy * dt;
  const m1z = v1.vz * dt;

  return {
    x: h00 * v0.x + h10 * m0x + h01 * v1.x + h11 * m1x,
    y: h00 * v0.y + h10 * m0y + h01 * v1.y + h11 * m1y,
    z: h00 * v0.z + h10 * m0z + h01 * v1.z + h11 * m1z,
    vx: (1 - t) * v0.vx + t * v1.vx,
    vy: (1 - t) * v0.vy + t * v1.vy,
    vz: (1 - t) * v0.vz + t * v1.vz
  };
}

export function getBodyState(body, date, isTrueScale = false, bodyVectors = null) {
  if (body.id === 'm31') {
    const raRad = 10.684708 * DEG2RAD;
    const decRad = 41.26875 * DEG2RAD;
    const rSky = 22000;
    return {
      trueAU: { x: 0, y: 0, z: 0, r: 1.61e11 },
      scenePos: {
        x: rSky * Math.cos(decRad) * Math.cos(raRad),
        y: rSky * Math.sin(decRad),
        z: -rSky * Math.cos(decRad) * Math.sin(raRad)
      },
      trueAnomalyDeg: 0,
      orbitalSpeedKms: 0,
      isRealData: true,
      provenance: body.provenance || 'Source: Real SPHEREx Level-2 MEF Data (IRSA DOI 10.26131/IRSA652)'
    };
  }

  if (body.a === 0 || body.id === 'sun') {
    return {
      trueAU: { x: 0, y: 0, z: 0, r: 0 },
      scenePos: { x: 0, y: 0, z: 0 },
      trueAnomalyDeg: 0,
      orbitalSpeedKms: 0,
      isRealData: true,
      provenance: body.provenance || 'Source: Solar System Barycenter (Heliocentric)'
    };
  }

  const jd = dateToJulian(date);

  // If live or cached Horizons state vectors are available (and not Planet X)
  if (body.id !== 'planetx' && bodyVectors && bodyVectors.length > 0) {
    const interpolated = interpolateHorizonsVectors(bodyVectors, jd);
    if (interpolated) {
      const { x, y, z, vx, vy, vz } = interpolated;
      const r = Math.sqrt(x * x + y * y + z * z);
      const sceneR = auToSceneUnits(r, isTrueScale);
      const scaleFactor = r > 0 ? sceneR / r : 0;
      const speedAuDay = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const orbitalSpeedKms = speedAuDay * AU_DAY_TO_KM_S;
      const trueAnomalyDeg = ((Math.atan2(y, x) * RAD2DEG) + 360) % 360;

      return {
        trueAU: { x, y, z, r },
        scenePos: {
          x: x * scaleFactor,
          y: z * scaleFactor,
          z: -y * scaleFactor
        },
        trueAnomalyDeg,
        orbitalSpeedKms,
        isRealData: true,
        provenance: body.provenance || 'Source: JPL Horizons Ephemeris'
      };
    }
  }

  // Standard Keplerian Propagation (Default for Planet X candidate or while vectors load)
  const d = jd - 2451545.0;
  let M_deg = (body.M0 + body.n * d) % 360;
  if (M_deg < 0) M_deg += 360;
  const M_rad = M_deg * DEG2RAD;

  const E = solveKepler(M_rad, body.e);

  const xv = body.a * (Math.cos(E) - body.e);
  const yv = body.a * (Math.sqrt(1.0 - body.e * body.e) * Math.sin(E));

  const v = Math.atan2(yv, xv);
  const r = Math.sqrt(xv * xv + yv * yv);

  const omega = body.omega * DEG2RAD;
  const w = body.w * DEG2RAD;
  const i = body.i * DEG2RAD;

  const xh = r * (Math.cos(omega) * Math.cos(v + w) - Math.sin(omega) * Math.sin(v + w) * Math.cos(i));
  const yh = r * (Math.sin(omega) * Math.cos(v + w) + Math.cos(omega) * Math.sin(v + w) * Math.cos(i));
  const zh = r * (Math.sin(v + w) * Math.sin(i));

  const sceneR = auToSceneUnits(r, isTrueScale);
  const scaleFactor = r > 0 ? sceneR / r : 0;
  const orbitalSpeedKms = 29.78 * Math.sqrt(Math.max(0, 2 / r - 1 / body.a));

  return {
    trueAU: { x: xh, y: yh, z: zh, r },
    scenePos: {
      x: xh * scaleFactor,
      y: zh * scaleFactor,
      z: -yh * scaleFactor
    },
    trueAnomalyDeg: ((v * RAD2DEG) + 360) % 360,
    orbitalSpeedKms,
    isRealData: body.id !== 'planetx',
    provenance: body.provenance || (body.id === 'planetx' ? 'Source: Simulated Candidate Orbit' : 'Source: Analytical Keplerian Model')
  };
}

export function generateOrbitCurvePoints(body, segments = 220, isTrueScale = false) {
  if (body.a === 0) return [];
  const points = [];
  const omega = body.omega * DEG2RAD;
  const w = body.w * DEG2RAD;
  const i = body.i * DEG2RAD;

  for (let s = 0; s <= segments; s++) {
    const E = (s / segments) * Math.PI * 2;
    const xv = body.a * (Math.cos(E) - body.e);
    const yv = body.a * (Math.sqrt(1.0 - body.e * body.e) * Math.sin(E));
    const v = Math.atan2(yv, xv);
    const r = Math.sqrt(xv * xv + yv * yv);

    const xh = r * (Math.cos(omega) * Math.cos(v + w) - Math.sin(omega) * Math.sin(v + w) * Math.cos(i));
    const yh = r * (Math.sin(omega) * Math.cos(v + w) + Math.cos(omega) * Math.sin(v + w) * Math.cos(i));
    const zh = r * (Math.sin(v + w) * Math.sin(i));

    const sceneR = auToSceneUnits(r, isTrueScale);
    const scaleFactor = r > 0 ? sceneR / r : 0;

    points.push({
      x: xh * scaleFactor,
      y: zh * scaleFactor,
      z: -yh * scaleFactor
    });
  }
  return points;
}

export function computeSpherexParallax(body, earthState, bodyState) {
  if (!body || !bodyState || !earthState || !bodyState.trueAU || !earthState.trueAU) {
    return {
      earthDistAU: '0.00',
      parallaxArcsec: '0.0',
      parallaxArcmin: '0.00',
      properMotionArcsecYr: '0.0',
      spherexPixelsShifted: 0,
      detectability: 'Calculating...'
    };
  }

  if (body.id === 'm31') {
    return {
      earthDistAU: '1.61e11',
      parallaxArcsec: '0.0',
      parallaxArcmin: '0.00',
      properMotionArcsecYr: '0.0',
      spherexPixelsShifted: 0,
      detectability: 'Discovered Calibration Anchor (Fixed Δθ = 0″)'
    };
  }

  if (body.id === 'earth' || body.id === 'sun') {
    return {
      earthDistAU: (bodyState.trueAU.r || 0).toFixed(3),
      parallaxArcsec: '0.0',
      parallaxArcmin: '0.00',
      properMotionArcsecYr: '0.0',
      spherexPixelsShifted: 0,
      detectability: 'Reference Frame (Observatory Origin)'
    };
  }

  const dx = bodyState.trueAU.x - earthState.trueAU.x;
  const dy = bodyState.trueAU.y - earthState.trueAU.y;
  const dz = bodyState.trueAU.z - earthState.trueAU.z;
  const distFromEarthAU = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Parallax angle over 2 AU orbital baseline: tan(theta) = 2 AU / d
  const parallaxRad = Math.atan(2.0 / Math.max(0.01, distFromEarthAU));
  const parallaxArcsec = parallaxRad * RAD2DEG * 3600;
  const parallaxArcmin = parallaxArcsec / 60;

  // Approximate mean annual proper motion
  const properMotionArcsecYr = (360 / Math.pow(Math.max(0.1, body.a), 1.5)) * 3600;
  // SPHEREx native detector pixel scale = 6.2 arcsec / px
  const spherexPixelsShifted = parallaxArcsec / 6.2;

  let detectability = 'Sub-pixel shift (Centroid Astrometry)';
  if (spherexPixelsShifted >= 100) {
    detectability = `Colossal Shift (~${Math.round(spherexPixelsShifted).toLocaleString()} px / 6 mo)`;
  } else if (spherexPixelsShifted >= 2) {
    detectability = `Clearly Resolved Shift (~${Math.round(spherexPixelsShifted)} SPHEREx px / 6 mo)`;
  } else if (spherexPixelsShifted >= 0.2) {
    detectability = `PSF Centroid Detectable (~${spherexPixelsShifted.toFixed(1)} px)`;
  }

  return {
    earthDistAU: distFromEarthAU.toFixed(2),
    parallaxArcsec: parallaxArcsec.toFixed(1),
    parallaxArcmin: parallaxArcmin.toFixed(2),
    properMotionArcsecYr: properMotionArcsecYr.toFixed(1),
    spherexPixelsShifted: Math.round(spherexPixelsShifted),
    detectability
  };
}
