# SkyTrace: SPHEREx Scope 3D — Real-Time NASA Solar System & All-Sky Infrared Explorer

**NASA Space Apps Challenge 2026: Planet X and SPHEREx**

SkyTrace is an interactive 3D WebGL solar system simulator and astronomical research platform modeled directly after the visual aesthetics, realism, and navigation of [NASA Eyes on the Solar System](https://eyes.nasa.gov/apps/solar-system/). It connects real NASA JPL Horizons ephemerides with Caltech/IPAC Infrared Science Archive (IRSA) Level-2 Multi-Extension FITS (MEF) data to power citizen science searches for Planet X.

---

## 🚀 Key Features

### 1. Real NASA Data Integration
- **Live JPL Horizons Ephemerides (`/api/ephemeris/[bodyId]`)**:
  - Live server-side querying of NASA JPL Horizons REST API in heliocentric ecliptic frame (`OUT_UNITS='AU-D'`, `REF_PLANE='ECLIPTIC'`).
  - High-precision continuous motion generated via Hermite cubic spline interpolation across 3D state vectors $(x, y, z, v_x, v_y, v_z)$.
  - Explicit scientific provenance tagging for every body (`Source: JPL Horizons (Live)` vs `Source: JPL Horizons (Cached)`).
  - **Hypothetical Planet X**: Explicitly distinguished as **"Candidate — not yet confirmed"** with simulated candidate orbit based on the Battygin & Brown (2016/2021) model.
- **Real SPHEREx Level-2 MEF Sky Imagery (`/api/spherex/...`)**:
  - Thin Next.js reverse-proxy to the Python microservice for IRSA Simple Image Access (SIA), TAP ADQL queries, and FITS processing.
  - Pixel-level zodiacal light subtraction ($F_{\text{clean}} = \text{IMAGE} - \text{ZODI}$) and WCS-WAVE spectral wavelength evaluation.
  - Multi-epoch cutout comparison (e.g. M31 Survey 1 2025-W29 vs Survey 2 2026-W32).

### 2. High-Fidelity 3D Graphics (NASA Eyes Benchmark)
- **Sun PointLight & Physically-Based Shading**: PBR materials across all solar system bodies with accurate roughness, metalness, and axial rotations.
- **Atmospheric Fresnel Limb Glow**: Custom additive Fresnel limb-scattering shader for atmosphere-bearing bodies (Venus, Earth, Mars, Uranus, Neptune, Planet X).
- **Earth Day/Night Dynamic Shader**: Real-time terminator blending between day surface texture (`earth.jpg`) and night city lights (`earth_night.jpg`) based on Sun incidence angle, layered with an independently rotating cloud deck (`earth_clouds.jpg`) and Rayleigh blue halo.
- **Volumetric Parallax Starfield**: Thousands of 3D stars distributed at depths from 600 to 2,800 units with spectral color temperatures, producing authentic motion parallax alongside the Milky Way skybox.
- **UnrealBloomPass Post-Processing**: Selective bloom on the solar corona, atmospheric limbs, and reticle highlights.
- **SPHEREx Procedural Spacecraft Model**: Low-poly aluminum bus, golden MLI conical photon shield, cryogenic telescope barrel, dual solar wings, in a 650 km Sun-synchronous polar terminator orbit with a dynamic 3.5° × 11.3° infrared FOV scanning cone.
- **Active Orbit Highlights**: Dynamic opacity fading with distance and glowing highlight for the selected body's orbit.

### 3. Camera & Interaction Mechanics
- **Cinematic Arced Fly-To**: Smooth quintic ease-in-out transition with altitude arc elevation during interplanetary transit.
- **Follow vs. Free-Look Mode**: Toggle between locked planetary tracking and unrestricted free-look navigation.
- **True Scale vs. Visual Scale Toggle**: Switch instantly between compressed visual scaling and 1:1 true physical distance scaling for scientific parallax demonstrations.
- **Zoom Clamping**: Dynamic minimum distance limiter preventing camera penetration into planetary surfaces.

### 4. Challenge-Specific Astronomical Research Tools
- **Multi-Epoch Blink Inspector**: Auto-blink, interactive split wipe, and mathematical $|I_2 - I_1|$ differential difference engine with thermal, grayscale, and dipole false-color modes.
- **6-Month Parallax Calculator**: Live baseline distance and pixel shift metrics ($\Delta\theta = 2\text{ AU} / d$, $\Delta\text{px} = \theta / 6.2^{\prime\prime}$).
- **102-Band LVF Continuous Tuner**: Slider spanning 0.75 µm to 5.00 µm across 6 Hawaii-2RG detector arrays, featuring molecular absorption diagnostics ($H_2O$ ice, $CH_4$ methane, PAHs, $CO_2$, $CO$, and Planet X thermal cooling).
- **Interactive Autocomplete**: Search dropdown with category chips, color swatches, and distance tags.
- **Draggable Mission Timeline Scrubber**: Continuous date navigation from 2025 to 2027 with a "Jump to Now" control.

---

## 📡 Data Endpoints

| Endpoint | Method | Description | Fallback Strategy |
| :--- | :--- | :--- | :--- |
| `/api/ephemeris/[bodyId]` | `GET` | Fetches JPL Horizons vectors for Mercury–Neptune, Ceres, Pluto, Eris, Sedna. Returns candidate metadata for Planet X. | Stale-while-revalidate in-memory cache + committed fallback JSON snapshots in `public/data/fallback/ephemeris/`. 3s timeout. |
| `/api/spherex/health` | `GET` | Microservice health status and Astropy/Astroquery availability check. | Returns offline fallback response. |
| `/api/spherex/targets` | `GET` | Catalog of SPHEREx targets with multi-epoch cutouts and observation metadata. | Serves `public/data/targets.json`. |
| `/api/spherex/mef-inspect` | `GET` | Level-2 MEF FITS reader: evaluates spatial WCS (RA, Dec), WCS-WAVE (wavelength, bandwidth), and ZODI subtraction. | Evaluates calibrated mathematical model. |
| `/api/spherex/search` | `GET` | Queries IRSA SIA and TAP for SPHEREx MEF files and ALLWISE point sources. | Returns cached target records. |
| `/api/spherex/make-cutouts`| `POST`| Runs `make_cutouts.py` pipeline to download, reproject, and generate cutout PNGs. | Returns cached pipeline output. |

---

## 🛠️ Local Development Setup

### Running Frontend and Microservice Together

```bash
# 1. Clone / Navigate to project workspace
cd /home/aauel/WebstormProjects/skytrace/frontend

# 2. Install Node.js dependencies (Next.js 15, React 19, Three.js)
npm install

# 3. Install Python dependencies in a virtual environment
pip install -r requirements.txt

# 4. Start the Python FastAPI microservice (runs on port 8000)
uvicorn server:app --host 127.0.0.1 --port 8000 --reload

# 5. In a separate terminal, start the Next.js development server (runs on port 3000)
npm run dev
```

Then visit **`http://localhost:3000`** in your browser.

---

## ☁️ Separate Production Deployment

For production deployments, the frontend and Python microservice can be hosted separately:

- **Next.js Frontend on Vercel**: Deploy the `/frontend` directory directly to Vercel (Next.js App Router is natively supported). Configure the environment variable:
  ```env
  SPHEREX_BACKEND_URL=https://your-spherex-backend.onrender.com
  ```
  Vercel will manage serverless edge caching, stale-while-revalidate headers, and static asset distribution. Even if the backend goes to sleep, the Next.js app gracefully serves committed offline fallback data.

- **Python Microservice on Render / Railway / Fly.io**: Deploy `server.py`, `make_cutouts.py`, and `requirements.txt` using Python 3.10+ with the start command:
  ```bash
  uvicorn server:app --host 0.0.0.0 --port $PORT
  ```
  This containerized service executes Astropy, Astroquery, and PyVO to connect directly to the Caltech IRSA TAP and JPL Horizons APIs.
