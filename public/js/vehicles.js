// Véhicules procéduraux : voitures (4 modèles) et avions de ligne.
import * as THREE from 'three';

const glass = new THREE.MeshPhysicalMaterial({ color: '#0f172a', roughness: 0.05, metalness: 0.3, transmission: 0, clearcoat: 1 });
const tire = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.9 });
const rim = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.3, metalness: 0.9 });
const headlight = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff7d6', emissiveIntensity: 1.2 });
const taillight = new THREE.MeshStandardMaterial({ color: '#7f1d1d', emissive: '#ef4444', emissiveIntensity: 0.9 });
const trim = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.6 });

const MODELS = {
  citadine: { L: 3.8, W: 1.75, bodyH: 0.62, bodyY: 0.55, cabL: 2.1, cabH: 0.62, cabZ: -0.2, wheelR: 0.33 },
  pickup: { L: 5.3, W: 2.0, bodyH: 0.8, bodyY: 0.75, cabL: 2.0, cabH: 0.78, cabZ: 0.75, wheelR: 0.42, bed: true },
  suv: { L: 4.7, W: 2.0, bodyH: 0.85, bodyY: 0.75, cabL: 3.2, cabH: 0.78, cabZ: -0.3, wheelR: 0.42 },
  sport: { L: 4.4, W: 1.95, bodyH: 0.48, bodyY: 0.45, cabL: 1.9, cabH: 0.44, cabZ: -0.35, wheelR: 0.34, spoiler: true },
};

const wheelGeo = new THREE.CylinderGeometry(1, 1, 0.3, 18);
wheelGeo.rotateZ(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.32, 10);
rimGeo.rotateZ(Math.PI / 2);

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Crée une voiture. L'avant est orienté vers +z. */
export function createCar(model = 'citadine', color = '#dc2626') {
  const spec = MODELS[model] ?? MODELS.citadine;
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.1 });

  const body = box(spec.W, spec.bodyH, spec.L, paint);
  body.position.y = spec.bodyY;
  g.add(body);

  const cab = box(spec.W * 0.88, spec.cabH, spec.cabL, paint);
  cab.position.set(0, spec.bodyY + spec.bodyH / 2 + spec.cabH / 2, spec.cabZ);
  g.add(cab);
  // Vitres (légèrement plus larges que la cabine pour éviter le z-fighting)
  const win = box(spec.W * 0.9, spec.cabH * 0.62, spec.cabL * 0.92, glass);
  win.position.copy(cab.position);
  win.position.y += spec.cabH * 0.08;
  g.add(win);

  if (spec.bed) {
    for (const x of [-1, 1]) {
      const wall = box(0.08, 0.35, spec.L * 0.42, paint);
      wall.position.set((x * spec.W) / 2 - x * 0.04, spec.bodyY + spec.bodyH / 2 + 0.17, -spec.L * 0.27);
      g.add(wall);
    }
  }
  if (spec.spoiler) {
    const sp = box(spec.W * 0.9, 0.06, 0.35, trim);
    sp.position.set(0, spec.bodyY + spec.bodyH / 2 + 0.3, -spec.L / 2 + 0.2);
    g.add(sp);
    for (const x of [-0.6, 0.6]) {
      const leg = box(0.06, 0.28, 0.1, trim);
      leg.position.set(x, spec.bodyY + spec.bodyH / 2 + 0.14, -spec.L / 2 + 0.2);
      g.add(leg);
    }
  }

  const bumperF = box(spec.W * 1.01, 0.18, 0.15, trim);
  bumperF.position.set(0, spec.bodyY - spec.bodyH / 2 + 0.12, spec.L / 2);
  const bumperB = bumperF.clone();
  bumperB.position.z = -spec.L / 2;
  g.add(bumperF, bumperB);

  for (const x of [-1, 1]) {
    const hl = box(0.35, 0.12, 0.05, headlight);
    hl.position.set(x * (spec.W / 2 - 0.3), spec.bodyY + spec.bodyH * 0.2, spec.L / 2 + 0.01);
    const tl = box(0.35, 0.12, 0.05, taillight);
    tl.position.set(x * (spec.W / 2 - 0.3), spec.bodyY + spec.bodyH * 0.2, -spec.L / 2 - 0.01);
    g.add(hl, tl);
  }

  const wheels = [];
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const w = new THREE.Group();
      const t = new THREE.Mesh(wheelGeo, tire);
      t.castShadow = true;
      const r = new THREE.Mesh(rimGeo, rim);
      w.add(t, r);
      w.scale.setScalar(spec.wheelR);
      w.scale.x = 1;
      w.position.set(x * (spec.W / 2 - 0.05), spec.wheelR, z * spec.L * 0.32);
      g.add(w);
      wheels.push(w);
    }
  }
  g.userData = { wheels, spec, paint, model };
  return g;
}

export function setCarColor(car, color) {
  car.userData.paint.color.set(color);
}

/** Fait tourner les roues selon la distance parcourue. */
export function spinWheels(car, distance) {
  const r = car.userData.spec.wheelR;
  for (const w of car.userData.wheels) w.rotation.x += distance / r;
}

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
  const windows = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 28, 28, 1, true, -Math.PI * 0.2, Math.PI * 0.08), glass);
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
    const wheel = new THREE.Mesh(wheelGeo, tire);
    wheel.scale.set(1, 0.6, 0.6);
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
