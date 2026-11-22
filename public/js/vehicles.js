// Véhicules procéduraux détaillés : carrosserie profilée avec passages de roue,
// pavillon incliné (tumblehome), vitrage teinté, montants, optiques, plaques,
// rétroviseurs, jantes à rayons, motos… et avions de ligne.
// Les pièces fixes sont fusionnées par matériau pour limiter les appels de rendu.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VEHICLE_BY_ID, DEFAULT_VEHICLE } from '/shared/vehicles.js';

// --- Matériaux partagés -----------------------------------------------------------------
const M = {
  glass: new THREE.MeshPhysicalMaterial({ color: '#16202b', roughness: 0.04, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.03 }),
  tire: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92 }),
  rim: new THREE.MeshStandardMaterial({ color: '#c7ccd3', roughness: 0.22, metalness: 0.95 }),
  darkRim: new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.3, metalness: 0.9 }),
  disc: new THREE.MeshStandardMaterial({ color: '#5b5f66', roughness: 0.5, metalness: 0.8 }),
  plastic: new THREE.MeshStandardMaterial({ color: '#1b1d21', roughness: 0.7 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#e5e7eb', roughness: 0.08, metalness: 1 }),
  head: new THREE.MeshStandardMaterial({ color: '#f8fafc', emissive: '#fff4d6', emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.3 }),
  tail: new THREE.MeshStandardMaterial({ color: '#7f1d1d', emissive: '#ff1a1a', emissiveIntensity: 0.5, roughness: 0.2 }),
  plate: new THREE.MeshStandardMaterial({ color: '#f5f5f4', roughness: 0.5 }),
  seat: new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.8 }),
  cargo: new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.6 }),
};
export const VEHICLE_MATERIALS = M;

// --- Gabarits de carrosserie (mètres ; l'avant est vers +z) -----------------------------------
// L longueur, W largeur, g garde au sol, belt ligne de caisse, roof pavillon, nose haut du
// bouclier avant, ws/rf/rb/rw : pied de pare-brise, avant/arrière du toit, bas de lunette.
const BODIES = {
  hatch: { L: 3.95, W: 1.76, g: 0.17, belt: 0.95, roof: 1.48, nose: 0.62, ws: 0.75, rf: -0.05, rb: -1.5, rw: -1.86, wr: 0.31, wb: 2.5, trunk: false },
  sedan: { L: 4.75, W: 1.82, g: 0.16, belt: 0.98, roof: 1.45, nose: 0.65, ws: 0.95, rf: 0.1, rb: -1.0, rw: -1.65, wr: 0.33, wb: 2.8, trunk: true },
  wagon: { L: 4.8, W: 1.84, g: 0.17, belt: 1.0, roof: 1.5, nose: 0.66, ws: 0.95, rf: 0.1, rb: -2.05, rw: -2.25, wr: 0.33, wb: 2.85, trunk: false },
  suv: { L: 4.75, W: 1.95, g: 0.26, belt: 1.18, roof: 1.8, nose: 0.9, ws: 1.05, rf: 0.35, rb: -1.95, rw: -2.2, wr: 0.4, wb: 2.85, trunk: false, rails: true },
  pickup: { L: 5.35, W: 1.95, g: 0.28, belt: 1.15, roof: 1.85, nose: 0.95, ws: 1.15, rf: 0.55, rb: -0.55, rw: -0.62, wr: 0.41, wb: 3.2, bed: true },
  coupe: { L: 4.55, W: 1.9, g: 0.13, belt: 0.82, roof: 1.28, nose: 0.55, ws: 0.55, rf: -0.25, rb: -1.0, rw: -1.95, wr: 0.34, wb: 2.65, trunk: true, twoDoor: true },
  super: { L: 4.6, W: 2.02, g: 0.1, belt: 0.8, roof: 1.15, nose: 0.42, ws: 0.95, rf: 0.05, rb: -0.75, rw: -1.85, wr: 0.33, wb: 2.7, trunk: true, twoDoor: true, intakes: true },
  van: { L: 5.0, W: 1.95, g: 0.2, belt: 1.12, roof: 2.15, nose: 0.95, ws: 1.95, rf: 1.55, rb: -2.45, rw: -2.5, wr: 0.36, wb: 3.1, trunk: false, many: true },
  truck: { L: 7.2, W: 2.3, g: 0.4, belt: 1.45, roof: 2.75, nose: 1.3, ws: 3.45, rf: 3.1, rb: 1.6, rw: 1.55, wr: 0.5, wb: 4.4, box: true },
  bus: { L: 11, W: 2.5, g: 0.32, belt: 1.35, roof: 3.05, nose: 1.2, ws: 5.45, rf: 5.25, rb: -5.35, rw: -5.45, wr: 0.5, wb: 6.0, many: true, bus: true },
};
export function bodySpec(body) {
  return BODIES[body] ?? (body === 'moto' ? { L: 2.1, W: 0.8, wr: 0.31, wb: 1.42 } : BODIES.hatch);
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function prep(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
  g.deleteAttribute('uv1');
  return g;
}

/** Extrude un profil latéral (z,y) sur la largeur et le recentre ; l'axe d'extrusion devient x. */
function extrudeProfile(shape, width, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 14 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // x(forme) -> z(voiture), z(forme) -> x(voiture)
  return g;
}

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

/** Poutre entre deux points (montants de pare-brise, etc.). */
function beam(a, b, t) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.BoxGeometry(t, t, dir.length());
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), dir, new THREE.Vector3(0, 1, 0));
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  return g.applyMatrix4(m);
}

function textTexture(text, bg, fg, w = 256, h = 64, font = 'bold 40px system-ui') {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// --- Roues ---------------------------------------------------------------------------------
// Géométries unitaires (rayon 1, largeur 1 sur x), mises à l'échelle par véhicule.
const WHEEL = (() => {
  const prof = [
    [0.64, -0.5], [0.88, -0.5], [0.97, -0.43], [1, -0.3], [1, 0.3], [0.97, 0.43], [0.88, 0.5], [0.64, 0.5],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(prof, 28).rotateZ(Math.PI / 2);
  const parts = [new THREE.CylinderGeometry(0.66, 0.66, 0.86, 28, 1, false).rotateZ(Math.PI / 2)];
  for (const side of [-1, 1]) {
    parts.push(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12).rotateZ(Math.PI / 2).translate(side * 0.44, 0, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.push(new THREE.BoxGeometry(0.06, 0.5, 0.12).translate(0, 0.38, 0).rotateX(a).translate(side * 0.44, 0, 0));
    }
  }
  const rim = mergeGeometries(parts.map(prep));
  const disc = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 20).rotateZ(Math.PI / 2);
  return { tire, rim, disc };
})();

function makeWheel(r, width, rimMat = M.rim) {
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  const tire = new THREE.Mesh(WHEEL.tire, M.tire);
  const rim = new THREE.Mesh(WHEEL.rim, rimMat);
  const disc = new THREE.Mesh(WHEEL.disc, M.disc);
  spin.add(tire, rim);
  spin.scale.set(width, r, r);
  disc.scale.set(width * 0.6, r * 0.9, r * 0.9);
  tire.castShadow = true;
  steer.add(spin, disc);
  return { steer, spin };
}

// --- Construction d'une voiture ------------------------------------------------------------------
function buildCar(spec, v, paint) {
  const B = BODIES[v.body] ?? BODIES.hatch;
  const { L, W, g, belt, roof, nose, ws, rf, rb, rw, wr, wb } = B;
  const zf = wb / 2;
  const zr = -wb / 2;
  const BV = 0.07; // biseau : la surface finale dépasse le profil de BV dans toutes les directions
  const ra = wr + 0.05 + BV; // passage de roue dégagé autour du pneu
  const parts = new Map(); // matériau -> géométries
  const put = (mat, geo) => {
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat).push(prep(geo));
  };

  // 1) Caisse : profil latéral avec passages de roue
  const Lf = L / 2 - BV; // avant du profil
  const Lr = -L / 2 + BV; // arrière du profil
  const gb = g + BV; // bas du profil
  const bt = belt - BV; // haut de caisse du profil
  const s = new THREE.Shape();
  s.moveTo(Lf - 0.12, gb);
  s.lineTo(Lf, gb + 0.18);
  s.lineTo(Lf, nose);
  s.quadraticCurveTo(Lf - 0.05, bt - 0.05, Lf - 0.35, bt - 0.04);
  s.lineTo(ws, bt);
  if (B.trunk) {
    s.lineTo(rw, bt);
    s.lineTo(Lr + 0.25, bt + 0.02);
    s.quadraticCurveTo(Lr + 0.02, bt, Lr, bt - 0.2);
  } else {
    s.lineTo(Math.max(rw, Lr + 0.1), bt);
    s.lineTo(Lr, bt - 0.12);
  }
  s.lineTo(Lr, gb + 0.2);
  s.lineTo(Lr + 0.1, gb);
  const arch = (zc) => {
    const r = ra - BV;
    s.lineTo(zc - r, gb);
    s.lineTo(zc - r, wr);
    s.absarc(zc, wr, r, Math.PI, 0, true);
    s.lineTo(zc + r, gb);
  };
  arch(zr);
  arch(zf);
  s.closePath();
  const body = extrudeProfile(s, W, BV);
  // Arrondi des angles vus de dessus
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    pos.setX(i, pos.getX(i) * (1 - 0.07 * smooth(L / 2 - 0.8, L / 2, Math.abs(z))));
  }
  body.computeVertexNormals();
  put(paint, body);

  // 2) Habitacle vitré avec pavillon rentrant (tumblehome)
  const topScale = B.bus || B.box ? 0.97 : 0.84;
  const glassW = W * 0.95;
  if (B.box) {
    // Camion : cabine courte + caisse de chargement
    const gs = new THREE.Shape();
    gs.moveTo(ws - 0.02, belt - 0.02);
    gs.lineTo(rf, roof);
    gs.lineTo(rb, roof);
    gs.lineTo(rw, belt - 0.02);
    gs.closePath();
    put(M.glass, extrudeProfile(gs, glassW, 0.02));
    put(paint, box(W * 0.97, 0.08, rf - rb + 0.1, 0, roof + 0.02, (rf + rb) / 2));
    put(M.cargo, box(W + 0.05, 2.6, rb - (-L / 2) - 0.2, 0, belt + 1.25, (rb + -L / 2) / 2 - 0.05));
    put(paint, box(W + 0.07, 0.25, rb - (-L / 2) - 0.2, 0, belt + 0.55, (rb + -L / 2) / 2 - 0.05));
  } else {
    const gs = new THREE.Shape();
    gs.moveTo(ws - 0.02, belt - 0.02);
    gs.lineTo(rf, roof);
    gs.lineTo(rb, roof);
    gs.lineTo(rw + 0.02, belt - 0.02);
    gs.closePath();
    const glass = extrudeProfile(gs, glassW, 0.03);
    const gp = glass.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const t = smooth(belt, roof, gp.getY(i));
      gp.setX(i, gp.getX(i) * (1 + (topScale - 1) * t));
    }
    glass.computeVertexNormals();
    put(M.glass, glass);
    // Pavillon peint
    const roofW = glassW * topScale + 0.03;
    put(paint, box(roofW, 0.05, rf - rb, 0, roof + 0.01, (rf + rb) / 2));
    // Montants
    const xb = glassW / 2 + 0.01;
    const xt = roofW / 2;
    for (const sx of [-1, 1]) {
      put(paint, beam(new THREE.Vector3(sx * xb, belt, ws - 0.02), new THREE.Vector3(sx * xt, roof, rf), 0.07)); // A
      put(paint, beam(new THREE.Vector3(sx * xb, belt, rw + 0.02), new THREE.Vector3(sx * xt, roof, rb), B.many ? 0.07 : 0.12)); // C
      const pillars = B.bus ? 7 : B.many ? 2 : B.twoDoor || v.body === 'pickup' ? 0 : 1;
      for (let i = 1; i <= pillars; i++) {
        const z = rf + ((rb - rf) * i) / (pillars + 1) + (B.many ? 0 : 0.15);
        put(paint, beam(new THREE.Vector3(sx * xb, belt, z), new THREE.Vector3(sx * xt, roof, z - 0.05), 0.08)); // B…
      }
    }
  }

  // 3) Plateau de pick-up
  if (B.bed) {
    const bedL = -L / 2 + 0.12 - (rw - 0.08);
    put(M.plastic, box(W - 0.2, 0.02, -bedL, 0, belt + 0.005, (rw - 0.08 + (-L / 2 + 0.12)) / 2));
    for (const sx of [-1, 1]) put(paint, box(0.08, 0.12, -bedL, sx * (W / 2 - 0.08), belt + 0.06, (rw - 0.08 + (-L / 2 + 0.12)) / 2));
    put(M.chrome, box(W * 0.8, 0.05, 0.05, 0, roof - 0.1, rb - 0.15)); // arceau
  }

  // 4) Optiques, calandre, boucliers, plaques
  const hy = Math.min(belt - 0.12, nose + 0.08);
  for (const sx of [-1, 1]) {
    put(M.head, box(W * 0.22, 0.11, 0.1, sx * W * 0.32, hy, L / 2 - 0.03));
    put(M.chrome, box(W * 0.24, 0.13, 0.06, sx * W * 0.32, hy, L / 2 - 0.06)); // cerclage
    put(M.tail, box(W * 0.24, 0.11, 0.1, sx * W * 0.33, belt - 0.16, -L / 2 + 0.03));
    // Rétroviseurs
    {
      put(M.plastic, box(0.06, 0.06, 0.1, sx * (W / 2 + 0.06), belt + 0.08, ws - 0.15));
      put(paint, box(0.1, 0.11, 0.16, sx * (W / 2 + 0.13), belt + 0.12, ws - 0.17));
    }
    // Poignées de porte
    put(M.chrome, box(0.02, 0.03, 0.18, sx * (W / 2 + 0.005), belt - 0.1, ws - 0.55));
    if (!B.twoDoor && !B.box) put(M.chrome, box(0.02, 0.03, 0.18, sx * (W / 2 + 0.005), belt - 0.1, (rf + rb) / 2 - 0.25));
    // Bas de caisse
    put(M.plastic, box(0.05, 0.1, zf - zr - ra * 2 - 0.1, sx * (W / 2 - 0.02), g + 0.06, 0));
    if (B.intakes) put(M.plastic, box(0.04, 0.22, 0.5, sx * (W / 2 + 0.005), belt - 0.25, zr + ra + 0.35));
    if (B.rails) put(M.chrome, box(0.05, 0.05, rf - rb - 0.2, sx * (glassW * topScale) / 2 - sx * 0.08, roof + 0.07, (rf + rb) / 2));
  }
  if (!v.electric) {
    put(M.plastic, box(W * 0.4, 0.17, 0.06, 0, hy - 0.03, L / 2)); // calandre
    for (let i = -2; i <= 2; i++) put(M.chrome, box(W * 0.4, 0.012, 0.02, 0, hy - 0.03 + i * 0.03, L / 2 + 0.03));
  } else put(M.chrome, box(W * 0.5, 0.025, 0.04, 0, hy + 0.06, L / 2));
  put(M.plastic, box(W * 0.9, 0.14, 0.1, 0, g + 0.14, L / 2 - 0.01)); // bouclier avant
  put(M.plastic, box(W * 0.9, 0.14, 0.1, 0, g + 0.14, -L / 2 + 0.01)); // bouclier arrière
  put(M.plate, box(0.52, 0.12, 0.02, 0, Math.min(g + 0.32, hy - 0.2), L / 2 + 0.04));
  put(M.plate, box(0.52, 0.12, 0.02, 0, belt - 0.34, -L / 2 - 0.01));
  if (v.luxury) for (const sx of [-1, 1]) put(M.chrome, box(0.015, 0.025, ws - rw, sx * (W / 2 + 0.01), belt - 0.02, (ws + rw) / 2));
  if (!v.electric && !B.bus) put(M.chrome, new THREE.CylinderGeometry(0.04, 0.04, 0.16, 10).rotateX(Math.PI / 2).translate(W * 0.3, g + 0.1, -L / 2 - 0.04));
  if (v.body === 'super') {
    put(M.plastic, box(W * 0.86, 0.04, 0.32, 0, belt + 0.34, -L / 2 + 0.25)); // aileron
    for (const sx of [-0.6, 0.6]) put(M.plastic, box(0.05, 0.32, 0.14, sx, belt + 0.18, -L / 2 + 0.25));
  }

  // Fusion par matériau
  const bodyGroup = new THREE.Group();
  for (const [mat, geos] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    bodyGroup.add(mesh);
  }

  // Éléments à texture (non fusionnés)
  if (v.taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.28), [M.cargo, M.cargo, M.cargo, M.cargo, new THREE.MeshBasicMaterial({ map: textTexture('TAXI', '#facc15', '#111') }), new THREE.MeshBasicMaterial({ map: textTexture('TAXI', '#facc15', '#111') })]);
    sign.position.set(0, roof + 0.13, (rf + rb) / 2);
    bodyGroup.add(sign);
  }
  if (B.bus) {
    const dest = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.28), new THREE.MeshBasicMaterial({ map: textTexture('LIGNE 1 · CENTRE', '#111', '#fbbf24', 512, 64, 'bold 34px monospace') }));
    dest.position.set(0, roof - 0.25, rf + 0.12);
    dest.rotation.y = 0;
    bodyGroup.add(dest);
  }

  // Roues
  const wheels = [];
  const tw = B.bus || B.box ? 0.32 : v.body === 'super' ? 0.3 : 0.24;
  for (const z of [zf, zr]) {
    for (const sx of [-1, 1]) {
      const w = makeWheel(wr, tw, v.luxury || v.body === 'super' ? M.darkRim : M.rim);
      w.steer.position.set(sx * (W / 2 - tw / 2 - 0.02), wr, z);
      w.front = z > 0;
      wheels.push(w);
    }
  }
  return { bodyGroup, wheels, seat: { y: belt - 0.35, z: ws - 0.9 } };
}

// --- Moto --------------------------------------------------------------------------------------
function buildMoto(v, paint) {
  const parts = new Map();
  const put = (mat, geo) => {
    if (!parts.has(mat)) parts.set(mat, []);
    parts.get(mat).push(prep(geo));
  };
  const sport = v.kmh > 150;
  const wr = sport ? 0.31 : 0.28;
  const wb = sport ? 1.42 : 1.3;
  put(paint, new THREE.CapsuleGeometry(0.17, 0.3, 4, 12).rotateX(Math.PI / 2 - 0.15).translate(0, 0.86, 0.22)); // réservoir
  put(M.seat, box(0.26, 0.09, sport ? 0.5 : 0.75, 0, 0.84, -0.25));
  put(M.plastic, box(0.2, 0.32, 0.6, 0, 0.55, 0)); // moteur
  put(M.chrome, beam(new THREE.Vector3(0, wr, wb / 2), new THREE.Vector3(0, 1.0, wb / 2 - 0.25), 0.06)); // fourche
  put(M.plastic, beam(new THREE.Vector3(0, wr, -wb / 2), new THREE.Vector3(0, 0.72, -0.25), 0.07)); // bras oscillant
  put(M.plastic, box(0.7, 0.03, 0.03, 0, 1.03, wb / 2 - 0.3)); // guidon
  put(M.head, new THREE.CylinderGeometry(0.08, 0.09, 0.06, 14).rotateX(Math.PI / 2).translate(0, 0.92, wb / 2 - 0.12));
  put(M.tail, box(0.12, 0.05, 0.04, 0, 0.82, -0.68));
  put(M.chrome, new THREE.CylinderGeometry(0.045, 0.05, 0.55, 10).rotateX(Math.PI / 2 - 0.15).translate(0.16, 0.45, -0.45));
  if (sport) put(paint, new THREE.SphereGeometry(1, 16, 12).scale(0.2, 0.2, 0.32).translate(0, 0.92, wb / 2 - 0.2)); // carénage
  put(paint, box(0.22, 0.04, 0.4, 0, wr * 2 + 0.03, wb / 2)); // garde-boue
  put(paint, box(0.22, 0.04, 0.35, 0, wr * 2 + 0.05, -wb / 2 + 0.05));
  const bodyGroup = new THREE.Group();
  for (const [mat, geos] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = true;
    bodyGroup.add(mesh);
  }
  const wheels = [];
  for (const z of [wb / 2, -wb / 2]) {
    const w = makeWheel(wr, sport ? 0.18 : 0.12);
    w.steer.position.set(0, wr, z);
    w.front = z > 0;
    wheels.push(w);
  }
  return { bodyGroup, wheels, seat: { y: 0.88, z: -0.2 } };
}

/**
 * Crée un véhicule du catalogue. L'avant est orienté vers +z, roues au sol à y = 0.
 * userData : { vehicle, wheels, body, paint, seat, model }
 */
export function createCar(model = DEFAULT_VEHICLE, color = '#dc2626') {
  const v = VEHICLE_BY_ID.get(model) ?? VEHICLE_BY_ID.get(DEFAULT_VEHICLE);
  const paint = new THREE.MeshPhysicalMaterial({ color: v.taxi ? '#facc15' : v.body === 'bus' ? '#16a34a' : color, roughness: 0.28, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.06 });
  const built = v.body === 'moto' ? buildMoto(v, paint) : buildCar(null, v, paint);
  const g = new THREE.Group();
  const bodyPivot = new THREE.Group(); // roulis / tangage
  bodyPivot.add(built.bodyGroup);
  g.add(bodyPivot);
  for (const w of built.wheels) g.add(w.steer);
  g.userData = { vehicle: v, wheels: built.wheels, body: bodyPivot, paint, seat: built.seat, model: v.id, moto: v.body === 'moto' };
  return g;
}

export function setCarColor(car, color) {
  const v = car.userData.vehicle;
  if (!v.taxi && v.body !== 'bus') car.userData.paint.color.set(color);
}

/** Fait tourner les roues selon la distance parcourue ; braque les roues avant. */
export function spinWheels(car, distance, steer = 0) {
  for (const w of car.userData.wheels) {
    w.spin.rotation.x += distance / (w.spin.scale.y || 1);
    if (w.front) w.steer.rotation.y = steer;
  }
}

/** Phares : intensité (0 = éteints) */
export function setLights(on) {
  M.head.emissiveIntensity = on ? 3 : 0.6;
  M.tail.emissiveIntensity = on ? 1.5 : 0.5;
}

/** Libère les ressources propres à un véhicule (pas les matériaux partagés). */
export function disposeCar(car) {
  car.traverse((o) => {
    if (!o.isMesh) return;
    if (![WHEEL.tire, WHEEL.rim, WHEEL.disc].includes(o.geometry)) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) if (!Object.values(M).includes(m)) {
      m.map?.dispose();
      m.dispose();
    }
  });
}

// --- Avion de ligne --------------------------------------------------------------------------
/** Avion de ligne. L'avant est orienté vers +z, roues au sol à y=0. */
export function createPlane(livery = '#0ea5e9') {
  const g = new THREE.Group();
  const white = new THREE.MeshPhysicalMaterial({ color: '#f8fafc', roughness: 0.3, metalness: 0.2, clearcoat: 0.8 });
  const color = new THREE.MeshStandardMaterial({ color: livery, roughness: 0.4, metalness: 0.3 });
  const grey = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.4, metalness: 0.7 });
  const R = 2;
  const Y = 3.6;

  const fus = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 34, 28), white);
  fus.rotation.x = Math.PI / 2;
  fus.position.y = Y;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), white);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(1, 1.9, 1);
  nose.position.set(0, Y, 17);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(R, 9, 28), white);
  tail.rotation.x = -Math.PI / 2;
  tail.position.set(0, Y + 0.5, -21.5);
  tail.scale.set(1, 1, 0.6);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.02, R + 0.02, 34, 28, 1, true, Math.PI * 0.42, Math.PI * 0.16), color);
  stripe.rotation.x = Math.PI / 2;
  stripe.position.y = Y;
  const windows = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 28, 28, 1, true, -Math.PI * 0.2, Math.PI * 0.08), M.glass);
  windows.rotation.x = Math.PI / 2;
  windows.position.set(0, Y, 1);
  const windows2 = windows.clone();
  windows2.rotation.y = Math.PI;
  windows2.rotation.x = -Math.PI / 2;

  const wing = new THREE.Mesh(new THREE.BoxGeometry(36, 0.45, 6), white);
  wing.position.set(0, Y - 1, 1);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7, 5), color);
  fin.position.set(0, Y + 5, -21);
  fin.rotation.x = -0.35;
  const stab = new THREE.Mesh(new THREE.BoxGeometry(13, 0.3, 3), white);
  stab.position.set(0, Y + 1, -22);

  g.add(fus, nose, tail, stripe, windows, windows2, wing, fin, stab);
  for (const x of [-8, 8]) {
    const eng = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.9, 4.5, 20), grey);
    eng.rotation.x = Math.PI / 2;
    eng.position.set(x, Y - 2.2, 3);
    g.add(eng);
  }
  for (const [x, z] of [[0, 13], [-2.5, 0], [2.5, 0]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, Y - R + 0.4), grey);
    leg.position.set(x, (Y - R) / 2, z);
    const wheel = new THREE.Mesh(WHEEL.tire, M.tire);
    wheel.scale.set(0.5, 0.6, 0.6);
    wheel.position.set(x, 0.6, z);
    g.add(leg, wheel);
  }
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}
