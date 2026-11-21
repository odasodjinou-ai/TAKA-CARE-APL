// Personnage humanoïde procédural, entièrement personnalisable (skins).
import * as THREE from 'three';

const std = (color, roughness = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

// Géométries partagées entre tous les personnages (économie de mémoire GPU)
const G = {
  leg: new THREE.CapsuleGeometry(0.095, 0.62, 4, 10),
  arm: new THREE.CapsuleGeometry(0.068, 0.5, 4, 10),
  torso: new THREE.CapsuleGeometry(0.2, 0.36, 6, 14),
  hips: new THREE.CapsuleGeometry(0.17, 0.12, 4, 12),
  hand: new THREE.SphereGeometry(0.07, 10, 8),
  head: new THREE.SphereGeometry(0.15, 20, 16),
  neck: new THREE.CylinderGeometry(0.06, 0.07, 0.12, 10),
  eye: new THREE.SphereGeometry(0.022, 8, 6),
  shoe: new THREE.BoxGeometry(0.13, 0.08, 0.26),
  hairCap: new THREE.SphereGeometry(0.162, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
};

function shadow(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  return mesh;
}

function limb(geo, material, x, y, len) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  const mesh = shadow(new THREE.Mesh(geo, material));
  mesh.position.y = -len / 2;
  pivot.add(mesh);
  return pivot;
}

export class Character {
  constructor(skin) {
    this.group = new THREE.Group();
    this.phase = 0;
    this.mats = {
      skin: std(skin.tone, 0.55),
      top: std(skin.topColor, 0.85),
      pants: std(skin.pants, 0.9),
      hair: std(skin.hairColor, 0.65),
      shoe: std('#18181b', 0.5),
      white: std('#f8fafc', 0.7),
      eye: std('#0b0b0b', 0.3),
    };
    const m = this.mats;
    const body = new THREE.Group();
    this.body = body;
    this.group.add(body);

    this.legL = limb(G.leg, m.pants, -0.11, 0.92, 0.8);
    this.legR = limb(G.leg, m.pants, 0.11, 0.92, 0.8);
    for (const leg of [this.legL, this.legR]) {
      const shoe = shadow(new THREE.Mesh(G.shoe, m.shoe));
      shoe.position.set(0, -0.86, 0.05);
      leg.add(shoe);
      body.add(leg);
    }
    const hips = shadow(new THREE.Mesh(G.hips, m.pants));
    hips.rotation.z = Math.PI / 2;
    hips.position.y = 0.95;
    hips.scale.set(1, 1.05, 0.8);
    body.add(hips);

    const torso = shadow(new THREE.Mesh(G.torso, m.top));
    torso.position.y = 1.28;
    torso.scale.set(1.18, 1, 0.78);
    body.add(torso);

    this.armL = limb(G.arm, m.top, -0.3, 1.5, 0.6);
    this.armR = limb(G.arm, m.top, 0.3, 1.5, 0.6);
    for (const arm of [this.armL, this.armR]) {
      const hand = shadow(new THREE.Mesh(G.hand, m.skin));
      hand.position.y = -0.64;
      arm.add(hand);
      arm.rotation.z = arm === this.armL ? -0.08 : 0.08;
      body.add(arm);
    }

    const neck = new THREE.Mesh(G.neck, m.skin);
    neck.position.y = 1.6;
    body.add(neck);

    this.head = new THREE.Group();
    this.head.position.y = 1.76;
    const head = shadow(new THREE.Mesh(G.head, m.skin));
    head.scale.set(0.95, 1.08, 1);
    this.head.add(head);
    for (const x of [-0.055, 0.055]) {
      const eye = new THREE.Mesh(G.eye, m.eye);
      eye.position.set(x, 0.02, 0.135);
      this.head.add(eye);
    }
    body.add(this.head);

    this.hairSlot = new THREE.Group();
    this.hatSlot = new THREE.Group();
    this.topSlot = new THREE.Group();
    this.head.add(this.hairSlot, this.hatSlot);
    body.add(this.topSlot);

    this.setSkin(skin);
  }

  setSkin(skin) {
    const m = this.mats;
    m.skin.color.set(skin.tone);
    m.top.color.set(skin.topColor);
    m.pants.color.set(skin.pants);
    m.hair.color.set(skin.hairColor);
    this.skin = { ...skin };
    this.rebuild(this.hairSlot, buildHair(skin.hair, m));
    this.rebuild(this.hatSlot, buildHat(skin.hat));
    this.rebuild(this.topSlot, buildTop(skin.top, m));
  }

  rebuild(slot, children) {
    for (const c of [...slot.children]) {
      slot.remove(c);
      c.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (!Object.values(this.mats).includes(o.material)) o.material.dispose();
        }
      });
    }
    for (const c of children) {
      c.traverse((o) => o.isMesh && (o.castShadow = true));
      slot.add(c);
    }
  }

  /** Pose assise (conduite d'une moto). */
  sit(on) {
    this.sitting = on;
    this.legL.rotation.set(on ? -1.35 : 0, 0, on ? 0.18 : 0);
    this.legR.rotation.set(on ? -1.35 : 0, 0, on ? -0.18 : 0);
    this.armL.rotation.set(on ? -1.0 : 0, 0, on ? 0.15 : -0.08);
    this.armR.rotation.set(on ? -1.0 : 0, 0, on ? -0.15 : 0.08);
    this.body.position.y = 0;
  }

  /**
   * @param {number} dt secondes
   * @param {number} speed vitesse horizontale (m/s)
   * @param {boolean} airborne en l'air ?
   */
  animate(dt, speed, airborne = false) {
    const moving = speed > 0.3;
    this.phase += dt * (moving ? 2.2 + speed * 0.9 : 1.5);
    const amp = airborne ? 0.5 : Math.min(0.75, speed * 0.11);
    const s = Math.sin(this.phase);
    this.legL.rotation.x = airborne ? -0.5 : s * amp;
    this.legR.rotation.x = airborne ? 0.3 : -s * amp;
    this.armL.rotation.x = -s * amp * 0.9;
    this.armR.rotation.x = s * amp * 0.9;
    // Respiration / rebond de marche
    this.body.position.y = moving && !airborne ? Math.abs(Math.cos(this.phase)) * 0.05 : Math.sin(this.phase) * 0.008;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.isMesh && !Object.values(G).includes(o.geometry)) o.geometry.dispose();
    });
    Object.values(this.mats).forEach((mat) => mat.dispose());
  }
}

function buildHair(style, m) {
  const out = [];
  const cap = () => {
    const c = new THREE.Mesh(G.hairCap.clone(), m.hair);
    c.position.y = 0.012;
    c.scale.set(1, 1.08, 1.04);
    return c;
  };
  switch (style) {
    case 'short':
      out.push(cap());
      break;
    case 'long': {
      out.push(cap());
      const back = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.28, 4, 10), m.hair);
      back.position.set(0, -0.14, -0.08);
      back.scale.set(1.15, 1, 0.6);
      out.push(back);
      break;
    }
    case 'afro': {
      const a = new THREE.Mesh(new THREE.IcosahedronGeometry(0.235, 2), m.hair);
      a.position.set(0, 0.07, -0.03);
      out.push(a);
      break;
    }
    case 'braids': {
      out.push(cap());
      for (let i = 0; i < 7; i++) {
        const ang = Math.PI * (0.65 + (i / 6) * 0.7);
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.018, 0.42, 6), m.hair);
        b.position.set(Math.cos(ang) * 0.13, -0.17, Math.sin(ang) * 0.13 - 0.02);
        out.push(b);
      }
      break;
    }
    case 'mohawk': {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.3), m.hair);
      h.position.set(0, 0.17, -0.02);
      out.push(h);
      break;
    }
    default:
      break; // rasé
  }
  return out;
}

function buildHat(style) {
  const out = [];
  switch (style) {
    case 'cap': {
      const mat = std('#ef4444', 0.7);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.168, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      top.position.y = 0.04;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.015, 0.16), mat);
      brim.position.set(0, 0.05, 0.19);
      out.push(top, brim);
      break;
    }
    case 'beanie': {
      const mat = std('#f97316', 0.95);
      const top = new THREE.Mesh(new THREE.SphereGeometry(0.172, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      top.position.y = 0.035;
      top.scale.y = 1.15;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.025, 8, 24), mat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.04;
      out.push(top, rim);
      break;
    }
    case 'cowboy': {
      const mat = std('#7c4a1e', 0.8);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 28), mat);
      brim.position.y = 0.09;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.18, 20), mat);
      crown.position.y = 0.18;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.162, 0.162, 0.035, 20), std('#1c1917'));
      band.position.y = 0.115;
      out.push(brim, crown, band);
      break;
    }
    case 'crown': {
      const gold = std('#facc15', 0.25, { metalness: 1 });
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 20, 1, true), gold);
      ring.position.y = 0.16;
      out.push(ring);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 6), gold);
        spike.position.set(Math.cos(a) * 0.15, 0.24, Math.sin(a) * 0.15);
        out.push(spike);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

function buildTop(style, m) {
  const out = [];
  switch (style) {
    case 'hoodie': {
      const hood = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.06, 8, 18, Math.PI * 1.3), m.top);
      hood.position.set(0, 1.6, -0.06);
      hood.rotation.set(Math.PI / 2 - 0.3, 0, Math.PI * 0.85);
      const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.03), m.top);
      pocket.position.set(0, 1.12, 0.165);
      out.push(hood, pocket);
      break;
    }
    case 'jacket':
    case 'suit': {
      const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.42, 0.02), m.white);
      shirt.position.set(0, 1.33, 0.163);
      out.push(shirt);
      if (style === 'suit') {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.32, 0.02), std('#991b1b', 0.6));
        tie.position.set(0, 1.32, 0.175);
        out.push(tie);
      }
      break;
    }
    case 'boubou': {
      const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.42, 1.05, 18, 1, true), m.top);
      robe.position.y = 1.0;
      robe.material = m.top;
      const trim = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 6, 20), std('#eab308', 0.3, { metalness: 0.8 }));
      trim.position.set(0, 1.5, 0.13);
      trim.rotation.x = -0.3;
      out.push(robe, trim);
      break;
    }
    default:
      break;
  }
  return out;
}
