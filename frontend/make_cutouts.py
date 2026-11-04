import argparse
import json
import math
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS
import astropy.units as u
from PIL import Image
from reproject import reproject_interp
import pyvo

TAP_URL = "https://irsa.ipac.caltech.edu/TAP"

BAD_FLAG_BITS = [0, 1, 2, 6, 7, 9, 10, 11, 14, 15, 17, 19]
BAD_MASK = sum(1 << b for b in BAD_FLAG_BITS)

NATIVE_PIXSCALE = 6.2  # arcsec per SPHEREx pixel


def query_observations(ra, dec, bands):
    """Return a list of dicts (one per image covering ra, dec), sorted by time."""
    try:
        import pyvo
    except ImportError:
        sys.exit("pyvo is missing: pip install pyvo")

    band_clause = ""
    if bands:
        band_clause = " AND (" + " OR ".join(
            f"p.energy_bandpassname = 'SPHEREx-{b}'" for b in bands) + ")"
    adql = (
        "SELECT 'https://irsa.ipac.caltech.edu/' || a.uri AS download_url, "
        "p.obs_publisher_did, p.time_bounds_lower, p.time_bounds_upper, "
        "p.energy_bandpassname, p.energy_bounds_lower, p.energy_bounds_upper "
        "FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid "
        f"WHERE CONTAINS(POINT('ICRS', {ra:.6f}, {dec:.6f}), p.poly) = 1{band_clause} "
        "ORDER BY p.time_bounds_lower"
    )
    service = pyvo.dal.TAPService(TAP_URL)
    try:
        table = service.search(adql).to_table()
    except Exception as exc:
        print(f"sync TAP query failed ({exc}); trying an async job ...")
        try:
            job = service.submit_job(adql)
            job.run()
            job.wait(phases=["COMPLETED", "ERROR", "ABORTED"], timeout=300)
            table = job.fetch_result().to_table()
        except Exception as exc2:
            sys.exit(f"Could not get an answer from IRSA TAP ({exc2}).\n"
                     "Check your internet connection / that irsa.ipac.caltech.edu opens in a browser, "
                     "then run again.")

    obs = []
    for row in table:
        url = str(row["download_url"])
        if not url.split("?")[0].endswith(".fits"):
            continue
        mjd = (float(row["time_bounds_lower"]) + float(row["time_bounds_upper"])) / 2.0
        obs.append({
            "url": url,
            "obs_id": re.sub(r"[^A-Za-z0-9_.-]", "_", Path(url.split("?")[0]).stem),
            "mjd": mjd,
            "band": str(row["energy_bandpassname"]).split("-")[-1],
            "plane_lo_um": float(row["energy_bounds_lower"]) * 1e6,
            "plane_hi_um": float(row["energy_bounds_upper"]) * 1e6,
        })
    obs.sort(key=lambda o: o["mjd"])
    return obs


def assign_passes(obs, gap_days):
    """A 'pass' = one visit of the survey to this patch. A big time gap starts a new pass."""
    p = 0
    for i, o in enumerate(obs):
        if i and o["mjd"] - obs[i - 1]["mjd"] > gap_days:
            p += 1
        o["pass"] = p
    return p + 1 if obs else 0


def thin(obs, max_obs):
    """Keep at most max_obs images, spread evenly through time."""
    if len(obs) <= max_obs:
        return obs
    idx = np.unique(np.linspace(0, len(obs) - 1, max_obs).round().astype(int))
    return [obs[i] for i in idx]


def fetch_cutout(o, ra, dec, size_arcmin, cache_dir, full):
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{o['obs_id']}_{'full' if full else 'cut'}.fits"
    if path.exists() and path.stat().st_size > 0:
        return path

    base = o["url"]
    if full:
        urls = [base]
    else:
        pos = f"center={ra:.6f},{dec:.6f}&size={size_arcmin:.3f}arcmin"
        urls = [f"{base}?{pos}&gzip=false", f"{base}?{pos}"]

    last_err = None
    for url in urls:
        for attempt in range(3):
            try:
                r = requests.get(url, stream=True, timeout=30)
                if r.status_code in (400, 404, 403, 410):
                    last_err = f"HTTP {r.status_code} for {url}"
                    break
                r.raise_for_status()
                tmp = path.with_suffix(".part")
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
                tmp.rename(path)
                return path
            except Exception as exc:
                last_err = str(exc)
                time.sleep(1 * (attempt + 1))
    raise RuntimeError(f"download failed for {o['obs_id']}: {last_err}")


def measure_wavelength(hdul, wcs_img, coord, plane_lo, plane_hi):
    x, y = wcs_img.world_to_pixel(coord)
    try:
        wwcs = WCS(hdul["IMAGE"].header, fobj=hdul, key="W")
        wwcs.sip = None
        wl, bw = wwcs.pixel_to_world(x, y)
        wl_um = float(u.Quantity(wl).to_value(u.um))
        bw_um = float(u.Quantity(bw).to_value(u.um))
        pad = 0.02 * (plane_hi - plane_lo)
        if plane_lo - pad <= wl_um <= plane_hi + pad:
            return wl_um, bw_um, "wcs-wave"
    except Exception:
        pass
    return 0.5 * (plane_lo + plane_hi), None, "band-midpoint"


def remove_background(img, zodi, bad, iters=4, clip=3.0):
    ny, nx = img.shape
    yy, xx = np.mgrid[0:ny, 0:nx]
    xn = (xx - nx / 2.0) / nx
    yn = (yy - ny / 2.0) / ny
    cols = [np.ones_like(xn), xn, yn, xn * xn, xn * yn, yn * yn]
    if zodi is not None:
        z = np.where(np.isfinite(zodi), zodi, 0.0)
        cols.insert(0, z - np.mean(z))
    A = np.stack([c.ravel() for c in cols], axis=1).astype(np.float64)
    b = img.ravel().astype(np.float64)

    good = ~bad.ravel() & np.isfinite(b)
    if good.sum() < max(30, A.shape[1]):
        return np.full_like(img, np.nan)
    coef = np.zeros(A.shape[1])
    for _ in range(iters):
        if good.sum() < A.shape[1]:
            break
        coef, *_ = np.linalg.lstsq(A[good], b[good], rcond=None)
        resid = b - A @ coef
        sig = 1.4826 * np.median(np.abs(resid[good] - np.median(resid[good])))
        if not np.isfinite(sig) or sig <= 0:
            break
        good = good & (np.abs(resid) < clip * sig)
    out = (b - A @ coef).reshape(img.shape).astype(np.float32)
    out[bad] = np.nan
    return out


def load_observation(path, o, coord, size_arcmin, out_wcs, out_shape):
    with fits.open(path) as hdul:
        hdr = hdul["IMAGE"].header
        img = np.array(hdul["IMAGE"].data, dtype=np.float32)
        zodi = np.array(hdul["ZODI"].data, dtype=np.float32) if "ZODI" in hdul else None
        flags = np.array(hdul["FLAGS"].data) if "FLAGS" in hdul else None
        wcs_img = WCS(hdr)
        wl, bw, wl_src = measure_wavelength(hdul, wcs_img, coord, o["plane_lo_um"], o["plane_hi_um"])

    x, y = wcs_img.world_to_pixel(coord)
    ny, nx = img.shape
    if not (-5 <= x <= nx + 5 and -5 <= y <= ny + 5):
        return None
    half = int(math.ceil(size_arcmin * 60 / NATIVE_PIXSCALE * 0.75)) + 25
    x0, x1 = max(0, int(x) - half), min(nx, int(x) + half + 1)
    y0, y1 = max(0, int(y) - half), min(ny, int(y) + half + 1)
    sl = (slice(y0, y1), slice(x0, x1))
    img = img[sl]
    zodi = zodi[sl] if zodi is not None else None
    flags = flags[sl] if flags is not None else None
    wcs_img = wcs_img[sl]

    bad = ~np.isfinite(img)
    if flags is not None:
        bad |= (flags.astype(np.int64) & BAD_MASK) != 0
    clean = remove_background(img, zodi, bad)

    regrid, footprint = reproject_interp((clean, wcs_img), out_wcs, shape_out=out_shape,
                                         order="bilinear")
    regrid = np.where(footprint > 0.5, regrid, np.nan).astype(np.float32)
    coverage = float(np.isfinite(regrid).mean())
    return {"data": regrid, "coverage": coverage, "wavelength_um": wl,
            "bandwidth_um": bw, "wavelength_source": wl_src}


def build_groups(obs, tol):
    ordered = sorted(obs, key=lambda o: (o.get("wavelength_um") is not None, o.get("wavelength_um") or 0.0))
    clusters, cur = [], []
    for o in ordered:
        o_wl = o.get("wavelength_um") or 0.0
        cur_wl = cur[0].get("wavelength_um") or 0.0 if cur else 0.0
        if cur and cur_wl > 0 and o_wl > cur_wl * (1 + tol):
            clusters.append(cur)
            cur = []
        cur.append(o)
    if cur:
        clusters.append(cur)
    return clusters


def stretch_params(arrays):
    vals = np.concatenate([a[np.isfinite(a)].ravel() for a in arrays])
    if vals.size == 0:
        return 0.0, 1.0, 1.0
    med = float(np.median(vals))
    sig = float(1.4826 * np.median(np.abs(vals - med))) or 1e-6
    vmin = med - sig
    vmax = max(float(np.percentile(vals, 99.7)), med + 10 * sig)
    return vmin, vmax, 3 * sig


def to_png(data, vmin, vmax, soft, path):
    norm = np.arcsinh(np.clip(data - vmin, 0, None) / soft) / np.arcsinh((vmax - vmin) / soft)
    grey = (np.clip(np.nan_to_num(norm, nan=0.0), 0, 1) * 255).astype(np.uint8)
    alpha = np.where(np.isfinite(data), 255, 0).astype(np.uint8)
    img = np.dstack([grey, alpha])[::-1]
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, mode="LA").save(path, optimize=True)


def make_output_wcs(coord, size_arcmin, pixscale):
    n = int(round(size_arcmin * 60 / pixscale))
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [coord.ra.deg, coord.dec.deg]
    w.wcs.crpix = [(n + 1) / 2.0, (n + 1) / 2.0]
    w.wcs.cdelt = [-pixscale / 3600.0, pixscale / 3600.0]
    return w, (n, n)


def update_targets_json(out_dir, target):
    path = out_dir / "targets.json"
    doc = {"targets": []}
    if path.exists():
        try:
            doc = json.loads(path.read_text())
        except Exception:
            pass
    doc["targets"] = [t for t in doc.get("targets", []) if t.get("id") != target["id"]] + [target]
    doc["generated_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, indent=1))
    return path


def run(args, coord, obs_all, fetch=fetch_cutout):
    out_dir = Path(args.out)
    n_passes = assign_passes(obs_all, args.pass_gap_days)
    obs = thin(obs_all, args.max_obs)

    print(f"{len(obs_all)} images cover this position, in {n_passes} survey pass(es). "
          f"Using {len(obs)} (--max-obs {args.max_obs}).")
    if args.dry_run:
        by_band = {}
        for o in obs_all:
            by_band[o["band"]] = by_band.get(o["band"], 0) + 1
        print("images per band:", dict(sorted(by_band.items())))
        for p in range(n_passes):
            ts = [o["mjd"] for o in obs_all if o["pass"] == p]
            a = Time(min(ts), format="mjd").utc.iso[:10]
            b = Time(max(ts), format="mjd").utc.iso[:10]
            print(f"  pass {p}: {sum(1 for o in obs_all if o['pass'] == p)} images, {a} .. {b}")
        mb = 70 if args.full_download else 5
        print(f"estimated download for the {len(obs)} selected: about {len(obs) * mb} MB. "
              "Nothing downloaded (--dry-run).")
        return None

    out_wcs, shape = make_output_wcs(coord, args.size_arcmin, args.pixscale)
    kept = []
    for i, o in enumerate(obs, 1):
        try:
            path = fetch(o, coord.ra.deg, coord.dec.deg, args.size_arcmin,
                         Path(args.cache), args.full_download)
            res = load_observation(path, o, coord, args.size_arcmin, out_wcs, shape)
        except Exception as exc:
            print(f"[{i}/{len(obs)}] {o['obs_id']}: skipped ({exc})")
            continue
        if res is None or res["coverage"] < args.min_coverage:
            print(f"[{i}/{len(obs)}] {o['obs_id']}: skipped (target near/outside the image edge)")
            continue
        o.update(res)
        kept.append(o)
        if len(kept) == 1:
            print(f"wavelength check: lambda = {o['wavelength_um']:.3f} um "
                  f"(image range {o['plane_lo_um']:.3f}-{o['plane_hi_um']:.3f} um), "
                  f"source = {o['wavelength_source']}")
        print(f"[{i}/{len(obs)}] {o['obs_id']}  pass {o['pass']}  "
              f"{o['wavelength_um']:.3f} um  coverage {o['coverage']:.0%}")

    if not kept:
        sys.exit("No usable images. Re-run with --dry-run to inspect what the archive returned.")

    groups = build_groups(kept, args.lambda_tol)
    obs_json, groups_json = [], []
    for gi, members in enumerate(groups):
        vmin, vmax, soft = stretch_params([m["data"] for m in members])
        members.sort(key=lambda m: m["mjd"])
        for m in members:
            rel = f"img/{args.id}/{m['obs_id']}.png"
            to_png(m["data"], vmin, vmax, soft, out_dir / rel)
            obs_json.append({
                "id": m["obs_id"],
                "date_utc": Time(m["mjd"], format="mjd").utc.isot[:19] + "Z",
                "mjd": round(m["mjd"], 5),
                "pass": m["pass"],
                "band": m["band"],
                "wavelength_um": round(m["wavelength_um"], 4),
                "bandwidth_um": None if m["bandwidth_um"] is None else round(m["bandwidth_um"], 4),
                "wavelength_source": m["wavelength_source"],
                "coverage": round(m["coverage"], 3),
                "group": gi,
                "image": rel,
                "source_url": m["url"],
            })
        passes = sorted({m["pass"] for m in members})
        groups_json.append({
            "group": gi,
            "wavelength_um": round(float(np.mean([m["wavelength_um"] for m in members])), 4),
            "passes": passes,
            "blinkable": len(passes) >= 2,
            "observations": [m["obs_id"] for m in members],
        })

    n = shape[0]
    target = {
        "id": args.id, "name": args.name or args.id,
        "ra": round(coord.ra.deg, 6), "dec": round(coord.dec.deg, 6),
        "size_arcmin": args.size_arcmin, "pixscale_arcsec": args.pixscale,
        "grid_px": [n, n], "center_px": [n / 2.0, n / 2.0], "north_up_east_left": True,
        "collection_note": "SPHEREx Level-2 spectral images via IRSA (QR); cite DOI 10.26131/IRSA652",
        "observations": sorted(obs_json, key=lambda r: r["mjd"]),
        "groups": groups_json,
    }
    path = update_targets_json(out_dir, target)
    blink = sum(g["blinkable"] for g in groups_json)
    print(f"\nWrote {len(obs_json)} PNGs and {path}")
    print(f"{blink} of {len(groups_json)} wavelength groups span 2+ passes (blinkable).")
    if blink == 0:
        print("None blinkable yet: raise --max-obs, or loosen --lambda-tol (e.g. 0.05).")
    return target


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", required=True, help="short slug, e.g. m31")
    ap.add_argument("--name", help="object name resolved with Sesame (fixed objects only)")
    ap.add_argument("--ra", type=float, help="RA in degrees (ICRS)")
    ap.add_argument("--dec", type=float, help="Dec in degrees (ICRS)")
    ap.add_argument("--size-arcmin", type=float, default=6.0, help="cutout width (default 6)")
    ap.add_argument("--pixscale", type=float, default=3.1, help="output arcsec/pixel (default 3.1)")
    ap.add_argument("--bands", help="comma list of detectors, e.g. D2,D3 (see --dry-run)")
    ap.add_argument("--max-obs", type=int, default=40, help="max images to download (default 40)")
    ap.add_argument("--pass-gap-days", type=float, default=30.0)
    ap.add_argument("--lambda-tol", type=float, default=0.03,
                    help="images within this fraction in wavelength count as the same colour")
    ap.add_argument("--min-coverage", type=float, default=0.5)
    ap.add_argument("--out", default="./public/data")
    ap.add_argument("--cache", default="./raw_cutouts")
    ap.add_argument("--dry-run", action="store_true", help="list what exists, download nothing")
    ap.add_argument("--full-download", action="store_true",
                    help="download whole files (~70 MB each) instead of cutouts")
    args = ap.parse_args()

    if args.name:
        try:
            coord = SkyCoord.from_name(args.name)
        except Exception as exc:
            sys.exit(f"Could not resolve '{args.name}' ({exc}). Moving objects need --ra/--dec.")
    elif args.ra is not None and args.dec is not None:
        coord = SkyCoord(args.ra * u.deg, args.dec * u.deg, frame="icrs")
    else:
        sys.exit("Give --name, or both --ra and --dec.")
    print(f"Target {args.id}: RA {coord.ra.deg:.5f}  Dec {coord.dec.deg:.5f}")

    bands = [b.strip() for b in args.bands.split(",")] if args.bands else None
    obs_all = query_observations(coord.ra.deg, coord.dec.deg, bands)
    if not obs_all:
        sys.exit("The archive returned no SPHEREx images for this position/band.")
    run(args, coord, obs_all)


if __name__ == "__main__":
    main()
