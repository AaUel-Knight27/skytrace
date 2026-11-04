'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SOLAR_SYSTEM_BODIES } from '../lib/catalog';
import { getBodyState, generateOrbitCurvePoints, auToSceneUnits } from '../lib/ephemeris';

// Celestial direction for equatorial coordinates (RA, Dec in degrees)
function getCelestialDirection(raDeg, decDeg) {
  const raRad = (raDeg * Math.PI) / 180;
  const decRad = (decDeg * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(decRad) * Math.cos(raRad),
    Math.sin(decRad),
    -Math.cos(decRad) * Math.sin(raRad)
  ).normalize();
}

export default function ThreeCosmoViewer({
  simDate,
  selectedBodyId = 'm31',
  onSelectBody,
  showOrbits = true,
  showLabels = true,
  showSightline = true,
  scaleExaggeration = 1.0,
  isTrueScale = false,
  cameraMode = 'spherex_pov', // 'spherex_pov' | 'spacecraft' | 'freelook'
  onCameraModeChange,
  ephemerisStore = {}
}) {
  const mountRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const skyMeshRef = useRef(null);
  const beltsRef = useRef([]);
  const meshesRef = useRef({});
  const orbitLinesRef = useRef({});
  const sightlineRef = useRef(null);
  const spherexGroupRef = useRef(null);
  const discoveredFieldGroupRef = useRef(null);
  const earthMeshRef = useRef(null);
  const earthCloudsRef = useRef(null);

  const [screenLabels, setScreenLabels] = useState([]);
  const [opticalFov, setOpticalFov] = useState(32);
  const [hudCoords, setHudCoords] = useState({ ra: '10° 41\' 05"', dec: '+41° 16\' 08"', target: 'M31 Discovered Field' });

  // Pan / Tilt offset angles for SPHEREx telescope mount
  const telescopeLookRef = useRef({
    yaw: 0,
    pitch: 0,
    isDragging: false,
    startX: 0,
    startY: 0
  });

  const stateRef = useRef({
    simDate,
    selectedBodyId,
    showOrbits,
    showLabels,
    showSightline,
    scaleExaggeration,
    isTrueScale,
    cameraMode,
    ephemerisStore
  });

  // Keep stateRef updated with React props
  useEffect(() => {
    stateRef.current = {
      ...stateRef.current,
      simDate,
      selectedBodyId,
      showOrbits,
      showLabels,
      showSightline,
      scaleExaggeration,
      isTrueScale,
      cameraMode,
      ephemerisStore
    };

    // Update orbit line vertices if true scale toggled
    SOLAR_SYSTEM_BODIES.forEach((b) => {
      const line = orbitLinesRef.current[b.id];
      if (line && b.a > 0) {
        const curvePts = generateOrbitCurvePoints(b, 220, isTrueScale).map(
          (p) => new THREE.Vector3(p.x, p.y, p.z)
        );
        line.geometry.setFromPoints(curvePts);
      }
    });

    beltsRef.current.forEach((belt) => {
      if (belt.updateScale) belt.updateScale(isTrueScale);
    });

    // Orbit visibility (hidden in telescope POV)
    Object.entries(orbitLinesRef.current).forEach(([bodyId, line]) => {
      line.visible = showOrbits && cameraMode !== 'spherex_pov';
      line.material.opacity = bodyId === selectedBodyId ? 0.95 : 0.25;
    });

    if (sightlineRef.current) {
      sightlineRef.current.visible = showSightline && cameraMode !== 'spherex_pov';
    }
  }, [
    simDate,
    selectedBodyId,
    showOrbits,
    showLabels,
    showSightline,
    scaleExaggeration,
    isTrueScale,
    cameraMode,
    ephemerisStore
  ]);

  const handleCenterDiscoveredField = () => {
    telescopeLookRef.current.yaw = 0;
    telescopeLookRef.current.pitch = 0;
    if (cameraRef.current) {
      cameraRef.current.fov = 32;
      cameraRef.current.updateProjectionMatrix();
      setOpticalFov(32);
    }
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene & Camera Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x01030d);

    const camera = new THREE.PerspectiveCamera(
      32, // Realistic space telescope optical FOV
      container.clientWidth / container.clientHeight,
      0.05,
      75000
    );
    cameraRef.current = camera;

    // 2. High-Precision WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    // 3. OrbitControls (Used for Spacecraft view and Freelook)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxDistance = 50000;
    controls.minDistance = 0.8;
    controlsRef.current = controls;

    // 4. UnrealBloomPass (Atmosphere & Coronal Glare)
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.45,
      0.35,
      0.82
    );
    composer.addPass(bloomPass);

    const textureLoader = new THREE.TextureLoader();

    // 5. Deep Space Milky Way Skybox
    const skyGeo = new THREE.SphereGeometry(26000, 48, 48);
    const skyMat = new THREE.MeshBasicMaterial({
      map: textureLoader.load('/textures/milkyway.jpg'),
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);
    skyMeshRef.current = skyMesh;

    // 6. Volumetric Starfield (Astronomical Background)
    const starCount = 3800;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const dist = 700 + Math.random() * 2400;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);

      starPositions[i * 3] = dist * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = dist * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = dist * Math.cos(phi);

      const roll = Math.random();
      if (roll < 0.3) {
        starColors[i * 3] = 0.75;
        starColors[i * 3 + 1] = 0.88;
        starColors[i * 3 + 2] = 1.0;
      } else if (roll < 0.7) {
        starColors[i * 3] = 0.95;
        starColors[i * 3 + 1] = 0.95;
        starColors[i * 3 + 2] = 0.95;
      } else {
        starColors[i * 3] = 1.0;
        starColors[i * 3 + 1] = 0.85;
        starColors[i * 3 + 2] = 0.6;
      }
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    const starMat = new THREE.PointsMaterial({
      size: 1.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false
    });
    scene.add(new THREE.Points(starGeo, starMat));

    // 7. Illumination: Sun PointLight
    const sunLight = new THREE.PointLight(0xfff7e6, 4.0, 0, 0.0);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x1e293b, 0.85));

    // 8. Earth Day/Night Shading
    const earthDayTex = textureLoader.load('/textures/earth.jpg');
    earthDayTex.colorSpace = THREE.SRGBColorSpace;
    const earthNightTex = textureLoader.load('/textures/earth_night.jpg');
    earthNightTex.colorSpace = THREE.SRGBColorSpace;

    const earthDayNightShaderMat = new THREE.ShaderMaterial({
      uniforms: {
        dayTexture: { value: earthDayTex },
        nightTexture: { value: earthNightTex },
        sunWorldPos: { value: new THREE.Vector3(0, 0, 0) }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vUv = uv;
          vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D dayTexture;
        uniform sampler2D nightTexture;
        uniform vec3 sunWorldPos;
        varying vec2 vUv;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPosition;
        void main() {
          vec3 lightDir = normalize(sunWorldPos - vWorldPosition);
          float sunCos = dot(normalize(vWorldNormal), lightDir);
          vec4 dayColor = texture2D(dayTexture, vUv);
          vec4 nightColor = texture2D(nightTexture, vUv);
          float dayFactor = smoothstep(-0.12, 0.18, sunCos);
          vec3 dayLit = dayColor.rgb * max(0.08, dayFactor);
          float nightFactor = 1.0 - smoothstep(-0.08, 0.15, sunCos);
          vec3 nightLit = nightColor.rgb * nightFactor * 1.5;
          gl_FragColor = vec4(dayLit + nightLit, 1.0);
        }
      `
    });

    // 9. Create Celestial Reference Bodies (Exclude fake Planet X from 3D meshes)
    SOLAR_SYSTEM_BODIES.forEach((body) => {
      // Skip fake Planet X and discovered sky field M31 (rendered separately on celestial sphere)
      if (body.id === 'planetx' || body.id === 'm31') return;

      const group = new THREE.Group();
      const geo = new THREE.SphereGeometry(body.visualRadius, 40, 40);

      let mesh;
      if (body.id === 'earth') {
        mesh = new THREE.Mesh(geo, earthDayNightShaderMat);
        earthMeshRef.current = mesh;
      } else if (body.id === 'sun') {
        const sunTex = textureLoader.load(body.texture);
        sunTex.colorSpace = THREE.SRGBColorSpace;
        mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: sunTex }));
      } else {
        const tex = textureLoader.load(body.texture);
        tex.colorSpace = THREE.SRGBColorSpace;
        mesh = new THREE.Mesh(
          geo,
          new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.7,
            metalness: 0.05
          })
        );
      }

      mesh.userData = { bodyId: body.id };
      group.add(mesh);

      // Earth Cloud Layer
      if (body.id === 'earth' && body.cloudsTexture) {
        const cloudGeo = new THREE.SphereGeometry(body.visualRadius * 1.018, 36, 36);
        const cloudTex = textureLoader.load(body.cloudsTexture);
        const cloudMat = new THREE.MeshStandardMaterial({
          map: cloudTex,
          transparent: true,
          opacity: 0.48,
          blending: THREE.AdditiveBlending
        });
        const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
        group.add(cloudMesh);
        earthCloudsRef.current = cloudMesh;

        // The Moon
        const moonGeo = new THREE.SphereGeometry(body.visualRadius * 0.27, 24, 24);
        const moonTex = textureLoader.load('/textures/moon.jpg');
        moonTex.colorSpace = THREE.SRGBColorSpace;
        const moonMesh = new THREE.Mesh(
          moonGeo,
          new THREE.MeshStandardMaterial({ map: moonTex, roughness: 0.9 })
        );
        moonMesh.position.set(body.visualRadius * 3.4, 0.4, 0);
        group.add(moonMesh);
      }

      scene.add(group);
      meshesRef.current[body.id] = { group, mesh, body };

      // Orbit Line
      if (body.a > 0) {
        const curvePts = generateOrbitCurvePoints(body, 220, false).map(
          (p) => new THREE.Vector3(p.x, p.y, p.z)
        );
        const orbitGeo = new THREE.BufferGeometry().setFromPoints(curvePts);
        const orbitMat = new THREE.LineBasicMaterial({
          color: body.color,
          transparent: true,
          opacity: 0.25
        });
        const orbitLine = new THREE.Line(orbitGeo, orbitMat);
        scene.add(orbitLine);
        orbitLinesRef.current[body.id] = orbitLine;
      }
    });

    // 10. SPHEREx Spacecraft 3D Physical Model
    const spherexGroup = new THREE.Group();
    scene.add(spherexGroup);
    spherexGroupRef.current = spherexGroup;

    // Hexagonal chassis bus
    const spxBus = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.38, 0.75, 6),
      new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 })
    );
    spherexGroup.add(spxBus);

    // Conical outer photon/thermal shield (Golden MLI Radiator Cone)
    const vGrooveShield = new THREE.Mesh(
      new THREE.ConeGeometry(0.95, 0.65, 20, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        side: THREE.DoubleSide,
        metalness: 0.9,
        roughness: 0.2
      })
    );
    vGrooveShield.rotation.x = Math.PI;
    vGrooveShield.position.y = 0.35;
    spherexGroup.add(vGrooveShield);

    // Cryogenic Telescope Optical Barrel & Aperture Ring
    const spxTelescope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.85, 16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.4 })
    );
    spxTelescope.position.y = 0.2;
    spherexGroup.add(spxTelescope);

    // Dual Photovoltaic Solar Arrays
    const solarWingMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      metalness: 0.5,
      roughness: 0.3
    });
    const solarWingLeft = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.4), solarWingMat);
    solarWingLeft.position.set(-0.85, -0.15, 0);
    spherexGroup.add(solarWingLeft);

    const solarWingRight = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.4), solarWingMat);
    solarWingRight.position.set(0.85, -0.15, 0);
    spherexGroup.add(solarWingRight);

    // 11. REAL DISCOVERED SKY: M31 Calibration Field & Footprint
    // RA 10.684708 deg, Dec 41.26875 deg on the celestial sphere
    const m31Dir = getCelestialDirection(10.684708, 41.26875);
    const rSky = 22000;
    const m31SkyPos = m31Dir.clone().multiplyScalar(rSky);

    const discoveredFieldGroup = new THREE.Group();
    discoveredFieldGroup.position.copy(m31SkyPos);
    discoveredFieldGroup.lookAt(new THREE.Vector3(0, 0, 0));
    scene.add(discoveredFieldGroup);
    discoveredFieldGroupRef.current = discoveredFieldGroup;

    // Discovered Sky Cutout Image (Real SPHEREx Level-2 MEF Data)
    const cutoutTex = textureLoader.load(
      '/data/img/m31/level2_2025W29_2A_0202_1D3_spx_l2b-v20-2025-262.png'
    );
    cutoutTex.colorSpace = THREE.SRGBColorSpace;
    const cutoutMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1650, 1650),
      new THREE.MeshBasicMaterial({
        map: cutoutTex,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide
      })
    );
    cutoutMesh.userData = { bodyId: 'm31' };
    discoveredFieldGroup.add(cutoutMesh);

    // SPHEREx 3.5° × 11.3° Footprint Boundary Reticle
    const fovWidth = 1500;
    const fovHeight = 4400; // 11.3° / 3.5° aspect ratio
    const footprintGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-fovWidth / 2, -fovHeight / 2, 5),
      new THREE.Vector3(fovWidth / 2, -fovHeight / 2, 5),
      new THREE.Vector3(fovWidth / 2, fovHeight / 2, 5),
      new THREE.Vector3(-fovWidth / 2, fovHeight / 2, 5),
      new THREE.Vector3(-fovWidth / 2, -fovHeight / 2, 5)
    ]);
    const footprintLine = new THREE.Line(
      footprintGeo,
      new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 2 })
    );
    discoveredFieldGroup.add(footprintLine);

    // Corner targeting brackets
    const bracketLen = 280;
    const bracketPts = [
      // Top-Left
      new THREE.Vector3(-fovWidth / 2 + bracketLen, fovHeight / 2, 8),
      new THREE.Vector3(-fovWidth / 2, fovHeight / 2, 8),
      new THREE.Vector3(-fovWidth / 2, fovHeight / 2 - bracketLen, 8),
      // Top-Right
      new THREE.Vector3(fovWidth / 2 - bracketLen, fovHeight / 2, 8),
      new THREE.Vector3(fovWidth / 2, fovHeight / 2, 8),
      new THREE.Vector3(fovWidth / 2, fovHeight / 2 - bracketLen, 8),
      // Bottom-Right
      new THREE.Vector3(fovWidth / 2 - bracketLen, -fovHeight / 2, 8),
      new THREE.Vector3(fovWidth / 2, -fovHeight / 2, 8),
      new THREE.Vector3(fovWidth / 2, -fovHeight / 2 + bracketLen, 8),
      // Bottom-Left
      new THREE.Vector3(-fovWidth / 2 + bracketLen, -fovHeight / 2, 8),
      new THREE.Vector3(-fovWidth / 2, -fovHeight / 2, 8),
      new THREE.Vector3(-fovWidth / 2, -fovHeight / 2 + bracketLen, 8)
    ];
    const bracketGeo = new THREE.BufferGeometry().setFromPoints(bracketPts);
    const bracketLines = new THREE.LineSegments(
      bracketGeo,
      new THREE.LineBasicMaterial({ color: 0x34d399, linewidth: 2 })
    );
    discoveredFieldGroup.add(bracketLines);

    // 12. Asteroid Belt & Kuiper Belt
    const createBelt = (count, minAU, maxAU, maxIncDeg, colorHex, size) => {
      const baseAU = new Float32Array(count);
      const angles = new Float32Array(count);
      const incs = new Float32Array(count);
      const positions = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
        baseAU[i] = minAU + Math.random() * (maxAU - minAU);
        angles[i] = Math.random() * Math.PI * 2;
        incs[i] = (Math.random() - 0.5) * ((maxIncDeg * Math.PI) / 180);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const updateScale = (trueScaleActive) => {
        const posAttr = geo.attributes.position.array;
        for (let i = 0; i < count; i++) {
          const r = auToSceneUnits(baseAU[i], trueScaleActive);
          const theta = angles[i];
          const inc = incs[i];
          posAttr[i * 3] = r * Math.cos(theta) * Math.cos(inc);
          posAttr[i * 3 + 1] = r * Math.sin(inc);
          posAttr[i * 3 + 2] = r * Math.sin(theta) * Math.cos(inc);
        }
        geo.attributes.position.needsUpdate = true;
      };

      updateScale(stateRef.current.isTrueScale);

      const mat = new THREE.PointsMaterial({
        color: colorHex,
        size,
        map: textureLoader.load('/textures/asteroid_particle.png'),
        transparent: true,
        opacity: 0.5,
        depthWrite: false
      });
      const points = new THREE.Points(geo, mat);
      scene.add(points);
      const beltObj = { points, updateScale };
      beltsRef.current.push(beltObj);
      return beltObj;
    };

    createBelt(1200, 2.1, 3.3, 12, 0x9ca3af, 0.65); // Main Asteroid Belt
    createBelt(1600, 30.0, 55.0, 18, 0x60a5fa, 0.85); // Kuiper Belt

    // 13. SPHEREx Sightline Vector
    const sightGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3()
    ]);
    const sightMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 2.5,
      gapSize: 1.2,
      transparent: true,
      opacity: 0.85
    });
    const sightline = new THREE.Line(sightGeo, sightMat);
    scene.add(sightline);
    sightlineRef.current = sightline;

    // 14. Interactive Pan / Tilt & Pointer Handlers for SPHEREx Telescope POV
    const onPointerDown = (e) => {
      telescopeLookRef.current.isDragging = true;
      telescopeLookRef.current.startX = e.clientX;
      telescopeLookRef.current.startY = e.clientY;
    };

    const onPointerMove = (e) => {
      if (!telescopeLookRef.current.isDragging) return;
      if (stateRef.current.cameraMode === 'spherex_pov') {
        const dx = e.clientX - telescopeLookRef.current.startX;
        const dy = e.clientY - telescopeLookRef.current.startY;
        telescopeLookRef.current.startX = e.clientX;
        telescopeLookRef.current.startY = e.clientY;

        // Smooth telescope gimbal panning
        telescopeLookRef.current.yaw += dx * 0.0022;
        telescopeLookRef.current.pitch = THREE.MathUtils.clamp(
          telescopeLookRef.current.pitch - dy * 0.0022,
          -1.4,
          1.4
        );
      }
    };

    const onPointerUp = () => {
      telescopeLookRef.current.isDragging = false;
    };

    const onWheel = (e) => {
      if (stateRef.current.cameraMode === 'spherex_pov') {
        e.preventDefault();
        camera.fov = THREE.MathUtils.clamp(camera.fov + e.deltaY * 0.035, 8, 65);
        camera.updateProjectionMatrix();
        setOpticalFov(Math.round(camera.fov));
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    // 15. Steady Animation Loop (NO FAKE AXIAL ROTATION, NO RUNAWAY SPINS)
    let animId;
    let frameCount = 0;
    const tempVec = new THREE.Vector3();

    const animate = () => {
      animId = requestAnimationFrame(animate);

      const {
        simDate: curDate,
        selectedBodyId: curTarget,
        scaleExaggeration: scaleMult,
        isTrueScale: trueScale,
        cameraMode: curCamMode,
        ephemerisStore: ephStore
      } = stateRef.current;

      const updatedLabels = [];
      const earthPos = new THREE.Vector3();
      const targetPos = new THREE.Vector3();

      const isPov = curCamMode === 'spherex_pov';

      // Compute physical positions of celestial bodies without fake continuous spinning
      SOLAR_SYSTEM_BODIES.forEach((body) => {
        if (body.id === 'planetx' || body.id === 'm31') return;
        const entry = meshesRef.current[body.id];
        if (!entry) return;

        // When in SPHEREx POV, hide solar system 3D planet meshes so user views only the real discovered sky
        entry.group.visible = !isPov;

        const vectors = ephStore?.[body.id]?.vectors || null;
        const st = getBodyState(body, curDate, trueScale, vectors);

        entry.group.position.set(st.scenePos.x, st.scenePos.y, st.scenePos.z);

        let s = body.id === 'sun' ? 1.0 : scaleMult;
        if (trueScale && body.id !== 'sun') {
          s = Math.max(0.25, (body.radiusKm / 6371.0) * 0.4);
        }
        entry.group.scale.setScalar(s);

        if (body.id === 'earth') earthPos.copy(entry.group.position);
        if (body.id === curTarget) targetPos.copy(entry.group.position);

        // Project screen labels for bodies in front of camera (only in exterior modes)
        if (!isPov) {
          const camToBody = new THREE.Vector3().subVectors(entry.group.position, camera.position);
          const camForward = camera.getWorldDirection(new THREE.Vector3());
          if (camToBody.dot(camForward) > 0) {
            tempVec.copy(entry.group.position);
            tempVec.y += body.visualRadius * s + 0.9;
            tempVec.project(camera);

            if (tempVec.z < 1) {
              updatedLabels.push({
                id: body.id,
                name: body.name,
                color: body.color,
                x: (tempVec.x * 0.5 + 0.5) * container.clientWidth,
                y: (-(tempVec.y * 0.5) + 0.5) * container.clientHeight,
                au: st.trueAU.r.toFixed(1),
                isReal: true,
                statusLabel: body.statusLabel
              });
            }
          }
        }
      });

      // Belts visibility
      beltsRef.current.forEach((belt) => {
        if (belt.points) belt.points.visible = !isPov;
      });

      // Discovered Field M31 Screen Label (always visible)
      if (discoveredFieldGroupRef.current) {
        tempVec.copy(discoveredFieldGroupRef.current.position);
        tempVec.project(camera);
        if (tempVec.z < 1) {
          updatedLabels.push({
            id: 'm31',
            name: 'M31 (Andromeda Galaxy) • Discovered Field',
            color: '#38bdf8',
            x: (tempVec.x * 0.5 + 0.5) * container.clientWidth,
            y: (-(tempVec.y * 0.5) + 0.5) * container.clientHeight,
            au: '2.5 Mly',
            isReal: true,
            statusLabel: 'Level-2 Discovered Field'
          });
        }
      }

      // SPHEREx Physical Position in Sun-synchronous Terminator LEO Orbit
      const spxOrbitDist = trueScale ? 1.6 : 2.8;
      const spxPos = new THREE.Vector3(
        earthPos.x + spxOrbitDist * 0.9,
        earthPos.y + spxOrbitDist * 0.45,
        earthPos.z + spxOrbitDist * 0.25
      );

      if (spherexGroupRef.current) {
        spherexGroupRef.current.position.copy(spxPos);
        // Only show physical spacecraft exterior in spacecraft camera mode
        // In telescope POV, hide spacecraft body so it does not block the telescope's own aperture/view!
        spherexGroupRef.current.visible = (curCamMode === 'spacecraft');

        // Align telescope optical axis (boresight) towards M31 discovered field
        const lookTarget = discoveredFieldGroupRef.current
          ? discoveredFieldGroupRef.current.position
          : m31SkyPos;
        spherexGroupRef.current.lookAt(lookTarget);
      }

      // Sightline vector from Earth/SPHEREx to Discovered Target
      if (sightlineRef.current) {
        sightlineRef.current.visible = !isPov && stateRef.current.showSightline;
        const arr = sightlineRef.current.geometry.attributes.position.array;
        arr[0] = spxPos.x;
        arr[1] = spxPos.y;
        arr[2] = spxPos.z;
        const targetPt = curTarget === 'm31' || !targetPos.length() ? m31SkyPos : targetPos;
        arr[3] = targetPt.x;
        arr[4] = targetPt.y;
        arr[5] = targetPt.z;
        sightlineRef.current.geometry.attributes.position.needsUpdate = true;
        sightlineRef.current.computeLineDistances();
      }

      // Keep celestial skybox anchored on camera
      if (skyMeshRef.current) {
        skyMeshRef.current.position.copy(camera.position);
      }

      // CAMERA POSITIONING BY MODE:
      // 1. SPHEREx POV (Default: Camera is situated AT the telescope aperture looking outward)
      if (curCamMode === 'spherex_pov') {
        controls.enabled = false;

        // Position camera directly at the telescope observer location
        camera.position.copy(spxPos);

        // Compute pointing direction toward discovered field with user's pan/tilt offset
        const targetCoord = discoveredFieldGroupRef.current
          ? discoveredFieldGroupRef.current.position
          : m31SkyPos;
        const baseDir = new THREE.Vector3().subVectors(targetCoord, camera.position).normalize();
        const { yaw, pitch } = telescopeLookRef.current;

        // Rotate base boresight by user's yaw & pitch
        const rotEuler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
        const viewDir = baseDir.clone().applyEuler(rotEuler).normalize();

        const lookAtPoint = camera.position.clone().add(viewDir.clone().multiplyScalar(22000));
        camera.lookAt(lookAtPoint);
      } else if (curCamMode === 'spacecraft') {
        // 2. Spacecraft Exterior View (Over-the-shoulder looking along the telescope)
        controls.enabled = true;
        controls.target.copy(spxPos);

        // Position camera 4 units behind telescope looking past the golden shield
        const backDir = m31Dir.clone().negate();
        const desiredCamPos = spxPos.clone().addScaledVector(backDir, 4.2).add(new THREE.Vector3(1.2, 1.4, 0.8));

        camera.position.lerp(desiredCamPos, 0.08);
        controls.update();
      } else {
        // 3. Free Look Orbit Controls
        controls.enabled = true;
        controls.update();
      }

      frameCount++;
      if (frameCount % 4 === 0) {
        setScreenLabels(updatedLabels);
      }

      composer.render();
    };

    animate();

    // 16. Resize Handler
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="eyes-viewport">
      <div ref={mountRef} className="webgl-canvas-container" />

      {/* SPHEREx TELESCOPE POV OPTICAL HUD OVERLAY */}
      {cameraMode === 'spherex_pov' && (
        <div className="telescope-hud-overlay">
          {/* Top-Left Telescope Telemetry */}
          <div className="hud-telemetry-box">
            <div className="hud-telemetry-badge">🔭 SPHEREx TELESCOPE POINT OF VIEW</div>
            <div className="hud-telemetry-line">
              <span className="hud-label">BORESIGHT:</span>{' '}
              <strong style={{ color: '#38bdf8' }}>RA {hudCoords.ra} | DEC {hudCoords.dec}</strong>
            </div>
            <div className="hud-telemetry-line">
              <span className="hud-label">FIELD:</span>{' '}
              <strong style={{ color: '#34d399' }}>M31 LEVEL-2 DISCOVERED SKY</strong>
            </div>
            <div className="hud-telemetry-line">
              <span className="hud-label">OPTICS:</span> 3.5° × 11.3° LVF SPECTROSCOPIC (FOV {opticalFov}°)
            </div>
          </div>

          {/* Top-Right Quick Controls */}
          <div className="hud-controls-top-right">
            <button
              className="btn btn-tour"
              onClick={handleCenterDiscoveredField}
              title="Snap telescope boresight back to center on discovered M31 field"
            >
              🎯 Center on Discovered Field (M31)
            </button>
            <div className="hud-zoom-pill">Zoom FOV: {opticalFov}°</div>
          </div>

          {/* Central 3.5° × 11.3° SPHEREx Infrared FOV Reticle */}
          <div className="telescope-reticle-frame">
            <div className="reticle-crosshair-h" />
            <div className="reticle-crosshair-v" />
            <div className="reticle-center-dot" />
            <div className="reticle-corner top-left" />
            <div className="reticle-corner top-right" />
            <div className="reticle-corner bottom-left" />
            <div className="reticle-corner bottom-right" />
            <div className="reticle-caption">
              SPHEREx 3.5° × 11.3° INFRARED CAPTURE FOOTPRINT
            </div>
          </div>

          {/* Bottom HUD Tip */}
          <div className="hud-instructions-cue">
            🖱️ DRAG MOUSE TO PAN TELESCOPE • SCROLL TO ZOOM OPTICS • REAL SPHEREx SKY
          </div>
        </div>
      )}

      {/* 3D Floating Celestial Labels */}
      {showLabels && (
        <div className="labels-layer">
          {screenLabels.map((lbl) => (
            <button
              key={lbl.id}
              onClick={() => onSelectBody(lbl.id)}
              style={{
                transform: `translate3d(${lbl.x}px, ${lbl.y}px, 0) translate(-50%, -100%)`
              }}
              className={`planet-label ${lbl.id === selectedBodyId ? 'active' : ''}`}
            >
              <span className="label-dot" style={{ backgroundColor: lbl.color }} />
              <span>{lbl.name}</span>
              {lbl.au && <span className="label-au">{lbl.au}</span>}
              {lbl.id === 'm31' && (
                <span className="label-badge-discovered">Discovered</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
