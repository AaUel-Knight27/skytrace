'use client';

import React, { useState } from 'react';

export default function PlanetXAstrometry({ pixscaleArcsec = 3.1 }) {
  const [pixelShift, setPixelShift] = useState(2.0); // User-adjustable hypothetical pixel displacement test

  const angularShiftArcsec = (pixelShift * pixscaleArcsec).toFixed(2);

  // Parallax calculation for a hypothetical object at distance d (AU)
  // Over a 2 AU baseline (Earth's orbit across 6 months):
  // theta (rad) = 2 AU / d (AU)
  // theta (arcsec) = (2 / d) * 206,264.806 arcsec/rad
  // d (AU) = (2 * 206,264.806) / theta (arcsec) = 412,529.6 / theta (arcsec)
  const angularShiftNum = Math.max(0.01, parseFloat(angularShiftArcsec) || 0.01);
  const hypotheticalParallaxAU = Math.round((2.0 * 206264.806) / angularShiftNum);

  return (
    <div className="astrometry-container">
      <div className="astrometry-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9' }}>
            Hypothetical Planet X Astrometric Displacement Analyzer
          </h3>
          <span className="brand-badge badge-simulated font-mono" style={{ fontSize: '9.5px' }}>
            HYPOTHETICAL ANALYSIS ONLY
          </span>
        </div>
        <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#94a3b8' }}>
          Native Pixel Scale: <strong style={{ color: '#38bdf8' }}>{pixscaleArcsec}&quot;/pixel</strong>
        </span>
      </div>

      {/* HARD RULE 5: EXPLICIT SCIENTIFIC INTEGRITY STATEMENT */}
      <div className="planetx-warning" style={{ margin: '12px 0' }}>
        <div style={{ fontWeight: 700, color: '#fbbf24', marginBottom: '4px' }}>
          ⚠️ Scientific Mandate &amp; Theoretical Framework
        </div>
        <p style={{ marginBottom: '6px' }}>
          <strong>Planet X is an unobserved theoretical hypothesis.</strong> No candidate has been detected or confirmed by SPHEREx. Existing fake synthetic data has been removed to present only real discovered sky.
        </p>
        <p style={{ opacity: 0.85 }}>
          In all-sky multi-epoch surveys, real discoveries are verified against IRSA Level-2 MEF FITS images, spatial WCS calibration, and zodiacal light subtraction.
        </p>
      </div>

      {/* Interactive Shift Simulator (Decorational Astrometric Tool) */}
      <div className="astrometry-panel">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Hypothetical Detector Pixel Shift (Δpx):</span>
            <span style={{ fontFamily: 'monospace', color: '#38bdf8', fontWeight: 700, fontSize: '15px' }}>
              {pixelShift.toFixed(1)} px
            </span>
          </div>

          <input
            type="range"
            min="0.2"
            max="15.0"
            step="0.2"
            value={pixelShift}
            onChange={(e) => setPixelShift(parseFloat(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontFamily: 'monospace' }}>
            <span>0.2 px (Sub-pixel)</span>
            <span>7.5 px</span>
            <span>15.0 px (Large)</span>
          </div>

          <div style={{ paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#94a3b8' }}>Apparent Angular Displacement:</span>
              <span style={{ color: '#7dd3fc', fontWeight: 700, fontFamily: 'monospace' }}>
                {angularShiftArcsec} arcseconds (&quot;)
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
              <span style={{ color: '#94a3b8' }}>Equivalent Heliocentric Parallax Distance:</span>
              <span style={{ color: '#fcd34d', fontWeight: 700, fontFamily: 'monospace' }}>
                ~{hypotheticalParallaxAU.toLocaleString()} AU (if pure parallax)
              </span>
            </div>
          </div>
        </div>

        {/* What a Shift Would and Would Not Imply (Hard Rule 5) */}
        <div style={{ marginTop: '14px', padding: '12px', background: 'rgba(15, 23, 42, 0.7)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h4 style={{ fontSize: '11.5px', fontWeight: 700, color: '#f1f5f9', marginBottom: '8px' }}>
            What an observed shift of {angularShiftArcsec}&quot; WOULD and WOULD NOT imply:
          </h4>
          <ul style={{ fontSize: '11px', color: '#cbd5e1', lineHeight: 1.6, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <li>
              <strong style={{ color: '#34d399' }}>Would imply:</strong> Apparent displacement between two epochs separated by ~180 days. For distant solar system bodies, this is primarily dominated by Earth&apos;s annual reflex parallax (&Delta;&theta; = 2 AU / d).
            </li>
            <li>
              <strong style={{ color: '#34d399' }}>Would imply:</strong> If the candidate is at 300–600 AU (the predicted distance of hypothetical Planet Nine / Planet X), the expected parallax shift between passes 6 months apart is approximately <strong>690&quot; to 1,380&quot; (11.5′ to 23′)</strong>, easily resolved across multiple SPHEREx detector pixels!
            </li>
            <li>
              <strong style={{ color: '#f87171' }}>Would NOT imply:</strong> Discovery of Planet X. An isolated 2-epoch residual shift cannot distinguish between a Kuiper Belt Object, a Main Belt asteroid, a high-proper-motion subdwarf star, or a cosmic ray hit.
            </li>
            <li>
              <strong style={{ color: '#f87171' }}>Would NOT imply:</strong> Bound orbit confirmation. Establishing bound Keplerian orbital elements requires at least 3 to 4 independent astrometric epochs with consistent motion vectors.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
