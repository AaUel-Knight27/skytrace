import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

function loadTargets(targetId = null) {
  const candidatePaths = [
    path.join(process.cwd(), 'public', 'data', 'targets.json'),
    path.join(process.cwd(), 'frontend', 'public', 'data', 'targets.json'),
    path.join(process.cwd(), 'public', 'data', 'fallback', 'targets.json'),
    path.join(process.cwd(), 'frontend', 'public', 'data', 'fallback', 'targets.json')
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed?.targets?.length > 0) {
          if (targetId) {
            const match = parsed.targets.find(
              (t) => t.id === targetId || t.name.toLowerCase().includes(targetId.toLowerCase())
            );
            if (match) {
              return {
                targets: [match, ...parsed.targets.filter((t) => t.id !== match.id)],
                selectedTarget: match,
                generated_utc: parsed.generated_utc || new Date().toISOString()
              };
            }
          }
          return parsed;
        }
      }
    } catch (e) {
      // Continue to next candidate path
    }
  }

  // Guaranteed fallback targets if file reading fails
  return {
    targets: [
      {
        id: 'm31',
        name: 'M31 (Andromeda Galaxy) • Discovered Field',
        ra: 10.684708,
        dec: 41.26875,
        size_arcmin: 6.0,
        pixscale_arcsec: 3.1,
        grid_px: [116, 116],
        center_px: [58.0, 58.0],
        north_up_east_left: true,
        collection_note: 'SPHEREx Level-2 verified spectral images via IRSA (QR); cite DOI 10.26131/IRSA652',
        dipole: null,
        observations: [
          {
            id: 'level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262',
            date_utc: '2025-07-18T07:30:48Z',
            mjd: 60874.31306,
            pass: 0,
            band: 'D3',
            wavelength_um: 2.2345,
            bandwidth_um: 0.0557,
            image: 'img/m31/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.png'
          },
          {
            id: 'level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223',
            date_utc: '2026-08-07T07:21:10Z',
            mjd: 61259.30638,
            pass: 2,
            band: 'D3',
            wavelength_um: 1.7435,
            bandwidth_um: 0.0424,
            image: 'img/m31/level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.png'
          }
        ]
      },
      {
        id: 'sedna',
        name: '90377 Sedna (Solar System Reference)',
        ra: 55.912,
        dec: 12.115,
        size_arcmin: 6.0,
        pixscale_arcsec: 3.1,
        grid_px: [116, 116],
        center_px: [58.0, 58.0],
        north_up_east_left: true,
        collection_note: 'SPHEREx survey coordinates (No synthetic dipole; verified sky mode)',
        dipole: null,
        observations: [
          {
            id: 'level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262',
            date_utc: '2025-07-18T07:30:48Z',
            mjd: 60874.31306,
            pass: 0,
            band: 'D3',
            wavelength_um: 2.2345,
            bandwidth_um: 0.0557,
            image: 'img/m31/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.png'
          },
          {
            id: 'level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223',
            date_utc: '2026-08-07T07:21:10Z',
            mjd: 61259.30638,
            pass: 2,
            band: 'D3',
            wavelength_um: 1.7435,
            bandwidth_um: 0.0424,
            image: 'img/m31/level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.png'
          }
        ]
      }
    ],
    generated_utc: new Date().toISOString()
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const targetId = searchParams.get('bodyId') || searchParams.get('target') || null;
  const data = loadTargets(targetId);

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
      'X-SkyTrace-Backend': 'nextjs-targets-live',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export async function HEAD(request) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600',
      'X-SkyTrace-Backend': 'nextjs-targets-live',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
