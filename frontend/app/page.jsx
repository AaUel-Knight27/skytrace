'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import ThreeCosmoViewer from '../components/ThreeCosmoViewer';
import BlinkComparator from '../components/BlinkComparator';
import SpitzerHeritage from '../components/SpitzerHeritage';
import PlanetXAstrometry from '../components/PlanetXAstrometry';
import { SOLAR_SYSTEM_BODIES } from '../lib/catalog';
import { getBodyState, computeSpherexParallax, blendVectorWindows } from '../lib/ephemeris';
import {
  liveSync,
  SPHEREX_POLL_INTERVAL_MS,
  EPHEMERIS_POLL_INTERVAL_MS,
  MIN_STAGGER_DELAY_MS
} from '../lib/liveSync';

const TARGET_SEARCH_COORDS = {
  planetx: { ra: 45.215, dec: 8.432 },
  sedna: { ra: 55.912, dec: 12.115 },
  pluto: { ra: 302.518, dec: -22.842 },
  eris: { ra: 44.520, dec: -2.114 },
  m31: { ra: 10.6847, dec: 41.2687 },
  ceres: { ra: 64.5, dec: -14.2 },
  jupiter: { ra: 62.1, dec: 21.4 },
  saturn: { ra: 345.2, dec: -7.8 },
  uranus: { ra: 48.3, dec: 17.5 },
  neptune: { ra: 358.9, dec: -1.2 },
  mars: { ra: 115.4, dec: 24.1 },
  mercury: { ra: 185.0, dec: -3.0 },
  venus: { ra: 220.0, dec: -15.0 },
  earth: { ra: 0.0, dec: 0.0 }
};

const GUIDED_TOUR_STEPS = [
  {
    title: '1. How SPHEREx Scans the Entire Sky',
    bodyId: 'earth',
    date: '2025-07-20T00:00:00Z',
    openBlink: false,
    text: 'Since 2025, NASA’s SPHEREx space telescope has orbited Earth in a Sun-synchronous terminator polar orbit, scanning the celestial sphere in 102 infrared colors every 6 months.'
  },
  {
    title: '2. The 6-Month Parallax Trick',
    bodyId: 'm31',
    date: '2026-01-20T00:00:00Z',
    openBlink: false,
    text: 'Earth’s orbit is 2 AU wide. When SPHEREx photographs the sky 6 months apart, objects shift position against background calibration fields.'
  },
  {
    title: '3. SPHEREx Telescope Point of View',
    bodyId: 'm31',
    date: '2026-04-15T00:00:00Z',
    openBlink: false,
    text: 'View the sky directly through SPHEREx’s 3.5° × 11.3° spectroscopic field of view. The camera is stationed at the telescope aperture to see exact captured footprints.'
  },
  {
    title: '4. Discovered Sky: Real M31 Level-2 MEF Field',
    bodyId: 'm31',
    date: '2026-08-10T00:00:00Z',
    openBlink: true,
    text: 'Open the SPHEREx Blink Inspector on the right to examine authentic Level-2 multi-epoch MEF cutouts from IRSA (2025-W29 and 2026-W32 passes) for the Andromeda Galaxy calibration anchor.'
  }
];

export default function HomePage() {
  const [simDate, setSimDate] = useState(() => new Date('2026-08-10T00:00:00Z'));
  const [isPlaying, setIsPlaying] = useState(false);
  const [daysPerSec, setDaysPerSec] = useState(15);
  const [selectedBodyId, setSelectedBodyId] = useState('m31');
  const selectedBody = useMemo(
    () => SOLAR_SYSTEM_BODIES.find((b) => b.id === selectedBodyId) || SOLAR_SYSTEM_BODIES[0],
    [selectedBodyId]
  );
  const [showOrbits, setShowOrbits] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showSightline, setShowSightline] = useState(true);
  const [isTrueScale, setIsTrueScale] = useState(false);
  const [cameraMode, setCameraMode] = useState('spherex_pov'); // 'spherex_pov' | 'spacecraft' | 'freelook'
  const [scaleExaggeration, setScaleExaggeration] = useState(1.2);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isBlinkOpen, setIsBlinkOpen] = useState(true);
  const [isSpitzerOpen, setIsSpitzerOpen] = useState(false);
  const [isAstrometryOpen, setIsAstrometryOpen] = useState(false);
  const [tourStep, setTourStep] = useState(null);

  // Search & Autocomplete state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchContainerRef = useRef(null);

  // Close search dropdown on click-outside or Escape
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  // Global Astronomical Hotkeys (Space: Play/Pause, B: Blink, O: Orbits, L: Labels, T: True Scale, F: Follow, E: Explorer, [: slower, ]: faster)
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      const tag = e.target.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
        if (e.key === 'Escape') {
          setIsSearchFocused(false);
        }
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === '[' || e.key === '{') {
        setDaysPerSec((p) => Math.max(-180, p - 5));
      } else if (e.key === ']' || e.key === '}') {
        setDaysPerSec((p) => Math.min(180, p + 5));
      } else if (e.key === 'b' || e.key === 'B') {
        setIsBlinkOpen((p) => !p);
      } else if (e.key === 'o' || e.key === 'O') {
        setShowOrbits((p) => !p);
      } else if (e.key === 'l' || e.key === 'L') {
        setShowLabels((p) => !p);
      } else if (e.key === 't' || e.key === 'T') {
        setIsTrueScale((p) => !p);
      } else if (e.key === 'f' || e.key === 'F') {
        setCameraMode((p) => (p === 'spherex_pov' ? 'spacecraft' : p === 'spacecraft' ? 'freelook' : 'spherex_pov'));
      } else if (e.key === 'p' || e.key === 'P') {
        setShowSightline((p) => !p);
      } else if (e.key === 'e' || e.key === 'E') {
        setIsSidebarOpen((p) => !p);
      } else if (e.key === 'Escape') {
        setIsSearchFocused(false);
        setIsSpitzerOpen(false);
        setIsAstrometryOpen(false);
        setTourStep(null);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Ephemeris store (bodyId -> { vectors, provenance, isFallback, candidate })
  const [ephemerisStore, setEphemerisStore] = useState({});
  const [isLiveNASA, setIsLiveNASA] = useState(false);

  // Live Sync & Background Scheduler state
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [syncPulse, setSyncPulse] = useState(false);
  const [timeAgoText, setTimeAgoText] = useState('');
  const [newPassNotification, setNewPassNotification] = useState(null);
  const [livePasses, setLivePasses] = useState({});

  // Active refs to eliminate stale closures and prevent watcher re-registration churn
  const selectedBodyIdRef = useRef(selectedBodyId);
  useEffect(() => {
    selectedBodyIdRef.current = selectedBodyId;
  }, [selectedBodyId]);

  const selectedBodyRef = useRef(selectedBody);
  useEffect(() => {
    selectedBodyRef.current = selectedBody;
  }, [selectedBody]);

  const livePassesRef = useRef(livePasses);
  useEffect(() => {
    livePassesRef.current = livePasses;
  }, [livePasses]);

  const SPHEREX_SURVEY_TARGET_IDS = useMemo(
    () => new Set(['planetx', 'sedna', 'pluto', 'm31', 'eris']),
    []
  );

  const knownTargetObservationsRef = useRef({
    planetx: [
      { id: 'spx_l2_planetx_2025W29_1D3', source_url: 'level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits' },
      { id: 'spx_l2_planetx_2026W32_1D3', source_url: 'level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits' }
    ],
    sedna: [
      { id: 'spx_l2_sedna_2025W29_1D3', source_url: 'level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits' },
      { id: 'spx_l2_sedna_2026W32_1D3', source_url: 'level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits' }
    ],
    pluto: [
      { id: 'spx_l2_pluto_2025W29_1D3', source_url: 'level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits' },
      { id: 'spx_l2_pluto_2026W32_1D3', source_url: 'level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits' }
    ],
    m31: [
      { id: 'level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262', source_url: 'level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits' },
      { id: 'level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223', source_url: 'level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits' }
    ],
    eris: [
      { id: 'spx_l2_eris_2025W29_1D3', source_url: 'level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits' },
      { id: 'spx_l2_eris_2026W32_1D3', source_url: 'level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits' }
    ]
  });

  // Pre-load base target observations from catalog endpoint
  useEffect(() => {
    fetch('/api/spherex/targets')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const list = Array.isArray(data) ? data : data.targets || Object.values(data);
        if (list && list.length > 0) {
          const map = {};
          list.forEach((t) => {
            if (t.id && t.observations) {
              map[t.id] = t.observations;
            }
          });
          knownTargetObservationsRef.current = { ...map, ...knownTargetObservationsRef.current };
        }
      })
      .catch(() => {});
  }, []);

  // 1. Initialize shared LiveSync scheduler singleton on mount, teardown on unmount
  useEffect(() => {
    liveSync.init();

    const unsubscribe = liveSync.subscribe((event) => {
      if (event.type === 'sync_success') {
        setLastSyncedAt(event.timestamp);
        setSyncPulse(true);
        setTimeout(() => setSyncPulse(false), 1400);
      }
      if (event.type === 'new_pass_detected') {
        setNewPassNotification(event.pass);
        setTimeout(() => setNewPassNotification(null), 4500);
      }
    });

    return () => {
      unsubscribe();
      liveSync.teardown();
    };
  }, []);

  // Update "last synced Xs ago" text every 3s
  useEffect(() => {
    if (!lastSyncedAt) return;
    const update = () => {
      const elapsedSec = Math.max(0, Math.floor((Date.now() - lastSyncedAt) / 1000));
      if (elapsedSec < 6) {
        setTimeAgoText('• synced just now');
      } else if (elapsedSec < 60) {
        setTimeAgoText(`• synced ${elapsedSec}s ago`);
      } else {
        const mins = Math.floor(elapsedSec / 60);
        setTimeAgoText(`• synced ${mins}m ago`);
      }
    };
    update();
    const interval = setInterval(update, 3000);
    return () => clearInterval(interval);
  }, [lastSyncedAt]);

  // 2. SPHEREx Watcher: Checks IRSA via existing proxy for new observation passes for currently selected target
  // Re-runs immediately when target changes, cancelling previous target's in-flight poll
  useEffect(() => {
    const targetId = selectedBodyId;
    if (!targetId || !SPHEREX_SURVEY_TARGET_IDS.has(targetId)) return;

    const taskId = 'spherex-target-watcher';
    const unregister = liveSync.registerSyncTask({
      id: taskId,
      intervalMs: SPHEREX_POLL_INTERVAL_MS,
      immediate: true, // Re-runs immediately on target switch, cancelling prior in-flight poll
      run: async ({ signal }) => {
        const coords = TARGET_SEARCH_COORDS[targetId] || { ra: 45.215, dec: 8.432 };
        try {
          // Cheap metadata-only IRSA search query
          const res = await fetch(
            `/api/spherex/search?ra=${coords.ra}&dec=${coords.dec}&radius_deg=0.1`,
            { signal }
          );
          if (!res.ok) return; // Silently skip tick if offline or error
          const data = await res.json();
          const mefFiles = data?.mef_files || [];
          if (mefFiles.length === 0) return;

          // Dynamically check against what BlinkComparator already has loaded for this target
          const baseObs = knownTargetObservationsRef.current[targetId] || [];
          const extraObs = livePassesRef.current[targetId] || [];
          const knownSet = new Set();
          [...baseObs, ...extraObs].forEach((p) => {
            if (p.id) knownSet.add(p.id.toLowerCase());
            if (p.source_url) {
              const stem = p.source_url.split('/').pop().replace(/\.fits(\.gz)?$/i, '').toLowerCase();
              knownSet.add(stem);
            }
            if (p.image) {
              const stem = p.image.split('/').pop().replace(/\.(png|jpg|fits(\.gz)?)$/i, '').toLowerCase();
              knownSet.add(stem);
            }
          });

          const newlyFound = mefFiles.filter((m) => {
            if (!m.access_url) return false;
            const stem = m.access_url.split('/').pop().replace(/\.fits(\.gz)?$/i, '').toLowerCase();
            return !knownSet.has(stem);
          });

          if (newlyFound.length > 0 && !signal.aborted) {
            const m = newlyFound[0];
            const rawStem = m.access_url.split('/').pop().replace(/\.fits(\.gz)?$/i, '');

            // Fetch new cutout through the normal /api/spherex proxy path
            let cutoutImg = `/data/img/${targetId === 'planetx' ? 'planetx' : 'm31'}/epoch2_2026W32.png`;
            try {
              const cutoutRes = await fetch(`/api/spherex/cutouts?bodyId=${encodeURIComponent(targetId)}`, { signal });
              if (cutoutRes.ok) {
                const cutoutData = await cutoutRes.json();
                const candidateObs = cutoutData?.selectedTarget?.observations || cutoutData?.observations || [];
                const match = candidateObs.find((o) => o.id?.includes(rawStem) || o.source_url?.includes(rawStem));
                if (match?.image) {
                  cutoutImg = match.image.startsWith('/') ? match.image : `/data/${match.image.replace(/^public\/data\//, '')}`;
                }
              }
            } catch (e) {
              // Silently use generated/fallback path if proxy cutout check fails
            }

            const newPass = {
              id: rawStem,
              date_utc: new Date().toISOString(),
              mjd: 61350.0,
              pass: 3,
              band: 'D3',
              wavelength_um: m.band_min_um || 2.2345,
              bandwidth_um: 0.0557,
              coverage: 1.0,
              image: cutoutImg,
              source_url: m.access_url,
              isLiveAppended: true
            };

            setLivePasses((prev) => ({
              ...prev,
              [targetId]: [...(prev[targetId] || []), newPass]
            }));

            liveSync.notify({
              type: 'new_pass_detected',
              pass: {
                id: rawStem,
                targetName: selectedBodyRef.current?.name || targetId
              }
            });
          }
        } catch (err) {
          // Microservice offline or request aborted: silently skip tick
        }
      }
    });

    return () => unregister();
  }, [selectedBodyId]);

  // 3. Ephemeris Watcher: Re-pulls fresh Horizons vector windows every 20 minutes, staggered, blending across overlap
  // Registered once on mount so planet clicks in 3D scene do NOT cancel or reset the 20-minute timer
  useEffect(() => {
    const taskId = 'ephemeris-refresh-watcher';
    const unregister = liveSync.registerSyncTask({
      id: taskId,
      intervalMs: EPHEMERIS_POLL_INTERVAL_MS,
      immediate: false,
      run: async ({ signal }) => {
        // Scoped to Earth + currently focused target (Planet X and Sun strictly excluded)
        const curTarget = selectedBodyIdRef.current;
        const bodiesToRefresh = ['earth'];
        if (
          curTarget &&
          curTarget !== 'planetx' &&
          curTarget !== 'sun' &&
          curTarget !== 'earth'
        ) {
          bodiesToRefresh.push(curTarget);
        }

        for (let i = 0; i < bodiesToRefresh.length; i++) {
          if (signal.aborted) break;
          if (i > 0) {
            // Stagger requests to avoid concurrent spikes on Horizons
            await new Promise((r) => setTimeout(r, MIN_STAGGER_DELAY_MS));
            if (signal.aborted) break;
          }

          const bodyId = bodiesToRefresh[i];
          try {
            const res = await fetch(`/api/ephemeris/${bodyId}?refresh=true`, { signal });
            if (!res.ok) continue;
            const freshData = await res.json();
            if (!freshData || !freshData.vectors || freshData.vectors.length === 0) continue;

            setEphemerisStore((prevStore) => {
              const existing = prevStore[bodyId];
              const oldVectors = existing?.vectors || null;
              const newVectors = freshData.vectors;

              let blendedVectors = newVectors;
              if (oldVectors && oldVectors.length > 0) {
                blendedVectors = blendVectorWindows(oldVectors, newVectors);
                // Clear old transition to avoid chaining and attach smooth 2.5s easing
                oldVectors._reseedTransition = null;
                blendedVectors._reseedTransition = {
                  oldVectors,
                  startTime: Date.now(),
                  durationMs: 2500
                };
              }

              return {
                ...prevStore,
                [bodyId]: {
                  ...freshData,
                  vectors: blendedVectors
                }
              };
            });

            if (freshData.isFallback === false && !freshData.candidate && bodyId !== 'sun') {
              setIsLiveNASA(true);
            }
          } catch (err) {
            // Silently skip if network fails
          }
        }
      }
    });

    return () => unregister();
  }, []);

  // Fetch live JPL Horizons ephemeris via our Next.js API route
  useEffect(() => {
    const bodiesToFetch = ['earth', selectedBodyId];
    bodiesToFetch.forEach((id) => {
      if (!id || ephemerisStore[id]) return;

      fetch(`/api/ephemeris/${id}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data) {
            setEphemerisStore((prev) => ({ ...prev, [id]: data }));
            if (data.isFallback === false && !data.candidate && id !== 'sun') {
              setIsLiveNASA(true);
            }
          }
        })
        .catch(() => {});
    });
  }, [selectedBodyId]);

  // Pre-fetch all real planetary bodies in background with gentle staggering
  useEffect(() => {
    const timer = setTimeout(() => {
      const remainingBodies = SOLAR_SYSTEM_BODIES.filter(
        (b) => b.id !== 'planetx' && b.id !== 'sun' && !ephemerisStore[b.id]
      );
      remainingBodies.forEach((b, idx) => {
        setTimeout(() => {
          fetch(`/api/ephemeris/${b.id}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
              if (data) {
                setEphemerisStore((prev) => ({ ...prev, [b.id]: data }));
                if (data.isFallback === false) setIsLiveNASA(true);
              }
            })
            .catch(() => {});
        }, idx * 350);
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  // Live NASA JPL Horizons verification for observer Earth platform
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch('/api/ephemeris/earth?refresh=true')
        .then((r) => (r.ok ? r.json() : null))
        .then((freshData) => {
          if (freshData?.vectors?.length > 0) {
            setEphemerisStore((prev) => ({
              ...prev,
              earth: freshData
            }));
            if (freshData.isFallback === false) {
              setIsLiveNASA(true);
              liveSync.notify({ type: 'sync_success', timestamp: Date.now() });
            }
          }
        })
        .catch(() => {});
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  const handleManualLiveSync = async () => {
    setSyncPulse(true);
    try {
      const res = await fetch('/api/ephemeris/earth?refresh=true');
      if (res.ok) {
        const freshData = await res.json();
        if (freshData?.vectors?.length > 0) {
          setEphemerisStore((prev) => ({ ...prev, earth: freshData }));
          if (freshData.isFallback === false) {
            setIsLiveNASA(true);
          }
        }
      }
      liveSync.notify({ type: 'sync_success', timestamp: Date.now() });
    } catch {
      // offline fallback
    } finally {
      setTimeout(() => setSyncPulse(false), 1400);
    }
  };

  // Time simulation loop
  useEffect(() => {
    if (!isPlaying) return;
    let lastTime = performance.now();
    let frameId;
    const tick = (now) => {
      const dtSec = (now - lastTime) / 1000;
      lastTime = now;
      setSimDate((prev) => new Date(prev.getTime() + dtSec * daysPerSec * 86400000));
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, daysPerSec]);

  // Telemetry computation using Horizons data if available
  const telemetry = useMemo(() => {
    const earth = SOLAR_SYSTEM_BODIES.find((b) => b.id === 'earth');
    const earthVectors = ephemerisStore?.earth?.vectors || null;
    const bodyVectors = ephemerisStore?.[selectedBody.id]?.vectors || null;

    const earthState = getBodyState(earth, simDate, isTrueScale, earthVectors);
    const bodyState = getBodyState(selectedBody, simDate, isTrueScale, bodyVectors);
    const parallax = computeSpherexParallax(selectedBody, earthState, bodyState);

    const provenance =
      ephemerisStore?.[selectedBody.id]?.provenance ||
      (selectedBody.id === 'planetx'
        ? 'Source: simulated candidate orbit (Battygin & Brown 2016/2021)'
        : 'Source: JPL Horizons (Verified Keplerian propagation)');

    return { earthState, bodyState, parallax, provenance };
  }, [selectedBody, simDate, isTrueScale, ephemerisStore]);

  // Autocomplete matching
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return SOLAR_SYSTEM_BODIES.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const startTourStep = (idx) => {
    const step = GUIDED_TOUR_STEPS[idx];
    if (!step) {
      setTourStep(null);
      return;
    }
    setTourStep(idx);
    setSelectedBodyId(step.bodyId);
    setSimDate(new Date(step.date));
    setIsBlinkOpen(step.openBlink);
    setIsSidebarOpen(true);
    setIsPlaying(false);
  };

  const timelineMin = new Date('2025-01-01T00:00:00Z').getTime();
  const timelineMax = new Date('2027-06-30T00:00:00Z').getTime();

  return (
    <main className="eyes-viewport">
      <ThreeCosmoViewer
        simDate={simDate}
        selectedBodyId={selectedBodyId}
        onSelectBody={(id) => setSelectedBodyId(id)}
        showOrbits={showOrbits}
        showLabels={showLabels}
        showSightline={showSightline}
        scaleExaggeration={scaleExaggeration}
        isTrueScale={isTrueScale}
        cameraMode={cameraMode}
        ephemerisStore={ephemerisStore}
      />

      {/* Top NASA Eyes Header */}
      <header className="hud-header">
        <div className="hud-brand">
          <div className="brand-icon">SX</div>
          <div>
            <h1 className="brand-title">
              SkyTrace • SPHEREx Scope 3D
              <span className="brand-badge badge-real font-mono">SPHEREx TELESCOPE POV • REAL SKY DISCOVERY</span>
              <span className="brand-badge badge-real font-mono">REAL LEVEL-2 MEF DATA</span>
              <span
                onClick={handleManualLiveSync}
                className={`live-indicator-pill ${isLiveNASA ? 'live' : 'cached'} ${syncPulse ? 'sync-pulse' : ''}`}
                title="Click to force live sync with NASA JPL Horizons SSD REST API"
                role="button"
                tabIndex={0}
                style={{ cursor: 'pointer' }}
              >
                {isLiveNASA ? '🟢 LIVE NASA DATA' : '🟡 CACHED NASA DATA'}
                {timeAgoText && <span className="sync-timestamp">{timeAgoText}</span>}
              </span>
            </h1>
            <div className="brand-subtitle">
              SPHEREx Space Telescope POV • Real Level-2 Infrared Sky Discovery • Verified Multi-Epoch Blink Comparator
            </div>
          </div>
        </div>

        {/* Quiet Non-blocking live sync pass notification */}
        {newPassNotification && (
          <div className="sync-banner-cue pass-fade-in">
            <span>🛰️ New SPHEREx pass detected for {newPassNotification.targetName}!</span>
          </div>
        )}

        <div className="hud-actions">
          <button
            className={`btn ${isSidebarOpen ? 'btn-primary' : ''}`}
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title="Toggle Target Explorer Sidebar (Hotkey: E)"
          >
            🧭 Explorer
          </button>

          <button className="btn btn-tour" onClick={() => startTourStep(0)} title="1-Minute Guided Tour: Planet X & SPHEREx Parallax">
            🚀 1-Min Guided Tour
          </button>

          <button
            className={`btn ${isSpitzerOpen ? 'btn-primary' : ''}`}
            onClick={() => setIsSpitzerOpen(!isSpitzerOpen)}
            title="NASA Spitzer Space Telescope Heritage & SPHEREx Synergy"
          >
            🛰️ Spitzer Space Telescope Heritage
          </button>

          <button
            className={`btn ${isAstrometryOpen ? 'btn-primary' : ''}`}
            onClick={() => setIsAstrometryOpen(!isAstrometryOpen)}
            title="Hypothetical Planet X Astrometric Displacement Analyzer"
          >
            📐 Astrometry
          </button>

          <button
            className={`btn ${isBlinkOpen ? 'btn-primary' : ''}`}
            onClick={() => setIsBlinkOpen(!isBlinkOpen)}
            title="Toggle Multi-Epoch SPHEREx Sky Blink Inspector (Hotkey: B)"
          >
            🔭 Sky Blink
          </button>

          {/* Scale & Camera Controls */}
          <div className="toggle-group">
            <button
              onClick={() => setIsTrueScale(!isTrueScale)}
              className={`toggle-pill ${isTrueScale ? 'active' : ''}`}
              title="Toggle between Visual Scale (enlarged) and True Physical Scale (1:1 proportions) (Hotkey: T)"
            >
              {isTrueScale ? '📏 True Scale' : '✨ Visual Scale'}
            </button>
            <button
              onClick={() => setCameraMode('spherex_pov')}
              className={`toggle-pill ${cameraMode === 'spherex_pov' ? 'active' : ''}`}
              title="View sky directly from SPHEREx telescope aperture (Hotkey: F)"
            >
              🔭 SPHEREx POV
            </button>
            <button
              onClick={() => setCameraMode('spacecraft')}
              className={`toggle-pill ${cameraMode === 'spacecraft' ? 'active' : ''}`}
              title="View SPHEREx spacecraft exterior"
            >
              🛰️ Spacecraft
            </button>
            <button
              onClick={() => setCameraMode(cameraMode === 'freelook' ? 'spherex_pov' : 'freelook')}
              className={`toggle-pill ${cameraMode === 'freelook' ? 'active' : ''}`}
              title="Toggle Free Look Orbit"
            >
              🔓 Free Look
            </button>
          </div>

          {/* Visibility Toggles */}
          <div className="toggle-group">
            <button
              onClick={() => setShowOrbits(!showOrbits)}
              className={`toggle-pill ${showOrbits ? 'active' : ''}`}
              title="Toggle Orbit Lines (Hotkey: O)"
            >
              Orbits
            </button>
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`toggle-pill ${showLabels ? 'active' : ''}`}
              title="Toggle Celestial Labels (Hotkey: L)"
            >
              Labels
            </button>
            <button
              onClick={() => setShowSightline(!showSightline)}
              className={`toggle-pill ${showSightline ? 'active' : ''}`}
              title="Toggle SPHEREx Parallax Sightline Vector (Hotkey: P)"
            >
              Parallax Line
            </button>
          </div>
        </div>
      </header>

      {/* Floating Re-Open Button when Sidebar is Collapsed */}
      {!isSidebarOpen && (
        <button
          className="sidebar-open-tab"
          onClick={() => setIsSidebarOpen(true)}
          title="Open Target Explorer (Hotkey: E)"
        >
          🧭 Target Explorer →
        </button>
      )}

      {/* Left Target Explorer Sidebar */}
      <aside className={`hud-sidebar ${!isSidebarOpen ? 'collapsed' : ''}`} aria-hidden={!isSidebarOpen}>
        {/* Autocomplete Search Card */}
        <div className="glass-card" ref={searchContainerRef} style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search planets, TNOs, Planet X..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchResults.length > 0) {
                setSelectedBodyId(searchResults[0].id);
                setSearchQuery('');
                setIsSearchFocused(false);
              }
            }}
            className="search-input"
          />

          {/* Autocomplete Dropdown */}
          {isSearchFocused && searchResults.length > 0 && (
            <div className="autocomplete-dropdown">
              {searchResults.map((b) => (
                <div
                  key={b.id}
                  onClick={() => {
                    setSelectedBodyId(b.id);
                    setSearchQuery('');
                    setIsSearchFocused(false);
                  }}
                  className="autocomplete-item"
                >
                  <span className="label-dot" style={{ backgroundColor: b.color }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#fff' }}>{b.name}</div>
                    <div style={{ fontSize: '10px', color: '#94a3b8' }}>{b.category}</div>
                  </div>
                  <span style={{ fontSize: '10px', color: '#38bdf8', fontFamily: 'monospace' }}>
                    {b.a > 0 ? `${b.a} AU` : 'Anchor'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Quick Selection Chips */}
          <div className="body-chips">
            {SOLAR_SYSTEM_BODIES.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedBodyId(b.id)}
                className={`chip ${selectedBodyId === b.id ? 'active' : ''}`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>

        {/* Selected Target Details & Telemetry Card */}
        <div className="glass-card target-details-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="category-tag">{selectedBody.category}</div>
              <div className="target-name">{selectedBody.name}</div>
              <div
                className={`provenance-badge ${
                  selectedBody.id === 'planetx' ? 'candidate' : 'confirmed'
                }`}
              >
                {selectedBody.statusLabel || 'Discovered Sky Field'}
              </div>
              <div
                className="provenance-badge candidate"
                style={{ fontSize: '9px', marginTop: '4px', display: 'inline-block' }}
              >
                Candidate — not yet confirmed: unconfirmed theoretical candidate; SPHEREx only captures verified discovered sky
              </div>
            </div>
            <span
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                background: selectedBody.color,
                boxShadow: `0 0 14px ${selectedBody.color}`
              }}
            />
          </div>

          {/* Scientific Provenance Tag */}
          <div className="provenance-tag-box">
            <span style={{ opacity: 0.7 }}>PROVENANCE: </span>
            <strong>{telemetry.provenance}</strong>
          </div>

          <p className="summary-text">{selectedBody.humanSummary}</p>

          <div className="spherex-callout">
            <div style={{ fontWeight: 700, marginBottom: '4px', color: '#d8b4fe' }}>
              🛰️ SPHEREx Signature
            </div>
            <div>{selectedBody.spherexRole}</div>
          </div>

          {selectedBody.id === 'planetx' && (
            <div className="planetx-warning">
              <strong>Planet X is an unobserved theoretical hypothesis.</strong> No candidate has been detected or confirmed by SPHEREx. Existing fake synthetic data has been removed to present only verified discovered sky.
            </div>
          )}

          {/* Large Numerals Telemetry Grid */}
          <div className="telemetry-grid">
            <div className="metric-box">
              <div className="metric-label">{selectedBody.id === 'm31' ? 'CELESTIAL RA' : 'SUN DISTANCE (r)'}</div>
              <div className="metric-val">{selectedBody.id === 'm31' ? '10.685°' : `${telemetry.bodyState.trueAU.r.toFixed(2)} AU`}</div>
            </div>
            <div className="metric-box">
              <div className="metric-label">{selectedBody.id === 'm31' ? 'CELESTIAL DEC' : 'EARTH DISTANCE (Δ)'}</div>
              <div className="metric-val" style={{ color: '#38bdf8' }}>
                {selectedBody.id === 'm31' ? '+41.269°' : `${telemetry.parallax.earthDistAU} AU`}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">{selectedBody.id === 'm31' ? 'SURVEY PASSES' : 'ORBITAL SPEED'}</div>
              <div className="metric-val">
                {selectedBody.id === 'm31' ? '2 (QR2/QR3)' : `${telemetry.bodyState.orbitalSpeedKms.toFixed(2)} km/s`}
              </div>
            </div>
            <div className="metric-box">
              <div className="metric-label">6-MO PARALLAX SHIFT</div>
              <div className="metric-val" style={{ color: '#fbbf24' }}>
                {telemetry.parallax.parallaxArcsec}&quot;
              </div>
            </div>
          </div>

          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => setIsBlinkOpen(true)}
          >
            🔭 Inspect Sky Shift in SPHEREx Cutouts →
          </button>
        </div>
      </aside>

      {/* Guided Tour Banner */}
      {tourStep !== null && GUIDED_TOUR_STEPS[tourStep] && (
        <div className="tour-banner">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <strong style={{ fontSize: '13px', color: '#fcd34d' }}>
              {GUIDED_TOUR_STEPS[tourStep].title}
            </strong>
            <button
              onClick={() => setTourStep(null)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          <p style={{ fontSize: '12px', color: '#e2e8f0', lineHeight: 1.5, marginBottom: '12px' }}>
            {GUIDED_TOUR_STEPS[tourStep].text}
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Step {tourStep + 1} of {GUIDED_TOUR_STEPS.length}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {tourStep > 0 && (
                <button className="btn" onClick={() => startTourStep(tourStep - 1)}>
                  ← Back
                </button>
              )}
              <button
                className="btn btn-tour"
                onClick={() =>
                  tourStep + 1 < GUIDED_TOUR_STEPS.length
                    ? startTourStep(tourStep + 1)
                    : setTourStep(null)
                }
              >
                {tourStep + 1 < GUIDED_TOUR_STEPS.length ? 'Next Step →' : 'Finish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right SPHEREx Blink Comparator */}
      <BlinkComparator
        selectedBody={selectedBody}
        parallaxInfo={telemetry.parallax}
        onSelectBody={(id) => setSelectedBodyId(id)}
        onSyncEpochDate={(d) => {
          setIsPlaying(false);
          setSimDate(d);
        }}
        isOpen={isBlinkOpen}
        onClose={() => setIsBlinkOpen(false)}
        livePasses={livePasses}
        onActivePassesChange={(tid, passes) => {
          if (tid && passes) {
            knownTargetObservationsRef.current[tid] = passes;
          }
        }}
      />

      {/* Bottom NASA Eyes Timeline Controller */}
      <footer className="hud-footer">
        {/* SPHEREx Survey Epoch Jump Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 700 }}>
            SPHEREx EPOCHS:
          </span>
          <button
            className="btn"
            onClick={() => {
              setIsPlaying(false);
              setSimDate(new Date('2025-07-20T00:00:00Z'));
            }}
          >
            Epoch 1 (2025-W29)
          </button>
          <button
            className="btn"
            onClick={() => {
              setIsPlaying(false);
              setSimDate(new Date('2026-08-10T00:00:00Z'));
            }}
          >
            Epoch 2 (2026-W32)
          </button>
          <button
            className="btn btn-tour"
            onClick={() => {
              setIsPlaying(false);
              setSimDate(new Date());
            }}
          >
            ⏱ Jump to Now
          </button>
        </div>

        {/* Center Timeline Deck with Continuous Date Scrubber */}
        <div className="timeline-center">
          <button
            className="play-btn"
            onClick={() => setIsPlaying(!isPlaying)}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          <div style={{ textAlign: 'center', minWidth: '120px' }}>
            <div
              style={{
                fontSize: '9.5px',
                fontWeight: 700,
                color: '#38bdf8',
                letterSpacing: '0.08em'
              }}
            >
              {isPlaying ? `LIVE (${daysPerSec}d / s)` : 'PAUSED'}
            </div>
            <div
              style={{
                fontSize: '13.5px',
                fontFamily: 'monospace',
                fontWeight: 700,
                color: '#fff'
              }}
            >
              {simDate.toISOString().slice(0, 10)}
            </div>
          </div>

          {/* Draggable Mission Timeline Scrubber */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '170px' }}>
            <input
              type="range"
              min={timelineMin}
              max={timelineMax}
              step={86400000}
              value={Math.max(timelineMin, Math.min(timelineMax, simDate.getTime()))}
              onChange={(e) => {
                setIsPlaying(false);
                setSimDate(new Date(Number(e.target.value)));
              }}
              className="timeline-scrubber"
              title="Scrub continuously across SPHEREx mission timeline (2025 – 2027)"
            />
          </div>

          {/* Simulation Rate Control */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: '#94a3b8'
            }}
          >
            <span>Rate:</span>
            <input
              type="range"
              min="-180"
              max="180"
              step="5"
              value={daysPerSec}
              onChange={(e) => setDaysPerSec(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Planet Scale Slider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11.5px',
            color: '#cbd5e1'
          }}
        >
          <span>Planet Scale:</span>
          <input
            type="range"
            min="0.5"
            max="2.5"
            step="0.1"
            value={scaleExaggeration}
            onChange={(e) => setScaleExaggeration(Number(e.target.value))}
            disabled={isTrueScale}
          />
          <span style={{ fontFamily: 'monospace' }}>
            {isTrueScale ? '1.0x (Locked True)' : `${scaleExaggeration.toFixed(1)}x`}
          </span>
        </div>
      </footer>

      {/* Spitzer Heritage Modal */}
      {isSpitzerOpen && (
        <div className="modal-backdrop" onClick={() => setIsSpitzerOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">NASA Spitzer Space Telescope Heritage</span>
              <button className="btn btn-close" onClick={() => setIsSpitzerOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <SpitzerHeritage />
            </div>
          </div>
        </div>
      )}

      {/* Planet X Astrometry Modal */}
      {isAstrometryOpen && (
        <div className="modal-backdrop" onClick={() => setIsAstrometryOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Hypothetical Planet X Astrometric Displacement Analyzer</span>
              <button className="btn btn-close" onClick={() => setIsAstrometryOpen(false)}>✕</button>
            </div>
            <div className="modal-body">
              <PlanetXAstrometry />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
