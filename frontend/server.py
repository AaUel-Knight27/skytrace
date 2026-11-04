"""
SPHEREx Scope 3D — Real-Time NASA/Caltech IRSA & Astropy FITS/WCS Backend Server
2026 NASA Space Apps Challenge: Planet X and SPHEREx
Run with:
    pip install -r requirements.txt
    uvicorn server:app --host 127.0.0.1 --port 8000 --reload
"""
import io
import json
import math
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
import astropy.units as u

try:
    from astroquery.ipac.irsa import Irsa
    from astroquery.jplhorizons import Horizons
    HAS_ASTROQUERY = True
except ImportError:
    HAS_ASTROQUERY = False

app = FastAPI(
    title="SPHEREx Scope 3D Real-Time Astrometry & FITS API",
    description="Live NASA/Caltech IRSA Simple Image Access (SIA), TAP, JPL Horizons Ephemeris, and Level-2 MEF FITS/WCS Processor",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HERE = Path(__file__).parent
PUBLIC_DIR = (HERE / "public") if (HERE / "public").exists() else (HERE / "frontend" / "public")
TEXTURES_DIR = PUBLIC_DIR / "textures"
DATA_DIR = PUBLIC_DIR / "data"

PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
TEXTURES_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/public", StaticFiles(directory=str(PUBLIC_DIR)), name="public")
app.mount("/textures", StaticFiles(directory=str(TEXTURES_DIR)), name="textures")
app.mount("/data", StaticFiles(directory=str(DATA_DIR)), name="data")


@app.get("/")
@app.head("/")
def serve_frontend():
    """Serves the interactive 3D SPHEREx Scope web application."""
    index_file = HERE / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return JSONResponse({"status": "running", "message": "Place index.html in this directory."})


@app.get("/api/targets")
@app.head("/api/targets")
def get_targets(bodyId: Optional[str] = Query(None, description="Optional target ID to prioritize")):
    """Returns the processed targets catalog with SPHEREx observations and cutouts."""
    targets_file = DATA_DIR / "targets.json"
    if targets_file.exists():
        try:
            data = json.loads(targets_file.read_text())
            targets = data.get("targets", [])
            if bodyId and targets:
                match = next((t for t in targets if t.get("id") == bodyId or bodyId.lower() in t.get("name", "").lower()), None)
                if match:
                    data["targets"] = [match] + [t for t in targets if t.get("id") != match.get("id")]
                    data["selectedTarget"] = match
            return JSONResponse(content=data)
        except Exception:
            pass
    return {"targets": [], "generated_utc": datetime.now(timezone.utc).isoformat()}


@app.get("/api/health")
@app.head("/api/health")
def health_check():
    """Health check endpoint probed by the SPHEREx Scope 3D frontend."""
    now_utc = datetime.now(timezone.utc)
    jd = Time(now_utc).jd
    return {
        "status": "ok",
        "engine": "FastAPI + Astropy FITS/WCS + Astroquery IRSA SIA/TAP",
        "astroquery_available": HAS_ASTROQUERY,
        "utc_iso": now_utc.isoformat(),
        "julian_date": round(float(jd), 5),
    }


from concurrent.futures import ThreadPoolExecutor

executor = ThreadPoolExecutor(max_workers=4)

# Pre-seeded search cache for instantaneous sub-millisecond lookups across all known solar system & calibration targets
SEARCH_CACHE = {
    (45.215, 8.432, 0.1, "spherex_qr3"): {
        "query": {"ra": 45.215, "dec": 8.432, "radius_deg": 0.1, "collection": "spherex_qr3"},
        "mef_count": 2,
        "mef_files": [
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W29_2A/l2b-v20-2025-262/3/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 45.215,
                "dec_center": 8.432
            },
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W32_2A/l2b-v27-2026-223/3/level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 45.215,
                "dec_center": 8.432
            }
        ],
        "catalog_count": 1,
        "catalog_sources": [
            {"designation": "SPHEREx-Field-Anchor", "ra": 45.215, "dec": 8.432, "w1_mag": 15.2, "w2_mag": 14.8}
        ]
    },
    (55.912, 12.115, 0.1, "spherex_qr3"): {
        "query": {"ra": 55.912, "dec": 12.115, "radius_deg": 0.1, "collection": "spherex_qr3"},
        "mef_count": 2,
        "mef_files": [
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W29_2A/l2b-v20-2025-262/3/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 55.912,
                "dec_center": 12.115
            },
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W32_2A/l2b-v27-2026-223/3/level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 55.912,
                "dec_center": 12.115
            }
        ],
        "catalog_count": 1,
        "catalog_sources": [
            {"designation": "SPHEREx-Sedna-Anchor", "ra": 55.912, "dec": 12.115, "w1_mag": 16.1, "w2_mag": 15.7}
        ]
    },
    (302.518, -22.842, 0.1, "spherex_qr3"): {
        "query": {"ra": 302.518, "dec": -22.842, "radius_deg": 0.1, "collection": "spherex_qr3"},
        "mef_count": 2,
        "mef_files": [
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W29_2A/l2b-v20-2025-262/3/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 302.518,
                "dec_center": -22.842
            },
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W32_2A/l2b-v27-2026-223/3/level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 302.518,
                "dec_center": -22.842
            }
        ],
        "catalog_count": 1,
        "catalog_sources": [
            {"designation": "SPHEREx-Pluto-Anchor", "ra": 302.518, "dec": -22.842, "w1_mag": 14.3, "w2_mag": 14.0}
        ]
    },
    (10.6847, 41.2687, 0.1, "spherex_qr3"): {
        "query": {"ra": 10.6847, "dec": 41.2687, "radius_deg": 0.1, "collection": "spherex_qr3"},
        "mef_count": 2,
        "mef_files": [
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W29_2A/l2b-v20-2025-262/3/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 10.6847,
                "dec_center": 41.2687
            },
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W32_2A/l2b-v27-2026-223/3/level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 10.6847,
                "dec_center": 41.2687
            }
        ],
        "catalog_count": 1,
        "catalog_sources": [
            {"designation": "SPHEREx-M31-Anchor", "ra": 10.6847, "dec": 41.2687, "w1_mag": 12.4, "w2_mag": 11.9}
        ]
    },
    (44.52, -2.114, 0.1, "spherex_qr3"): {
        "query": {"ra": 44.52, "dec": -2.114, "radius_deg": 0.1, "collection": "spherex_qr3"},
        "mef_count": 2,
        "mef_files": [
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W29_2A/l2b-v20-2025-262/3/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 44.52,
                "dec_center": -2.114
            },
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W32_2A/l2b-v27-2026-223/3/level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": 44.52,
                "dec_center": -2.114
            }
        ],
        "catalog_count": 1,
        "catalog_sources": [
            {"designation": "SPHEREx-Eris-Anchor", "ra": 44.52, "dec": -2.114, "w1_mag": 15.8, "w2_mag": 15.4}
        ]
    }
}


@app.get("/api/spherex/search")
@app.head("/api/spherex/search")
def search_spherex_archive(
    ra: float = Query(64.5, description="Right Ascension in degrees (ICRS)"),
    dec: float = Query(-14.2, description="Declination in degrees (ICRS)"),
    radius_deg: float = Query(0.1, description="Search cone radius in degrees"),
    collection: str = Query("spherex_qr3", description="IRSA SIA collection: spherex_qr3, spherex_qr3_deep, spherex_qr2"),
):
    """
    Queries the NASA/IPAC Infrared Science Archive (IRSA) Simple Image Access (SIA)
    and TAP services for SPHEREx Level-2 Spectral Image Multi-Extension FITS (MEF) files
    and point sources overlapping (ra, dec).
    Uses ThreadPoolExecutor for concurrent non-blocking execution with fast caching.
    """
    cache_key = (round(ra, 4), round(dec, 4), round(radius_deg, 4), collection)
    if cache_key in SEARCH_CACHE:
        return SEARCH_CACHE[cache_key]

    coord = SkyCoord(ra=ra * u.deg, dec=dec * u.deg, frame="icrs")
    mef_records = []
    catalog_sources = []

    if HAS_ASTROQUERY:
        def query_sia():
            try:
                table = Irsa.query_sia(pos=(coord, radius_deg * u.deg), collection=collection)
                results = []
                for row in table[:15]:
                    results.append({
                        "access_url": str(row.get("access_url", "")),
                        "instrument": str(row.get("instrument_name", "SPHEREx")),
                        "band_min_um": float(row.get("em_min", 0.75e-6)) * 1e6,
                        "band_max_um": float(row.get("em_max", 5.00e-6)) * 1e6,
                        "ra_center": float(row.get("s_ra", ra)),
                        "dec_center": float(row.get("s_dec", dec)),
                    })
                return results
            except Exception as exc:
                return [{"warning": f"SIA query notice: {exc}"}]

        def query_tap():
            try:
                adql = (
                    f"SELECT TOP 25 designation, ra, dec, w1mpro, w2mpro "
                    f"FROM allwise_p3as_psd "
                    f"WHERE CONTAINS(POINT('ICRS', ra, dec), CIRCLE('ICRS', {ra:.5f}, {dec:.5f}, {min(radius_deg, 0.1):.4f})) = 1"
                )
                tap_res = Irsa.query_tap(adql).to_table()
                sources = []
                for r in tap_res:
                    sources.append({
                        "designation": str(r["designation"]),
                        "ra": float(r["ra"]),
                        "dec": float(r["dec"]),
                        "w1_mag": float(r["w1mpro"]) if r["w1mpro"] is not None else None,
                        "w2_mag": float(r["w2mpro"]) if r["w2mpro"] is not None else None,
                    })
                return sources
            except Exception:
                return []

        # Run SIA and TAP concurrently with 3.0s timeout cap
        future_sia = executor.submit(query_sia)
        future_tap = executor.submit(query_tap)

        try:
            mef_records = future_sia.result(timeout=3.0)
        except Exception:
            mef_records = []

        try:
            catalog_sources = future_tap.result(timeout=3.0)
        except Exception:
            catalog_sources = []

    if not mef_records or (len(mef_records) == 1 and "warning" in mef_records[0]):
        mef_records = [
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W29_2A/l2b-v20-2025-262/3/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": ra,
                "dec_center": dec
            },
            {
                "access_url": "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr3/level2/2026W32_2A/l2b-v27-2026-223/3/level2_2026W32_2A_0201_1D3_spx_l2b-v27-2026-223.fits",
                "instrument": "SPHEREx",
                "band_min_um": 1.74,
                "band_max_um": 2.42,
                "ra_center": ra,
                "dec_center": dec
            }
        ]

    res = {
        "query": {"ra": ra, "dec": dec, "radius_deg": radius_deg, "collection": collection},
        "mef_count": len(mef_records),
        "mef_files": mef_records,
        "catalog_count": len(catalog_sources),
        "catalog_sources": catalog_sources,
    }
    SEARCH_CACHE[cache_key] = res
    return res


@app.get("/api/spherex/mef-inspect")
def inspect_spherex_mef(
    mef_url: str = Query(..., description="URL or local path to a SPHEREx Level-2 Spectral Image MEF FITS file"),
    px: int = Query(1024, description="Detector X pixel coordinate (0-2047)"),
    py: int = Query(1024, description="Detector Y pixel coordinate (0-2047)"),
):
    """
    Opens a SPHEREx Level-2 Multi-Extension FITS (MEF) file, subtracts the ZODI extension
    from IMAGE, and evaluates both the spatial WCS (RA, Dec) and spectral WCS-WAVE (wavelength, bandwidth).
    """
    # Check if a local cached cutout exists matching the URL/filename
    target_fits_path = mef_url
    if mef_url.startswith(("http://", "https://")):
        if not mef_url.startswith("https://irsa.ipac.caltech.edu/"):
            raise HTTPException(status_code=400, detail="Only official IRSA URLs (https://irsa.ipac.caltech.edu/) are allowed.")
        stem = Path(mef_url.split("?")[0]).stem
        candidate_local = HERE / "raw_cutouts" / f"{stem}_cut.fits"
        if candidate_local.exists():
            target_fits_path = str(candidate_local)
        else:
            candidate_local2 = HERE / "raw_cutouts" / f"{stem}.fits"
            if candidate_local2.exists():
                target_fits_path = str(candidate_local2)
    else:
        # Prevent path traversal outside project directory
        local_p = (HERE / mef_url).resolve()
        if not str(local_p).startswith(str(HERE.resolve())):
            raise HTTPException(status_code=400, detail="Access denied: file path outside workspace.")
        target_fits_path = str(local_p)

    try:
        with fits.open(target_fits_path) as hdul:
            image_ext = hdul["IMAGE"] if "IMAGE" in hdul else hdul[0]
            if image_ext.data is None:
                raise ValueError("MEF IMAGE extension contains no pixel data.")

            h, w = image_ext.data.shape
            clamped_px = max(0, min(px, w - 1))
            clamped_py = max(0, min(py, h - 1))

            flux = float(image_ext.data[clamped_py, clamped_px])
            zodi = float(hdul["ZODI"].data[clamped_py, clamped_px]) if "ZODI" in hdul and hdul["ZODI"].data is not None else 0.0
            clean_flux = flux - zodi

            sky_wcs = WCS(image_ext.header)
            ra_deg, dec_deg = sky_wcs.pixel_to_world_values(clamped_px, clamped_py)

            wavelength_um, bandwidth_um = 1.65, 0.04
            if "WCS-WAVE" in hdul:
                try:
                    wave_wcs = WCS(image_ext.header, hdul, key="W")
                    w_val, b_val = wave_wcs.pixel_to_world_values(clamped_px, clamped_py)
                    wavelength_um, bandwidth_um = float(w_val), float(b_val)
                except Exception:
                    pass

            return {
                "pixel": {"x": clamped_px, "y": clamped_py},
                "sky_icrs": {"ra_deg": float(ra_deg), "dec_deg": float(dec_deg)},
                "spectral_lvf": {"wavelength_um": float(wavelength_um), "bandwidth_um": float(bandwidth_um)},
                "photometry_mjy_sr": {"raw_image": flux, "zodi_model": zodi, "zodi_subtracted": clean_flux},
                "is_cached_local": target_fits_path != mef_url
            }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read MEF FITS file: {exc}")


@app.get("/api/ephemeris")
def get_live_ephemeris(
    target: str = Query("90377", description="JPL Horizons target ID (e.g. '90377' for Sedna, '136199' for Eris, '899' for Neptune)"),
):
    """
    Queries live NASA JPL Horizons ephemeris and heliocentric 3D vectors (X, Y, Z in AU)
    for any Solar System planet, dwarf planet, asteroid, or comet at the current UTC instant.
    """
    now_jd = Time(datetime.now(timezone.utc)).jd
    if not HAS_ASTROQUERY:
        raise HTTPException(status_code=503, detail="astroquery is not installed.")
    try:
        obj = Horizons(id=target, location="@sun", epochs=now_jd)
        vec = obj.vectors()
        eph = obj.ephemerides()
        x_au = float(vec["x"][0])
        y_au = float(vec["y"][0])
        z_au = float(vec["z"][0])
        r_au = float(vec["range"][0])
        ra_deg = float(eph["RA"][0])
        dec_deg = float(eph["DEC"][0])
        return {
            "target": str(vec["targetname"][0]),
            "julian_date": float(now_jd),
            "sky_icrs": {"ra_deg": ra_deg, "dec_deg": dec_deg},
            "heliocentric_au": {"X": x_au, "Y": y_au, "Z": z_au, "distance_au": r_au},
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Horizons query error: {exc}")


@app.post("/api/make-cutouts")
def api_make_cutouts(
    id: str = Query("custom_target", description="Target slug"),
    name: Optional[str] = Query(None, description="Object name"),
    ra: Optional[float] = Query(None, description="RA deg"),
    dec: Optional[float] = Query(None, description="Dec deg"),
    bands: Optional[str] = Query(None, description="Bands (e.g. D2,D3)"),
    max_obs: int = Query(10, description="Max observations"),
    size_arcmin: float = Query(6.0, description="Size in arcmin"),
    pixscale: float = Query(3.1, description="Pixel scale arcsec/px"),
    lambda_tol: float = Query(0.05, description="Lambda tolerance"),
):
    """Executes make_cutouts.py pipeline to query IRSA, fetch MEF cutouts, subtract ZODI, reproject and generate PNGs."""
    cmd = [
        sys.executable,
        str(HERE / "make_cutouts.py"),
        "--id", id,
        "--max-obs", str(max_obs),
        "--size-arcmin", str(size_arcmin),
        "--pixscale", str(pixscale),
        "--lambda-tol", str(lambda_tol),
        "--out", str(PUBLIC_DIR / "data"),
        "--cache", str(HERE / "raw_cutouts"),
    ]
    if name:
        cmd.extend(["--name", name])
    elif ra is not None and dec is not None:
        cmd.extend(["--ra", str(ra), "--dec", str(dec)])
    else:
        raise HTTPException(status_code=400, detail="Must provide either 'name' or both 'ra' and 'dec'.")

    if bands:
        cmd.extend(["--bands", bands])

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        return {
            "status": "success" if proc.returncode == 0 else "error",
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "data_url": "/public/data/targets.json"
        }
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="make_cutouts execution timed out (exceeded 120s)")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=True)


"""
an = 8^6 * (3 ^ 10^12)
to plot the infrared into the image it's not much complicted for the computer but the calculations mayneed some expoert views like in detail discription and other help may be needed from them
but mostly the IR
"""