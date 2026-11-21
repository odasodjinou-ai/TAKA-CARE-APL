// Construction et rendu du monde 3D d'un pays : terrain, ville, routes,
// aéroport, végétation selon le biome, cycle jour/nuit, circulation.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getLayout, makeHeightFn, ROAD_LINES, WORLD, PLACES, AIRPORT, mulberry32 } from '/shared/layout.js';
import { COUNTRY_BY_CODE } from '/shared/countries.js';
import { createCar, createPlane, spinWheels, disposeCar, setLights } from './vehicles.js';
import { VEHICLES } from '/shared/vehicles.js';
import { LOTS, HOUSE_TIERS, RESIDENTIAL, DEFAULT_HOUSE_COLORS } from '/shared/houses.js';
import { formatMoney } from '/shared/catalog.js';

const DAY_SECONDS = 24 * 60; // une journée = 24 minutes réelles

const GROUND = {
  temperate: ['#4f7d32', '#6b8f3a'],
  mediterranean: ['#8d8f4e', '#a59a62'],
  desert: ['#d2ae7c', '#c19468'],
  savanna: ['#b1a05a', '#9c8a48'],
  tropical: ['#3d8a35', '#2f7a2d'],
  snow: ['#e8eef5', '#cfd9e3'],
};

// --- Textures procédurales (canvas) -------------------------------------------
function canvasTexture(size, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noiseFill(ctx, size, base, spread, rand = Math.random) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * spread;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

const TEX = {};
function textures() {
  if (TEX.asphalt) return TEX;
  TEX.asphalt = canvasTexture(256, (ctx, s) => {
    noiseFill(ctx, s, '#3a3d42', 26);
    ctx.fillStyle = '#e5e7eb';
    for (let y = 0; y < s; y += 64) ctx.fillRect(s / 2 - 3, y, 6, 34); // ligne centrale pointillée
    ctx.fillStyle = '#d4d4d8';
    ctx.fillRect(8, 0, 4, s);
    ctx.fillRect(s - 12, 0, 4, s);
  });
  TEX.sidewalk = canvasTexture(128, (ctx, s) => {
    noiseFill(ctx, s, '#a8a29e', 18);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= s; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, s);
      ctx.moveTo(0, i);
      ctx.lineTo(s, i);
      ctx.stroke();
    }
  });
  TEX.concrete = canvasTexture(256, (ctx, s) => {
    noiseFill(ctx, s, '#8b8f96', 20);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i <= s; i += 64) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, s);
      ctx.moveTo(0, i);
      ctx.lineTo(s, i);
      ctx.stroke();
    }
  });
  TEX.runway = canvasTexture(256, (ctx, s) => {
    noiseFill(ctx, s, '#2f3236', 22);
    ctx.fillStyle = '#f1f5f9';
    for (let y = 0; y < s; y += 128) ctx.fillRect(s / 2 - 4, y, 8, 70);
    ctx.fillRect(6, 0, 6, s);
    ctx.fillRect(s - 12, 0, 6, s);
  });
  TEX.grain = canvasTexture(256, (ctx, s) => noiseFill(ctx, s, '#808080', 70), { srgb: false });
  return TEX;
}

/** Façade : murs + fenêtres (map) et fenêtres allumées la nuit (emissiveMap). */
function facadeTextures(seed, style) {
  const rand = mulberry32(seed);
  const s = 128;
  const draw = (lit) =>
    canvasTexture(s, (ctx) => {
      ctx.fillStyle = lit ? '#000' : '#ffffff';
      ctx.fillRect(0, 0, s, s);
      if (!lit) noiseFill(ctx, s, '#f4f4f4', 14, rand);
      const cols = 4;
      const rows = 4;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = 8 + c * 30;
          const y = 8 + r * 30;
          if (lit) {
            if (rand() < 0.45) {
              ctx.fillStyle = rand() < 0.8 ? '#ffd38a' : '#bfe3ff';
              ctx.fillRect(x, y, style === 'glass' ? 26 : 18, 20);
            }
          } else {
            ctx.fillStyle = '#3b4f66';
            ctx.fillRect(x, y, style === 'glass' ? 26 : 18, 20);
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.fillRect(x, y, 6, 20);
          }
        }
      }
    });
  return { map: draw(false), emissive: draw(true) };
}

function signTexture(text, color, size = 72) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- Végétation instanciée par biome ------------------------------------------
function vegetationGeometries(biome) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5b3a1e', roughness: 0.95 });
  const leaf = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true });
  switch (biome) {
    case 'desert': {
      const parts = [new THREE.CylinderGeometry(0.35, 0.4, 4.2, 10).translate(0, 2.1, 0)];
      parts.push(new THREE.CylinderGeometry(0.22, 0.22, 1.6, 8).translate(0.75, 2.6, 0));
      parts.push(new THREE.CylinderGeometry(0.22, 0.22, 0.6, 8).rotateZ(Math.PI / 2).translate(0.45, 1.9, 0));
      parts.push(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 8).translate(-0.7, 2.9, 0));
      parts.push(new THREE.CylinderGeometry(0.2, 0.2, 0.55, 8).rotateZ(Math.PI / 2).translate(-0.42, 2.4, 0));
      return { trunk: null, foliage: [mergeGeometries(parts), leaf('#4d7c3a')] };
    }
    case 'tropical':
    case 'mediterranean': {
      const trunk = new THREE.CylinderGeometry(0.18, 0.3, 8, 8).translate(0, 4, 0);
      const fronds = [];
      for (let i = 0; i < 8; i++) {
        const f = new THREE.ConeGeometry(0.5, 4.2, 4).scale(1, 1, 0.15).rotateZ(Math.PI / 2 + 0.35).translate(2.0, 7.7, 0).rotateY((i / 8) * Math.PI * 2);
        fronds.push(f);
      }
      return { trunk: [trunk, trunkMat], foliage: [mergeGeometries(fronds), leaf(biome === 'tropical' ? '#2f8f3a' : '#5c7f2e')] };
    }
    case 'savanna': {
      const trunk = new THREE.CylinderGeometry(0.2, 0.35, 4.5, 7).translate(0, 2.25, 0);
      const canopy = new THREE.CylinderGeometry(3.6, 2.6, 1.0, 9).translate(0, 4.9, 0);
      return { trunk: [trunk, trunkMat], foliage: [canopy, leaf('#6b7f2a')] };
    }
    case 'snow': {
      const trunk = new THREE.CylinderGeometry(0.2, 0.3, 2, 7).translate(0, 1, 0);
      const cones = mergeGeometries([
        new THREE.ConeGeometry(2.4, 3.5, 8).translate(0, 3, 0),
        new THREE.ConeGeometry(1.9, 3, 8).translate(0, 4.8, 0),
        new THREE.ConeGeometry(1.3, 2.6, 8).translate(0, 6.4, 0),
      ]);
      return { trunk: [trunk, trunkMat], foliage: [cones, leaf('#1f4d33')] };
    }
    default: {
      const trunk = new THREE.CylinderGeometry(0.22, 0.32, 3.2, 7).translate(0, 1.6, 0);
      const crown = mergeGeometries([
        new THREE.IcosahedronGeometry(2.2, 1).translate(0, 4.4, 0),
        new THREE.IcosahedronGeometry(1.6, 1).translate(1.1, 3.8, 0.5),
        new THREE.IcosahedronGeometry(1.5, 1).translate(-1, 4, -0.6),
      ]);
      return { trunk: [trunk, trunkMat], foliage: [crown, leaf('#3f7d2c')] };
    }
  }
}

export class World {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.trafficGroup = new THREE.Group(); // véhicules : matériaux partagés, libérés à part
    scene.add(this.trafficGroup);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTimer = 0;
    this.nightMaterials = [];
    this.traffic = [];
    this.code = null;

    // Ciel physique
    this.sky = new Sky();
    this.sky.scale.setScalar(10000);
    Object.assign(this.sky.material.uniforms, {});
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);
    this.skyScene = new THREE.Scene();
    this.skyForEnv = new Sky();
    this.skyForEnv.scale.setScalar(10000);
    this.skyForEnv.material = this.sky.material;
    this.skyScene.add(this.skyForEnv);

    // Lumières
    this.hemi = new THREE.HemisphereLight('#cfe8ff', '#5c4a32', 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e0', 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3();

    scene.fog = new THREE.Fog('#bcd3e6', 250, 1300);

    // Étoiles (visibles la nuit)
    const starGeo = new THREE.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      if (v.y < 0.05) v.y = -v.y + 0.05;
      pts.push(...v.multiplyScalar(4000).toArray());
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, transparent: true, fog: false }));
    scene.add(this.stars);

    // Marqueurs d'interaction & de mission
    this.markerGeo = new THREE.TorusGeometry(2.2, 0.12, 8, 40).rotateX(Math.PI / 2);
    this.missionMarker = this.makeBeacon('#facc15');
    this.missionMarker.visible = false;
    scene.add(this.missionMarker);
  }

  makeBeacon(color) {
    const g = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 60, 24, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    beam.position.y = 30;
    const ring = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ color }));
    ring.position.y = 0.15;
    g.add(beam, ring);
    g.userData.ring = ring;
    return g;
  }

  /** Construit le pays demandé (détruit le précédent). */
  build(code) {
    this.clear();
    this.code = code;
    const country = COUNTRY_BY_CODE.get(code);
    const layout = getLayout(code);
    this.layout = layout;
    this.biome = country.biome;
    this.heightAt = makeHeightFn(layout.seed, layout.biome);
    const tex = textures();
    const add = (o) => {
      this.root.add(o);
      return o;
    };

    // --- Terrain ---
    const size = 1800;
    const seg = 180;
    const tg = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    const pos = tg.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const [c1, c2] = GROUND[layout.biome].map((c) => new THREE.Color(c));
    const rock = new THREE.Color(layout.biome === 'desert' ? '#a0714a' : '#7c7468');
    const snowC = new THREE.Color('#f8fafc');
    const sand = new THREE.Color('#d9c38f');
    const rand = mulberry32(layout.seed ^ 0xabcdef);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      col.copy(c1).lerp(c2, rand());
      if (h > 25) col.lerp(rock, Math.min(1, (h - 25) / 30));
      if (h > 70 || (layout.biome === 'snow' && h > 20)) col.lerp(snowC, Math.min(1, (h - (layout.biome === 'snow' ? 20 : 70)) / 20));
      if (h < 0.5 && h > -0.01 && Math.max(Math.abs(x), Math.abs(z)) > 440) col.lerp(sand, 0.5);
      if (h < -0.01) col.copy(sand);
      colors.set([col.r, col.g, col.b], i * 3);
    }
    tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    tg.computeVertexNormals();
    const grain = tex.grain.clone();
    grain.needsUpdate = true;
    grain.repeat.set(140, 140);
    const terrain = add(new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, map: grain })));
    terrain.receiveShadow = true;

    // Eau
    const water = add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2),
        new THREE.MeshPhysicalMaterial({ color: '#1d6f9c', roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88, clearcoat: 1 }),
      ),
    );
    water.position.y = -1.6;

    // --- Routes ---
    const span = WORLD.roadStep * (WORLD.roadCount - 1) + WORLD.roadWidth + WORLD.sidewalk * 2;
    const roadMat = new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.85 });
    const walkMat = new THREE.MeshStandardMaterial({ map: tex.sidewalk, roughness: 0.9 });
    const strip = (cx, cz, w, len, alongX, mat, y, repeatDiv) => {
      const g = new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2);
      if (alongX) g.rotateY(Math.PI / 2);
      const m = mat.clone();
      m.map = mat.map.clone();
      m.map.needsUpdate = true;
      m.map.repeat.set(1, len / repeatDiv);
      const mesh = add(new THREE.Mesh(g, m));
      mesh.position.set(cx, y, cz);
      mesh.receiveShadow = true;
      return mesh;
    };
    for (const l of ROAD_LINES) {
      strip(l, 0, WORLD.roadWidth + WORLD.sidewalk * 2, span, false, walkMat, 0.03, 4);
      strip(0, l, WORLD.roadWidth + WORLD.sidewalk * 2, span, true, walkMat, 0.035, 4);
    }
    for (const l of ROAD_LINES) {
      strip(l, 0, WORLD.roadWidth, span, false, roadMat, 0.06, 14);
      strip(0, l, WORLD.roadWidth, span, true, roadMat, 0.065, 14);
    }
    strip(220, 0, WORLD.roadWidth, 80, true, roadMat, 0.06, 14);
    // Avenue du quartier résidentiel
    const avLen = RESIDENTIAL.toX - RESIDENTIAL.fromX;
    const avX = (RESIDENTIAL.toX + RESIDENTIAL.fromX) / 2;
    strip(avX, 0, WORLD.roadWidth + WORLD.sidewalk * 2, avLen, true, walkMat, 0.03, 4);
    strip(avX, 0, WORLD.roadWidth, avLen, true, roadMat, 0.06, 14);
    this.buildHouses(add, layout.biome);

    // --- Aéroport ---
    const concMat = new THREE.MeshStandardMaterial({ map: tex.concrete.clone(), roughness: 0.9 });
    concMat.map.repeat.set(14, 60);
    concMat.map.needsUpdate = true;
    const apron = add(new THREE.Mesh(new THREE.PlaneGeometry(130, 660).rotateX(-Math.PI / 2), concMat));
    apron.position.set(318, 0.04, 0);
    apron.receiveShadow = true;
    const rw = AIRPORT.runway;
    const rwMat = new THREE.MeshStandardMaterial({ map: tex.runway.clone(), roughness: 0.85 });
    rwMat.map.repeat.set(1, rw.d / 40);
    rwMat.map.needsUpdate = true;
    const runway = add(new THREE.Mesh(new THREE.PlaneGeometry(rw.w, rw.d).rotateX(-Math.PI / 2), rwMat));
    runway.position.set(rw.x, 0.07, rw.z);
    runway.receiveShadow = true;

    this.cinePlane = add(createPlane(PLACES.airport.color));
    this.cinePlane.position.set(AIRPORT.plane.x, 0, AIRPORT.plane.z);
    this.cinePlane.rotation.y = Math.PI; // face à -z
    this.cinePlaneHome = this.cinePlane.position.clone();
    const parked = [
      [303, 60, -Math.PI / 2, '#e11d48'],
      [303, -55, -Math.PI / 2, '#16a34a'],
    ];
    for (const [x, z, ry, c] of parked) {
      const p = add(createPlane(c));
      p.position.set(x, 0, z);
      p.rotation.y = ry;
    }

    // --- Bâtiments ---
    const nightMats = [];
    for (const b of layout.buildings) {
      const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
      let mesh;
      if (b.kind === 'building') {
        const { map, emissive } = facadeTextures(b.seed, b.h > 26 ? 'glass' : 'plain');
        const floors = Math.max(1, Math.round(b.h / 3.4));
        const sideMat = (w) => {
          const m = new THREE.MeshStandardMaterial({ color: b.color, map: map.clone(), emissiveMap: emissive.clone(), emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.8 });
          m.map.repeat.set(Math.max(1, Math.round(w / 6)), floors / 4);
          m.emissiveMap.repeat.copy(m.map.repeat);
          m.map.needsUpdate = m.emissiveMap.needsUpdate = true;
          nightMats.push(m);
          return m;
        };
        const roof = new THREE.MeshStandardMaterial({ color: layout.biome === 'snow' ? '#f1f5f9' : '#57534e', roughness: 0.95 });
        const sx = sideMat(b.d);
        const sz = sideMat(b.w);
        mesh = new THREE.Mesh(geo, [sx, sx, roof, roof, sz, sz]);
        // Petits équipements de toit
        if (b.h > 12) {
          const ac = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.6), new THREE.MeshStandardMaterial({ color: '#9ca3af', roughness: 0.5, metalness: 0.6 }));
          ac.position.set(b.w * 0.2, b.h / 2 + 0.6, -b.d * 0.15);
          ac.castShadow = true;
          mesh.add(ac);
        }
      } else if (b.kind === 'terminal') {
        mesh = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: '#2f6f9f', roughness: 0.08, metalness: 0.7, clearcoat: 1 }));
        const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w + 8, 1, b.d + 6), new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.4, metalness: 0.5 }));
        roof.position.y = b.h / 2 + 0.5;
        roof.castShadow = true;
        mesh.add(roof);
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 30, 16), new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.5 }));
        tower.position.set(8, 15 - b.h / 2, -b.d / 2 - 10);
        const cab = new THREE.Mesh(new THREE.CylinderGeometry(4, 3.2, 4, 16), new THREE.MeshPhysicalMaterial({ color: '#0ea5e9', roughness: 0.05, metalness: 0.5 }));
        cab.position.y = 17;
        tower.add(cab);
        tower.castShadow = true;
        mesh.add(tower);
        this.addSign(mesh, PLACES.airport, b, -1);
      } else if (b.kind === 'hangar') {
        mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.5, metalness: 0.6 }));
      } else {
        // Bâtiments spéciaux (emplois, boutique, concession)
        const place = PLACES[b.place];
        const wall = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.6 });
        const glassMat = new THREE.MeshPhysicalMaterial({ color: '#1e3a5f', roughness: 0.05, metalness: 0.4, clearcoat: 1 });
        mesh = new THREE.Mesh(geo, wall);
        const front = Math.sign(place.door.x - b.x);
        const vitrine = new THREE.Mesh(new THREE.BoxGeometry(0.3, b.h * 0.55, b.d * 0.8), glassMat);
        vitrine.position.set((front * b.w) / 2, -b.h * 0.12, 0);
        const band = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.4, 1.2, b.d + 0.4), new THREE.MeshStandardMaterial({ color: place.color, roughness: 0.4 }));
        band.position.y = b.h / 2 - 0.6;
        mesh.add(vitrine, band);
        this.addSign(mesh, place, b, front);
      }
      mesh.position.set(b.x, b.h / 2, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      add(mesh);
    }
    this.nightMaterials = nightMats;

    // Marqueurs au sol devant chaque lieu interactif
    for (const p of Object.values(PLACES)) {
      const m = new THREE.Mesh(this.markerGeo, new THREE.MeshBasicMaterial({ color: p.color }));
      m.position.set(p.door.x, 0.12, p.door.z);
      add(m);
    }

    // Parcs : pelouse, fontaine, bancs
    const grassMat = new THREE.MeshStandardMaterial({ color: layout.biome === 'desert' ? '#a3a35a' : '#4d8a33', roughness: 1 });
    for (const p of layout.parks) {
      const g = add(new THREE.Mesh(new THREE.PlaneGeometry(p.size, p.size).rotateX(-Math.PI / 2), grassMat));
      g.position.set(p.x, 0.02, p.z);
      g.receiveShadow = true;
      const basin = add(new THREE.Mesh(new THREE.CylinderGeometry(4, 4.3, 0.8, 32), new THREE.MeshStandardMaterial({ color: '#d6d3d1', roughness: 0.7 })));
      basin.position.set(p.x, 0.4, p.z);
      basin.castShadow = true;
      const w = add(new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.1, 32), new THREE.MeshPhysicalMaterial({ color: '#38bdf8', roughness: 0.05, clearcoat: 1 })));
      w.position.set(p.x, 0.75, p.z);
      const jet = add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 2.6, 12), new THREE.MeshStandardMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.7 })));
      jet.position.set(p.x, 2, p.z);
    }

    // Lampadaires (instanciés)
    const lampPositions = [];
    for (const l of ROAD_LINES) {
      for (let v = -170; v <= 170; v += 30) {
        lampPositions.push([l + 7.5, v + 15], [v + 15, l - 7.5]);
      }
    }
    const poleGeo = mergeGeometries([new THREE.CylinderGeometry(0.1, 0.14, 6, 6).translate(0, 3, 0), new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(0, 6, 0.6)]);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: '#374151', roughness: 0.5, metalness: 0.7 }), lampPositions.length);
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff7d6', emissive: '#ffd58a', emissiveIntensity: 0 });
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6).translate(0, 5.85, 1.2), bulbMat, lampPositions.length);
    const dummy = new THREE.Object3D();
    lampPositions.forEach(([x, z], i) => {
      dummy.position.set(x, 0, z);
      dummy.rotation.y = Math.round(x / 7.5) % 2 ? Math.PI / 2 : 0;
      dummy.updateMatrix();
      poles.setMatrixAt(i, dummy.matrix);
      bulbs.setMatrixAt(i, dummy.matrix);
    });
    poles.castShadow = true;
    add(poles);
    add(bulbs);
    this.lampMat = bulbMat;

    // Végétation
    const veg = vegetationGeometries(layout.biome);
    const trees = layout.trees;
    const fol = new THREE.InstancedMesh(veg.foliage[0], veg.foliage[1], trees.length);
    const trunk = veg.trunk ? new THREE.InstancedMesh(veg.trunk[0], veg.trunk[1], trees.length) : null;
    const tint = new THREE.Color();
    trees.forEach((t, i) => {
      dummy.position.set(t.x, this.heightAt(t.x, t.z) - 0.1, t.z);
      dummy.rotation.set(0, t.r, 0);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      fol.setMatrixAt(i, dummy.matrix);
      fol.setColorAt(i, tint.setHSL(0, 0, 0.8 + ((i * 37) % 40) / 100));
      trunk?.setMatrixAt(i, dummy.matrix);
    });
    fol.castShadow = true;
    add(fol);
    if (trunk) {
      trunk.castShadow = true;
      add(trunk);
    }

    // Circulation (voitures PNJ)
    const r2 = mulberry32(layout.seed ^ 0x5151);
    const palette = ['#f8fafc', '#111827', '#9ca3af', '#dc2626', '#2563eb', '#16a34a', '#facc15', '#7c3aed', '#0f766e', '#78350f'];
    // Trafic réaliste : surtout des citadines, berlines, SUV, taxis et motos ; quelques bus et camions
    const common = VEHICLES.filter((v) => v.currency === 'cauris' && !['bus', 'truck', 'super'].includes(v.body));
    const models = [...common.map((v) => v.id), 'savane-taxi', 'savane-taxi', 'savane-zem', 'savane-zem', 'savane-bus', 'liberty-box'];
    for (let i = 0; i < 18; i++) {
      const car = createCar(models[Math.floor(r2() * models.length)], palette[Math.floor(r2() * palette.length)]);
      this.trafficGroup.add(car);
      const line = ROAD_LINES[Math.floor(r2() * ROAD_LINES.length)];
      const alongX = r2() < 0.5;
      const dir = r2() < 0.5 ? 1 : -1;
      this.traffic.push({ car, line, alongX, dir, t: -190 + r2() * 380, speed: 9 + r2() * 6 });
    }

    this.updateEnvironment(true);
  }

  /** Construit les 14 maisons du quartier (une fois par pays). */
  buildHouses(add, biome) {
    this.houses = new Map();
    const lawn = new THREE.MeshStandardMaterial({ color: biome === 'desert' ? '#b9a66a' : biome === 'snow' ? '#e2e8f0' : '#5e9a3c', roughness: 1 });
    const hedge = new THREE.MeshStandardMaterial({ color: '#2f6b2a', roughness: 0.95 });
    const paving = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.8 });
    const wood = new THREE.MeshStandardMaterial({ color: '#6b3f1f', roughness: 0.7 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#1e3a5f', roughness: 0.05, metalness: 0.4, clearcoat: 1 });
    const white = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.6 });
    const water = new THREE.MeshPhysicalMaterial({ color: '#22b8e6', roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.9 });
    const mesh = (geo, mat, x, y, z, group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    for (const lot of LOTS) {
      const t = HOUSE_TIERS[lot.tier];
      const g = new THREE.Group();
      const f = -lot.side; // direction de la façade (vers l'avenue)
      // Terrain : pelouse, haie (ouverte devant), allée
      mesh(new THREE.BoxGeometry(RESIDENTIAL.lotW - 1, 0.04, RESIDENTIAL.lotD), lawn, lot.x, 0.02, lot.z, g).castShadow = false;
      const back = lot.z + lot.side * (RESIDENTIAL.lotD / 2);
      mesh(new THREE.BoxGeometry(RESIDENTIAL.lotW - 1, 0.9, 0.5), hedge, lot.x, 0.45, back, g);
      for (const sx of [-1, 1]) {
        mesh(new THREE.BoxGeometry(0.5, 0.9, RESIDENTIAL.lotD), hedge, lot.x + sx * (RESIDENTIAL.lotW / 2 - 0.75), 0.45, lot.z, g);
        mesh(new THREE.BoxGeometry(9, 0.9, 0.5), hedge, lot.x + sx * 7.5, 0.45, lot.door.z + lot.side * 0.3, g);
      }
      const h = lot.house;
      const pathLen = Math.abs(h.z - f * (h.d / 2) - lot.door.z);
      mesh(new THREE.BoxGeometry(2.2, 0.05, pathLen), paving, lot.x, 0.05, (h.z - f * (h.d / 2) + lot.door.z) / 2, g).castShadow = false;

      // Maison
      const wallMat = new THREE.MeshStandardMaterial({ color: DEFAULT_HOUSE_COLORS.wall, roughness: 0.85 });
      const roofMat = new THREE.MeshStandardMaterial({ color: DEFAULT_HOUSE_COLORS.roof, roughness: 0.7 });
      const floorH = t.floors === 2 ? 3.2 : 3.4;
      const bodyH = floorH * t.floors;
      const frontZ = h.z + f * (h.d / 2);
      mesh(new THREE.BoxGeometry(h.w, bodyH, h.d), wallMat, h.x, bodyH / 2, h.z, g);
      if (lot.tier === 'luxe') {
        // Moderne : toit plat débordant, grandes baies vitrées
        mesh(new THREE.BoxGeometry(h.w + 1.6, 0.35, h.d + 1.6), roofMat, h.x, bodyH + 0.17, h.z, g);
        mesh(new THREE.BoxGeometry(h.w * 0.62, bodyH * 0.8, 0.12), glass, h.x + h.w * 0.12, bodyH * 0.45, frontZ + f * 0.06, g);
      } else {
        // Toit à deux pans (prisme)
        const roofH = t.floors === 2 ? 2.6 : 2.3;
        const shape = new THREE.Shape([new THREE.Vector2(-h.w / 2 - 0.5, 0), new THREE.Vector2(h.w / 2 + 0.5, 0), new THREE.Vector2(0, roofH)]);
        const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: h.d + 0.8, bevelEnabled: false }).translate(0, 0, -(h.d + 0.8) / 2);
        mesh(roofGeo, roofMat, h.x, bodyH, h.z, g);
        mesh(new THREE.BoxGeometry(0.7, 1.6, 0.7), roofMat, h.x + h.w * 0.25, bodyH + 1.4, h.z, g); // cheminée
        for (let fl = 0; fl < t.floors; fl++) {
          for (const wx of [-h.w * 0.3, h.w * 0.3]) {
            if (fl === 0 && Math.abs(wx) < 1) continue;
            mesh(new THREE.BoxGeometry(1.4, 1.3, 0.12), glass, h.x + wx, fl * floorH + 1.8, frontZ + f * 0.06, g);
            mesh(new THREE.BoxGeometry(1.6, 0.12, 0.25), white, h.x + wx, fl * floorH + 1.08, frontZ + f * 0.1, g);
          }
        }
        if (t.floors === 2) mesh(new THREE.BoxGeometry(h.w * 0.5, 0.15, 1.4), white, h.x, floorH, frontZ + f * 0.7, g); // balcon
      }
      // Fenêtres latérales
      for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.12, 1.3, 1.6), glass, h.x + sx * (h.w / 2 + 0.06), 1.8, h.z, g);
      // Porte
      mesh(new THREE.BoxGeometry(1.2, 2.2, 0.15), wood, h.x, 1.1, frontZ + f * 0.08, g);
      mesh(new THREE.BoxGeometry(2.4, 0.3, 1.2), white, h.x, 0.15, frontZ + f * 0.6, g).castShadow = false; // perron
      // Garage
      if (t.garage) {
        const gx = h.x - h.w / 2 - 2.6;
        mesh(new THREE.BoxGeometry(5, 3, h.d * 0.7), wallMat, gx, 1.5, h.z + f * (h.d * 0.15), g);
        mesh(new THREE.BoxGeometry(3.6, 2.4, 0.12), white, gx, 1.2, h.z + f * (h.d * 0.15 + h.d * 0.35 + 0.06), g);
        mesh(new THREE.BoxGeometry(5.4, 0.25, h.d * 0.7 + 0.4), roofMat, gx, 3.1, h.z + f * (h.d * 0.15), g);
      }
      // Piscine
      if (t.pool) {
        const pz = (frontZ + lot.door.z) / 2 + lot.side * 0.5;
        mesh(new THREE.BoxGeometry(8.4, 0.3, 4.4), white, lot.x + 5, 0.15, pz, g).castShadow = false;
        mesh(new THREE.BoxGeometry(7.6, 0.05, 3.6), water, lot.x + 5, 0.31, pz, g).castShadow = false;
      }
      // Boîte aux lettres + plaque / panneau « À vendre »
      const post = new THREE.Group();
      post.position.set(lot.x - 3.2, 0, lot.door.z + lot.side * 0.8);
      mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), wood, 0, 0.7, 0, post);
      const signMat = new THREE.MeshBasicMaterial();
      // Deux faces dos à dos : le texte se lit dans les deux sens (pas d'effet miroir)
      for (const back of [0, Math.PI]) {
        const sign = mesh(new THREE.PlaneGeometry(2.6, 0.9), signMat, 0, 1.8, 0, post);
        sign.rotation.y = back;
        sign.position.z = back ? -0.01 : 0.01;
      }
      g.add(post);
      add(g);
      this.houses.set(lot.id, { lot, wallMat, roofMat, signMat, owned: null });
    }
    this.updateHouses([]);
  }

  /** Applique l'état des ventes : couleurs et plaques des maisons. */
  updateHouses(list) {
    if (!this.houses) return;
    const byLot = new Map(list.map((h) => [h.lot, h]));
    for (const [id, hs] of this.houses) {
      const o = byLot.get(id) ?? null;
      const key = o ? `${o.family}|${o.wall}|${o.roof}` : 'libre';
      if (hs.key === key) continue;
      hs.key = key;
      hs.owned = o;
      hs.wallMat.color.set(o?.wall ?? DEFAULT_HOUSE_COLORS.wall);
      hs.roofMat.color.set(o?.roof ?? DEFAULT_HOUSE_COLORS.roof);
      hs.signMat.map?.dispose();
      hs.signMat.map = o
        ? signTexture(`Famille ${o.family}`.slice(0, 22), '#14532d', 40)
        : signTexture(`À VENDRE · ${formatMoney(HOUSE_TIERS[hs.lot.tier].price)}`, '#b91c1c', 36);
      hs.signMat.needsUpdate = true;
    }
  }

  addSign(mesh, place, b, front) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: signTexture(place.sign, place.color), side: THREE.DoubleSide }));
    sign.position.set((front * b.w) / 2 + front * 0.35, b.h / 2 - 2.2, 0);
    sign.rotation.y = (front * Math.PI) / 2;
    mesh.add(sign);
  }

  clear() {
    for (const c of [...this.trafficGroup.children]) {
      this.trafficGroup.remove(c);
      disposeCar(c);
    }
    for (const c of [...this.root.children]) {
      this.root.remove(c);
      c.traverse((o) => {
        if (o.isMesh || o.isInstancedMesh) {
          o.geometry?.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m?.map?.dispose();
            m?.emissiveMap?.dispose();
            m?.dispose();
          }
        }
      });
    }
    this.traffic = [];
    this.nightMaterials = [];
  }

  /** Heure du jour partagée entre tous les joueurs (dérivée de l'horloge). 0 = minuit. */
  static dayFraction() {
    if (World.hourOverride != null) return World.hourOverride / 24;
    return ((Date.now() / 1000) % DAY_SECONDS) / DAY_SECONDS;
  }

  static clockString() {
    const f = World.dayFraction() * 24;
    const h = Math.floor(f);
    const m = Math.floor((f - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  updateEnvironment(force = false) {
    const f = World.dayFraction();
    const phi = f * Math.PI * 2 - Math.PI / 2; // lever à 6h, coucher à 18h
    this.sunDir.set(Math.cos(phi) * 0.75, Math.sin(phi), 0.45).normalize();
    const elev = this.sunDir.y;
    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.2);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    // La nuit, on éclaire avec une « lune » froide opposée au soleil
    this.sun.color.set(day > 0.05 ? '#fff1dc' : '#9fb7ff');
    this.sun.intensity = 0.25 + day * 2.9;
    this.hemi.intensity = 0.25 + day * 0.75;
    this.hemi.color.set(day > 0.3 ? '#cfe8ff' : '#6b7fb3');
    this.renderer.toneMappingExposure = 0.35 + day * 0.25;
    this.stars.material.opacity = 1 - day;
    const fogColor = new THREE.Color('#0b1324').lerp(new THREE.Color(elev < 0.25 ? '#f2b989' : '#bcd3e6'), day);
    this.scene.fog.color.copy(fogColor);
    const night = 1 - day;
    for (const m of this.nightMaterials) m.emissiveIntensity = night * 1.4;
    if (this.lampMat) this.lampMat.emissiveIntensity = night * 3;
    this.night = night > 0.5;
    setLights(this.night);

    this.envTimer -= 1;
    if (force || this.envTimer <= 0) {
      this.envTimer = 600; // ~toutes les 10 s à 60 i/s
      this.scene.environment?.dispose();
      this.scene.environment = this.pmrem.fromScene(this.skyScene, 0.02).texture;
      this.scene.environmentIntensity = 0.25 + day * 0.75;
    }
  }

  /** @param {THREE.Vector3} focus position autour de laquelle centrer les ombres */
  update(dt, focus, time) {
    this.updateEnvironment();
    const lightDir = this.sunDir.y > -0.05 ? this.sunDir : this.sunDir.clone().negate().setY(Math.abs(this.sunDir.y) + 0.3);
    this.sun.position.copy(focus).addScaledVector(lightDir, 200);
    this.sun.target.position.copy(focus);
    this.stars.position.copy(focus);

    for (const t of this.traffic) {
      t.t += t.speed * t.dir * dt;
      if (t.t > 190) t.t = -190;
      if (t.t < -190) t.t = 190;
      const lane = 2.5 * t.dir;
      if (t.alongX) t.car.position.set(t.t, 0, t.line + lane);
      else t.car.position.set(t.line - lane, 0, t.t);
      t.car.rotation.y = t.alongX ? (t.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : t.dir > 0 ? 0 : Math.PI;
      spinWheels(t.car, t.speed * dt);
    }

    if (this.missionMarker.visible) {
      this.missionMarker.userData.ring.scale.setScalar(1 + Math.sin(time * 4) * 0.1);
    }
  }

  setMissionTarget(target) {
    this.missionMarker.visible = !!target;
    if (target) this.missionMarker.position.set(target.x, 0, target.z);
  }
}
