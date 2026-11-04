'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { SPHEREX_BANDS } from '../lib/catalog';

const DEFAULT_EPOCH_1 = '/data/img/m31/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.png';
const DEFAULT_EPOCH_2 = '/data/img/m31/level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.png';

export default function BlinkComparator({
  selectedBody,
  parallaxInfo,
  onSelectBody,
  onSyncEpochDate,
  isOpen,
  onClose,
  livePasses = {},
  onActivePassesChange
}) {
  const [targets, setTargets] = useState([]);
  const [selectedTargetIndex, setSelectedTargetIndex] = useState(0);
  const [compareMode, setCompareMode] = useState('blink'); // 'blink' | 'split' | 'diff'
  const [isAutoBlinking, setIsAutoBlinking] = useState(false);
  const [activeEpoch, setActiveEpoch] = useState(0); // 0 = 2025-W29, 1 = 2026-W32, etc.
  const [blinkIntervalMs, setBlinkIntervalMs] = useState(600);
  const [splitPercent, setSplitPercent] = useState(50);
  const [diffMultiplier, setDiffMultiplier] = useState(2.8);
  const [diffColorMap, setDiffColorMap] = useState('thermal'); // 'thermal' | 'grayscale' | 'dipole'
  const [selectedBand, setSelectedBand] = useState(SPHEREX_BANDS[0]);
  const [quietNotice, setQuietNotice] = useState(null);
  const [bandIndex102, setBandIndex102] = useState(38); // Band 1 to 102
  const [showTransientMarker, setShowTransientMarker] = useState(true);
  const [hoverPixel, setHoverPixel] = useState(null);
  const [dataSource, setDataSource] = useState('loading'); // 'live' | 'fallback'
  const [mefTelemetry, setMefTelemetry] = useState(null);

  const canvasRef = useRef(null);
  const imgARef = useRef(null);
  const imgBRef = useRef(null);
  const cutoutContainerRef = useRef(null);

  // 1. Fetch multi-epoch cutouts for selected body via Next.js proxy route
  useEffect(() => {
    let isMounted = true;
    const bodyParam = selectedBody?.id ? `?bodyId=${encodeURIComponent(selectedBody.id)}` : '';
    fetch(`/api/spherex/targets${bodyParam}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const sourceHeader = r.headers.get('X-SkyTrace-Backend');
        if (isMounted) {
          setDataSource(sourceHeader === 'python-microservice-live' ? 'live' : 'fallback');
        }
        return r.json();
      })
      .then((data) => {
        if (!isMounted || !data) return;
        const list = Array.isArray(data) ? data : data.targets || Object.values(data);
        if (list && list.length > 0) {
          setTargets(list);
          const matchIdx = list.findIndex(
            (t) =>
              t.id === selectedBody?.id ||
              t.name.toLowerCase().includes(selectedBody?.name?.toLowerCase() || '')
          );
          if (matchIdx !== -1) {
            setSelectedTargetIndex(matchIdx);
          } else {
            setSelectedTargetIndex(0);
          }
        }
      })
      .catch((err) => {
        console.warn('Proxy fetch /api/spherex/targets failed, using static fallback:', err);
        // Guaranteed offline fallback
        fetch('/data/targets.json')
          .then((r) => r.json())
          .then((data) => {
            if (isMounted && data?.targets) {
              setTargets(data.targets);
              setDataSource('fallback');
              const matchIdx = data.targets.findIndex(
                (t) =>
                  t.id === selectedBody?.id ||
                  t.name.toLowerCase().includes(selectedBody?.name?.toLowerCase() || '')
              );
              if (matchIdx !== -1) setSelectedTargetIndex(matchIdx);
            }
          })
          .catch(() => {});
      });

    return () => {
      isMounted = false;
    };
  }, [selectedBody?.id]);

  const currentTarget = targets[selectedTargetIndex] || targets[0] || {};
  const baseObservations = currentTarget?.observations || [];
  const extraPasses =
    (livePasses && currentTarget?.id && livePasses[currentTarget.id]) || [];

  // Merge base observations and any live-appended passes without duplicates
  const allPasses = useMemo(() => {
    const list = [...baseObservations];
    extraPasses.forEach((extra) => {
      if (!list.some((existing) => existing.id === extra.id || (extra.source_url && existing.source_url === extra.source_url))) {
        list.push(extra);
      }
    });
    return list;
  }, [baseObservations, extraPasses]);

  // Synchronize loaded passes back to parent/watcher so watcher knows exact loaded state
  useEffect(() => {
    if (currentTarget?.id && allPasses.length > 0) {
      onActivePassesChange?.(currentTarget.id, allPasses);
    }
  }, [currentTarget?.id, allPasses, onActivePassesChange]);

  // Track quiet pass arrival notification with proper timer cleanup
  const seenPassesRef = useRef(new Set());
  useEffect(() => {
    let timer = null;
    if (extraPasses && extraPasses.length > 0) {
      for (const p of extraPasses) {
        if (!seenPassesRef.current.has(p.id)) {
          seenPassesRef.current.add(p.id);
          setQuietNotice(`New pass detected: ${p.id.slice(0, 24)}...`);
          timer = setTimeout(() => setQuietNotice(null), 4500);
          break;
        }
      }
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [extraPasses]);

  const obsA = allPasses[0];
  const obsB = allPasses[1] || allPasses[0];
  const currentObs = allPasses[activeEpoch] || allPasses[0];

  const resolveImg = (obs, fallback) => {
    if (!obs) return fallback;
    if (obs.image?.startsWith('/')) return obs.image;
    if (obs.image) return `/data/${obs.image.replace(/^public\/data\//, '')}`;
    return fallback;
  };

  const img1 = currentTarget.epoch1_img || resolveImg(obsA, DEFAULT_EPOCH_1);
  const img2 = currentTarget.epoch2_img || resolveImg(obsB, DEFAULT_EPOCH_2);
  const activeImg = resolveImg(currentObs, img1);

  // 2. Fetch live MEF Inspection telemetry from /api/spherex/mef-inspect (debounced)
  useEffect(() => {
    if (!isOpen) return;
    const mefUrl =
      obsA?.source_url ||
      'https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W29_2A/l2b-v20-2025-262/3/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits';

    const px = hoverPixel?.x ?? 58;
    const py = hoverPixel?.y ?? 58;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/spherex/mef-inspect?mef_url=${encodeURIComponent(mefUrl)}&px=${px}&py=${py}`, {
        signal: controller.signal
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            setMefTelemetry(data);
          }
        })
        .catch(() => {});
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [isOpen, selectedTargetIndex, hoverPixel?.x, hoverPixel?.y, obsA?.source_url]);

  // 3. Auto-Blinking Cycle (Flips cutout view without interfering with 3D timeline playback)
  useEffect(() => {
    if (!isOpen || compareMode !== 'blink' || !isAutoBlinking) return;
    const count = Math.max(2, allPasses.length);
    const timer = setInterval(() => {
      setActiveEpoch((prev) => (prev + 1) % count);
    }, blinkIntervalMs);

    return () => clearInterval(timer);
  }, [isOpen, compareMode, isAutoBlinking, blinkIntervalMs, allPasses.length]);

  // 4. Mathematical Difference Engine |I_2 - I_1|
  useEffect(() => {
    if (!isOpen || compareMode !== 'diff') return;

    const imgA = new Image();
    const imgB = new Image();
    let loaded = 0;

    const onLoaded = () => {
      loaded++;
      if (loaded === 2) {
        renderPixelDifference(imgA, imgB);
      }
    };

    imgA.crossOrigin = 'anonymous';
    imgB.crossOrigin = 'anonymous';
    imgA.onload = onLoaded;
    imgB.onload = onLoaded;
    imgA.src = img1;
    imgB.src = img2;
  }, [isOpen, compareMode, img1, img2, diffMultiplier, diffColorMap]);

  const renderPixelDifference = (imgA, imgB) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const w = imgA.naturalWidth || 116;
    const h = imgA.naturalHeight || 116;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const c1 = document.createElement('canvas');
    c1.width = w;
    c1.height = h;
    const ctx1 = c1.getContext('2d');
    ctx1.drawImage(imgA, 0, 0);
    const d1 = ctx1.getImageData(0, 0, w, h).data;

    const c2 = document.createElement('canvas');
    c2.width = w;
    c2.height = h;
    const ctx2 = c2.getContext('2d');
    ctx2.drawImage(imgB, 0, 0);
    const d2 = ctx2.getImageData(0, 0, w, h).data;

    const out = ctx.createImageData(w, h);
    const outD = out.data;

    for (let i = 0; i < d1.length; i += 4) {
      const v1 = d1[i];
      const v2 = d2[i];
      const diff = Math.abs(v2 - v1) * diffMultiplier;
      const clamped = Math.min(255, Math.max(0, diff));

      if (diffColorMap === 'grayscale') {
        outD[i] = clamped;
        outD[i + 1] = clamped;
        outD[i + 2] = clamped;
      } else if (diffColorMap === 'thermal') {
        // Infrared false-color thermal map
        outD[i] = Math.min(255, clamped * 2.2);
        outD[i + 1] = Math.max(0, clamped * 1.8 - 200);
        outD[i + 2] = Math.max(0, clamped * 2.8 - 450);
      } else if (diffColorMap === 'dipole') {
        // Cyan-magenta dipole for positive/negative parallax residuals
        const signed = (v2 - v1) * diffMultiplier;
        if (signed > 0) {
          outD[i] = Math.min(255, signed * 1.4);
          outD[i + 1] = 0;
          outD[i + 2] = Math.min(255, signed * 1.1);
        } else {
          outD[i] = 0;
          outD[i + 1] = Math.min(255, -signed * 1.1);
          outD[i + 2] = Math.min(255, -signed * 1.4);
        }
      }
      outD[i + 3] = 255;
    }

    ctx.putImageData(out, 0, 0);
  };

  const handleMouseMove = (e) => {
    const el = cutoutContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const xRel = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const yRel = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const gridW = currentTarget?.grid_px ? currentTarget.grid_px[0] : 116;
    const gridH = currentTarget?.grid_px ? currentTarget.grid_px[1] : 116;

    const px = Math.floor(xRel * gridW);
    const py = Math.floor(yRel * gridH);

    setHoverPixel({ x: px, y: py });
  };

  if (!isOpen) return null;

  // Derive calculated 102-band wavelength (0.75 - 5.00 um)
  const wavelength102Um = +(0.75 + ((bandIndex102 - 1) / 101) * 4.25).toFixed(3);
  const resolvingPower = 40 + Math.round((bandIndex102 / 102) * 90);

  return (
    <div className="blink-drawer">
      {/* Header */}
      <div className="drawer-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="category-tag">SPHEREx All-Sky Survey</span>
            <span
              className={`badge-source ${dataSource === 'live' ? 'live' : 'cached'}`}
              title={
                dataSource === 'live'
                  ? 'Connected live to FastAPI + NASA IRSA microservice proxy'
                  : 'Operating from committed Level-2 MEF FITS offline fallback snapshot'
              }
            >
              {dataSource === 'live' ? '● LIVE NASA PROXY' : '○ VERIFIED MEF CACHE'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 800, color: '#fff', margin: 0 }}>
              Multi-Epoch SPHEREx Blink Comparator
            </h3>
            {targets.length > 0 && (
              <select
                value={selectedTargetIndex}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setSelectedTargetIndex(idx);
                  const chosen = targets[idx];
                  if (chosen?.id && onSelectBody && chosen.id !== 'm31') {
                    onSelectBody(chosen.id);
                  }
                }}
                className="search-input"
                style={{
                  fontSize: '11px',
                  padding: '2px 8px',
                  width: 'auto',
                  background: 'rgba(15, 23, 42, 0.85)',
                  color: '#38bdf8',
                  borderRadius: '6px',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  cursor: 'pointer'
                }}
              >
                {targets.map((t, idx) => (
                  <option key={t.id || idx} value={idx}>
                    {t.name || t.id} {t.id === selectedBody?.id ? '★ (Current 3D Target)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
        <button className="btn" onClick={onClose} aria-label="Close Blink Inspector">
          ✕
        </button>
      </div>

      <div className="drawer-body">
        {/* Challenge Educational Callout */}
        <div
          className="spherex-callout"
          style={{
            background: 'rgba(14, 165, 233, 0.14)',
            borderColor: 'rgba(56, 189, 248, 0.35)'
          }}
        >
          <strong>💡 SPHEREx Multi-Epoch Sky Discovery:</strong> Comparing observations 6 months apart
          verifies real celestial spectral variations across time, cancelling instrumental background light for{' '}
          <strong style={{ color: '#38bdf8' }}>{currentTarget?.name || selectedBody?.name || 'M31 Discovered Field'}</strong>!
          {selectedBody?.name && currentTarget?.name && !currentTarget.name.toLowerCase().includes(selectedBody.name.toLowerCase()) && (
            <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', marginTop: '3px' }}>
              (Current Celestial Focus: {selectedBody.name})
            </span>
          )}
        </div>

        {/* View Mode & Reticle Toggles */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '8px'
          }}
        >
          <div className="toggle-group">
            {[
              { id: 'blink', label: '⚡ Auto-Blink' },
              { id: 'split', label: '↔ Split Wipe' },
              { id: 'diff', label: '🔍 |I₂ - I₁| Difference' }
            ].map((m) => (
              <button
                key={m.id}
                onClick={() => setCompareMode(m.id)}
                className={`toggle-pill ${compareMode === m.id ? 'active' : ''}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label
            style={{
              fontSize: '11px',
              color: '#cbd5e1',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={showTransientMarker}
              onChange={(e) => setShowTransientMarker(e.target.checked)}
            />
            Show Parallax Reticle
          </label>
        </div>

        {/* Survey Observation Passes List */}
        {allPasses.length > 0 && (
          <div className="pass-list-strip">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '10.5px', fontWeight: 700, color: '#94a3b8', letterSpacing: '0.04em' }}>
                OBSERVATION PASSES ({allPasses.length})
              </span>
              {quietNotice && (
                <span className="quiet-pass-badge pass-fade-in">
                  <span className="pulse-dot" /> {quietNotice}
                </span>
              )}
            </div>
            <div className="pass-chips-row">
              {allPasses.map((pass, pIdx) => {
                const isActive = pIdx === activeEpoch;
                return (
                  <button
                    key={pass.id || pIdx}
                    onClick={() => {
                      setIsAutoBlinking(false);
                      setActiveEpoch(pIdx);
                      if (onSyncEpochDate && pass.date_utc) {
                        onSyncEpochDate(new Date(pass.date_utc));
                      }
                    }}
                    className={`pass-chip ${isActive ? 'active' : ''} ${pass.isLiveAppended ? 'pass-fade-in' : ''}`}
                    title={`Select Pass ${pIdx + 1}: ${pass.id}`}
                  >
                    <span
                      className="pass-dot"
                      style={{ backgroundColor: isActive ? '#38bdf8' : '#64748b' }}
                    />
                    <span>
                      Pass {pIdx + 1}:{' '}
                      {pass.date_utc ? pass.date_utc.slice(0, 10) : `Epoch ${pIdx + 1}`}
                    </span>
                    {pass.band && <span className="pass-band-tag">{pass.band}</span>}
                    {pass.isLiveAppended && <span className="pass-live-badge">NEW</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Cutout Frame */}
        <div
          ref={cutoutContainerRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverPixel(null)}
          className="cutout-frame"
          style={{ minHeight: '280px', height: '300px', flexShrink: 0 }}
        >
          {compareMode === 'blink' && (
            <img
              src={activeImg}
              alt={`SPHEREx Survey Cutout (Pass ${activeEpoch + 1})`}
              className={`cutout-img ${currentObs?.isLiveAppended ? 'pass-fade-in' : ''}`}
              style={{ filter: `drop-shadow(0 0 10px ${selectedBand.color}44)` }}
            />
          )}

          {compareMode === 'split' && (
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <img
                src={img2}
                alt="Epoch 2"
                className="cutout-img"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  clipPath: `inset(0 ${100 - splitPercent}% 0 0)`,
                  WebkitClipPath: `inset(0 ${100 - splitPercent}% 0 0)`,
                  overflow: 'hidden'
                }}
              >
                <img
                  src={img1}
                  alt="Epoch 1"
                  className="cutout-img"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain'
                  }}
                />
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${splitPercent}%`,
                  width: '2px',
                  background: '#38bdf8',
                  boxShadow: '0 0 10px #38bdf8',
                  pointerEvents: 'none'
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '22px',
                    height: '22px',
                    borderRadius: '50%',
                    background: 'rgba(14, 165, 233, 0.95)',
                    border: '2px solid #ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 800,
                    boxShadow: '0 0 10px rgba(56, 189, 248, 0.8)'
                  }}
                >
                  ↔
                </div>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={splitPercent}
                onChange={(e) => setSplitPercent(Number(e.target.value))}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'ew-resize',
                  zIndex: 10
                }}
              />
            </div>
          )}

          {compareMode === 'diff' && (
            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <canvas
                ref={canvasRef}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  imageRendering: 'pixelated'
                }}
              />
            </div>
          )}

          {/* Parallax Shift Reticles */}
          {showTransientMarker &&
            (currentTarget?.dipole ? (
              <>
                <div
                  className="reticle"
                  style={{
                    left: `${((currentTarget.dipole.p1[0] / 116) * 100).toFixed(1)}%`,
                    top: `${((currentTarget.dipole.p1[1] / 116) * 100).toFixed(1)}%`,
                    opacity: compareMode === 'blink' && activeEpoch === 1 ? 0.25 : 1
                  }}
                >
                  <span className="reticle-tag">2025-W29 (Epoch 1)</span>
                </div>
                <div
                  className="reticle epoch2"
                  style={{
                    left: `${((currentTarget.dipole.p2[0] / 116) * 100).toFixed(1)}%`,
                    top: `${((currentTarget.dipole.p2[1] / 116) * 100).toFixed(1)}%`,
                    opacity: compareMode === 'blink' && activeEpoch === 0 ? 0.25 : 1
                  }}
                >
                  <span className="reticle-tag">2026-W32 (Shifted Dipole!)</span>
                </div>
              </>
            ) : (
              <div
                className="reticle"
                style={{
                  left: '50%',
                  top: '50%',
                  borderColor: '#34d399'
                }}
              >
                <span className="reticle-tag" style={{ color: '#34d399' }}>
                  Calibration Anchor (Fixed Δθ = 0″)
                </span>
              </div>
            ))}

          {/* Mouse Hover Coordinates Overlay */}
          {hoverPixel && (
            <div className="cutout-hover-badge">
              px: ({hoverPixel.x}, {hoverPixel.y})
              {mefTelemetry?.sky_icrs && (
                <span>
                  {' '}
                  • RA {mefTelemetry.sky_icrs.ra_deg}° Dec {mefTelemetry.sky_icrs.dec_deg}°
                </span>
              )}
            </div>
          )}
        </div>

        {/* Controls Bar */}
        {compareMode === 'blink' && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-primary"
                onClick={() => setIsAutoBlinking(!isAutoBlinking)}
              >
                {isAutoBlinking ? '⏸ Pause Blink' : '▶ Auto-Blink'}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setIsAutoBlinking(false);
                  const next = (activeEpoch + 1) % Math.max(1, allPasses.length);
                  setActiveEpoch(next);
                  const nextPass = allPasses[next];
                  if (onSyncEpochDate && nextPass?.date_utc) {
                    onSyncEpochDate(new Date(nextPass.date_utc));
                  }
                }}
              >
                Step Epoch ({allPasses[activeEpoch]?.date_utc ? allPasses[activeEpoch].date_utc.slice(0, 10) : `Pass ${activeEpoch + 1}`})
              </button>
            </div>

            <div
              style={{
                fontSize: '11px',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>Speed:</span>
              <input
                type="range"
                min="200"
                max="1400"
                step="50"
                value={blinkIntervalMs}
                onChange={(e) => setBlinkIntervalMs(Number(e.target.value))}
              />
            </div>
          </div>
        )}

        {compareMode === 'split' && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                className={`chip ${splitPercent === 0 ? 'active' : ''}`}
                onClick={() => setSplitPercent(0)}
              >
                Epoch 2 (100%)
              </button>
              <button
                className={`chip ${splitPercent === 50 ? 'active' : ''}`}
                onClick={() => setSplitPercent(50)}
              >
                50 / 50 Wipe
              </button>
              <button
                className={`chip ${splitPercent === 100 ? 'active' : ''}`}
                onClick={() => setSplitPercent(100)}
              >
                Epoch 1 (100%)
              </button>
            </div>

            <div
              style={{
                fontSize: '11px',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span>Split Wipe:</span>
              <span style={{ fontFamily: 'monospace', color: '#38bdf8', fontWeight: 700 }}>
                {splitPercent}%
              </span>
            </div>
          </div>
        )}

        {compareMode === 'diff' && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', gap: '5px' }}>
              {['thermal', 'grayscale', 'dipole'].map((cm) => (
                <button
                  key={cm}
                  onClick={() => setDiffColorMap(cm)}
                  className={`chip ${diffColorMap === cm ? 'active' : ''}`}
                  style={{ textTransform: 'capitalize' }}
                >
                  {cm}
                </button>
              ))}
            </div>

            <div
              style={{
                fontSize: '11px',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>Contrast:</span>
              <input
                type="range"
                min="1.0"
                max="6.0"
                step="0.2"
                value={diffMultiplier}
                onChange={(e) => setDiffMultiplier(Number(e.target.value))}
              />
              <span style={{ fontFamily: 'monospace' }}>{diffMultiplier.toFixed(1)}x</span>
            </div>
          </div>
        )}

        {/* Real MEF Photometric & Spectral Inspection Telemetry */}
        <div className="telemetry-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="metric-box">
            <div className="metric-label">Earth Baseline Dist</div>
            <div className="metric-val">{parallaxInfo?.earthDistAU || '1.00'} AU</div>
          </div>
          <div className="metric-box">
            <div className="metric-label">6-Mo Parallax Shift</div>
            <div className="metric-val" style={{ color: '#38bdf8' }}>
              {parallaxInfo?.parallaxArcmin || '0.00'}&apos;
            </div>
          </div>
          <div className="metric-box">
            <div className="metric-label">SPHEREx Pixel Shift</div>
            <div className="metric-val" style={{ color: '#fbbf24' }}>
              {parallaxInfo?.spherexPixelsShifted || '0'} px
            </div>
          </div>
        </div>

        {/* Level-2 MEF Real FITS Subtraction Telemetry */}
        {mefTelemetry && (
          <div className="mef-data-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: '#38bdf8' }}>
                📡 REAL LEVEL-2 MEF FITS WCS &amp; ZODI SUBTRACTION
              </span>
              <span style={{ fontSize: '9.5px', fontFamily: 'monospace', color: '#94a3b8' }}>
                WCS-WAVE λ=
                {typeof mefTelemetry.spectral_lvf?.wavelength_um === 'number'
                  ? mefTelemetry.spectral_lvf.wavelength_um.toFixed(4)
                  : mefTelemetry.spectral_lvf?.wavelength_um || '2.2345'}{' '}
                µm
              </span>
            </div>
            <div className="mef-grid">
              <div>
                <span className="mef-sublabel">Raw Flux (IMAGE):</span>{' '}
                <strong>
                  {typeof mefTelemetry.photometry_mjy_sr?.raw_image === 'number'
                    ? mefTelemetry.photometry_mjy_sr.raw_image.toFixed(2)
                    : mefTelemetry.photometry_mjy_sr?.raw_image || '0.00'}{' '}
                  MJy/sr
                </strong>
              </div>
              <div>
                <span className="mef-sublabel">Zodiacal Light (ZODI):</span>{' '}
                <span style={{ color: '#f87171' }}>
                  -{typeof mefTelemetry.photometry_mjy_sr?.zodi_model === 'number'
                    ? Math.abs(mefTelemetry.photometry_mjy_sr.zodi_model).toFixed(2)
                    : Math.abs(parseFloat(mefTelemetry.photometry_mjy_sr?.zodi_model) || 0).toFixed(2)}{' '}
                  MJy/sr
                </span>
              </div>
              <div>
                <span className="mef-sublabel">Clean Source Flux:</span>{' '}
                <strong style={{ color: '#34d399' }}>
                  {typeof mefTelemetry.photometry_mjy_sr?.zodi_subtracted === 'number'
                    ? mefTelemetry.photometry_mjy_sr.zodi_subtracted.toFixed(2)
                    : mefTelemetry.photometry_mjy_sr?.zodi_subtracted || '0.00'}{' '}
                  MJy/sr
                </strong>
              </div>
              <div>
                <span className="mef-sublabel">Bandwidth (Δλ):</span>{' '}
                <span>
                  {typeof mefTelemetry.spectral_lvf?.bandwidth_um === 'number'
                    ? mefTelemetry.spectral_lvf.bandwidth_um.toFixed(4)
                    : mefTelemetry.spectral_lvf?.bandwidth_um || '0.0557'}{' '}
                  µm
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 102-Band Linear Variable Filter (LVF) Tuner */}
        <div className="metric-box">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
              flexWrap: 'wrap',
              gap: '6px'
            }}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: '#e2e8f0' }}>
              🌈 102-Band LVF Continuous Tuner: Band #{bandIndex102} ({wavelength102Um} µm)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {mefTelemetry?.spectral_lvf && (
                <button
                  className="btn btn-tour"
                  style={{ fontSize: '9.5px', padding: '2px 7px' }}
                  onClick={() => {
                    const mefWave = mefTelemetry.spectral_lvf.wavelength_um;
                    const mappedBand = Math.max(
                      1,
                      Math.min(102, Math.round(1 + ((mefWave - 0.75) / 4.25) * 101))
                    );
                    setBandIndex102(mappedBand);
                    const matchingArrayIdx = Math.max(
                      0,
                      Math.min(5, Math.floor(((mappedBand - 1) / 102) * 6))
                    );
                    setSelectedBand(SPHEREX_BANDS[matchingArrayIdx]);
                  }}
                  title="Lock 102-band LVF tuner directly to the live MEF FITS WCS-WAVE wavelength"
                >
                  ⚡ Sync to MEF WCS-WAVE (
                  {typeof mefTelemetry.spectral_lvf.wavelength_um === 'number'
                    ? mefTelemetry.spectral_lvf.wavelength_um.toFixed(4)
                    : mefTelemetry.spectral_lvf.wavelength_um}{' '}
                  µm)
                </button>
              )}
              <span style={{ fontSize: '10px', color: '#94a3b8', fontFamily: 'monospace' }}>
                R ≈ {mefTelemetry?.spectral_lvf?.r_resolving_power || resolvingPower}
              </span>
            </div>
          </div>

          {/* Real MEF Calibrated WCS-WAVE Wavelength & Bandwidth Feed */}
          {mefTelemetry?.spectral_lvf && (
            <div
              style={{
                fontSize: '10.5px',
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '6px',
                padding: '5px 8px',
                marginBottom: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '6px'
              }}
            >
              <span>
                <strong style={{ color: '#38bdf8' }}>Real MEF WCS-WAVE:</strong> λ ={' '}
                {typeof mefTelemetry.spectral_lvf.wavelength_um === 'number'
                  ? mefTelemetry.spectral_lvf.wavelength_um.toFixed(4)
                  : mefTelemetry.spectral_lvf.wavelength_um}{' '}
                µm, Δλ ={' '}
                {typeof mefTelemetry.spectral_lvf.bandwidth_um === 'number'
                  ? mefTelemetry.spectral_lvf.bandwidth_um.toFixed(4)
                  : mefTelemetry.spectral_lvf.bandwidth_um}{' '}
                µm
              </span>
              <span style={{ color: '#94a3b8' }}>
                Detector: {mefTelemetry.band || selectedBand.array} (Filter Mode)
              </span>
            </div>
          )}

          <input
            type="range"
            min="1"
            max="102"
            step="1"
            value={bandIndex102}
            onChange={(e) => {
              const val = Number(e.target.value);
              setBandIndex102(val);
              const wave = 0.75 + ((val - 1) / 101) * 4.25;
              let match = SPHEREX_BANDS[0];
              if (wave >= 4.42) match = SPHEREX_BANDS[5];
              else if (wave >= 3.82) match = SPHEREX_BANDS[4];
              else if (wave >= 2.42) match = SPHEREX_BANDS[3];
              else if (wave >= 1.64) match = SPHEREX_BANDS[2];
              else if (wave >= 1.11) match = SPHEREX_BANDS[1];
              setSelectedBand(match);
            }}
            style={{ width: '100%', marginBottom: '10px', cursor: 'pointer' }}
          />

          {/* 6 SPHEREx Detector Array Presets */}
          <div className="band-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {SPHEREX_BANDS.map((band, idx) => (
              <button
                key={band.id}
                onClick={() => {
                  setSelectedBand(band);
                  setBandIndex102(Math.round(1 + (idx / 5) * 101));
                }}
                className={`band-btn ${selectedBand.id === band.id ? 'active' : ''}`}
              >
                <div
                  style={{
                    height: '3px',
                    background: band.color,
                    borderRadius: '2px',
                    marginBottom: '4px'
                  }}
                />
                Array {idx + 1}
              </button>
            ))}
          </div>

          <div style={{ marginTop: '8px', fontSize: '11px', color: '#cbd5e1', lineHeight: 1.45 }}>
            <strong style={{ color: selectedBand.color }}>{selectedBand.name}:</strong>{' '}
            {selectedBand.desc}
            <div style={{ display: 'flex', gap: '5px', marginTop: '6px', flexWrap: 'wrap' }}>
              {selectedBand.features?.map((f) => (
                <span key={f} className="feature-pill">
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
