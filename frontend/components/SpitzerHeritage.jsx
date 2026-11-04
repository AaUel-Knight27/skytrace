'use client';

import React from 'react';

export default function SpitzerHeritage() {
  return (
    <div className="heritage-container">
      <div className="heritage-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9' }}>
              NASA Spitzer Space Telescope Heritage &amp; SPHEREx Synergy
            </h3>
            <span className="brand-badge badge-real font-mono" style={{ fontSize: '9.5px' }}>
              INFRARED GREAT OBSERVATORY
            </span>
          </div>
          <p style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '3px' }}>
            Architectural lineage from SIRTF / Spitzer to SPHEREx all-sky spectral blinking
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <a
            href="https://science.nasa.gov/mission/spitzer/"
            target="_blank"
            rel="noreferrer"
            className="btn"
            style={{ fontSize: '11px', fontFamily: 'monospace' }}
          >
            ↗ NASA Spitzer Overview
          </a>
          <a
            href="https://eyes.nasa.gov/apps/solar-system/#/sc_spitzer?rate=1200&time=2003-08-25T07:51:30.100+00:00"
            target="_blank"
            rel="noreferrer"
            className="btn btn-tour"
            style={{ fontSize: '11px', fontFamily: 'monospace' }}
          >
            ↗ NASA Eyes Spitzer Orbit
          </a>
        </div>
      </div>

      <div className="heritage-grid">
        {/* Pillar 1: The Cold */}
        <div className="heritage-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8', fontWeight: 700, fontSize: '12px', marginBottom: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#38bdf8' }} />
            <span>1. &ldquo;The Cold&rdquo; (Planetary &amp; Sub-Stellar)</span>
          </div>
          <p style={{ color: '#cbd5e1', fontSize: '11px', lineHeight: 1.55 }}>
            Spitzer pioneered infrared characterization of brown dwarfs, extrasolar planets, and outermost solar system bodies whose thermal blackbody emissions peak at infrared wavelengths. SPHEREx inherits this to map water ice and organics across icy planetesimals and search for outer solar system bodies.
          </p>
        </div>

        {/* Pillar 2: The Old */}
        <div className="heritage-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fbbf24', fontWeight: 700, fontSize: '12px', marginBottom: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#fbbf24' }} />
            <span>2. &ldquo;The Old&rdquo; (Cosmic Dawn &amp; EBL)</span>
          </div>
          <p style={{ color: '#cbd5e1', fontSize: '11px', lineHeight: 1.55 }}>
            Light from the earliest stars and galaxies has been redshifted by cosmological expansion into near-infrared bands. SPHEREx measures large-scale clustering and the Extragalactic Background Light (EBL) across 96 spectral bands, probing the epoch of reionization.
          </p>
        </div>

        {/* Pillar 3: The Dusty */}
        <div className="heritage-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399', fontWeight: 700, fontSize: '12px', marginBottom: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#34d399' }} />
            <span>3. &ldquo;The Dusty&rdquo; (Zodiacal &amp; Nebular)</span>
          </div>
          <p style={{ color: '#cbd5e1', fontSize: '11px', lineHeight: 1.55 }}>
            Infrared light pierces dense interstellar dust grains. Both Spitzer and SPHEREx require precise modeling and subtraction of interplanetary zodiacal dust emission (ZODI extension in Level-2 MEF FITS) to isolate pristine celestial point sources.
          </p>
        </div>
      </div>

      {/* Earth-trailing Orbit vs Sun-Synchronous LEO */}
      <div style={{ marginTop: '14px', padding: '12px', background: 'rgba(15, 23, 42, 0.75)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '12px', marginBottom: '4px' }}>
          Orbital Architecture Comparison:
        </div>
        <p style={{ fontSize: '11px', color: '#94a3b8', lineHeight: 1.6 }}>
          While <strong>Spitzer</strong> utilized an innovative Earth-trailing heliocentric solar orbit (as visualized in NASA Eyes) to drift far from Earth&apos;s heat radiation, <strong>SPHEREx</strong> operates in a Sun-synchronous low Earth orbit (terminator orbit at ~700 km altitude), using passive thermal radiators with multiple V-groove shields to maintain 6-month survey passes covering the entire celestial sphere.
        </p>
      </div>
    </div>
  );
}
