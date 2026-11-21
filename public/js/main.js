// Boucle principale : rendu, contrôles du joueur, conduite, joueurs distants,
// cinématique de vol et synchronisation réseau.
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { COUNTRIES, COUNTRY_BY_CODE } from '/shared/countries.js';
import { JOBS, formatMoney, formatVida } from '/shared/catalog.js';
import { PLACES, INTERACT_RADIUS, resolveCollisions } from '/shared/layout.js';
import { Net } from './net.js';
import { World } from './world.js';
import { Character } from './character.js';
import { createCar, setCarColor, spinWheels, disposeCar, bodySpec } from './vehicles.js';
import { Driving } from './driving.js';
import { EngineSound } from './audio.js';
import { VEHICLE_BY_ID } from '/shared/vehicles.js';
import { LOTS, HOUSE_TIERS } from '/shared/houses.js';
import { $, h, toast, openPanel, closePanel, refreshPanel, panelOpen, PANELS, drawMinimap, phoneFlow } from './ui.js';

const CREDS_KEY = 'terravida:creds';
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

// --- Rendu -------------------------------------------------------------------------
const container = $('#game');
const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.append(renderer.domElement);

const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.className = 'labels';
container.append(labels.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 6000);
const world = new World(renderer, scene);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
});

// --- État du jeu ---------------------------------------------------------------------
const net = new Net();
const game = {
  net,
  profile: null,
  country: null,
  room: null,
  mission: null,
  sid: null,
  remotes: new Map(),
  nearbyPlayers() {
    return [...this.remotes.values()].filter((r) => r.pos.distanceTo(me.pos) < 40).map((r) => ({ sid: r.sid, name: r.info.name, family: r.info.family }));
  },
  previewSkin(skin) {
    me.character?.setSkin(skin);
  },
  saveSkin(partial) {
    net.send('skin', { skin: { ...this.profile.skin, ...partial } });
  },
};

const me = {
  pos: new THREE.Vector3(),
  vy: 0,
  yaw: 0,
  onGround: true,
  speed: 0,
  inCar: false,
  carSpeed: 0,
  character: null,
  car: null,
  anim: 0,
  drive: null,
};
const engine = new EngineSound();
const cam = { yaw: Math.PI, pitch: 0.32, dist: 7, lastDrag: 0 };
let cinematic = null;

// --- Entrées -------------------------------------------------------------------------
const keys = new Set();
const joy = { x: 0, y: 0 };
const typing = () => ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);

addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (panelOpen()) onClosePanel();
    document.activeElement?.blur();
    return;
  }
  if (typing()) return;
  if (e.code === 'Enter' && game.room) {
    e.preventDefault();
    $('#chat-input').focus();
    return;
  }
  if (!game.room || cinematic) return;
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyV') toggleCar();
  if (e.code === 'KeyC') togglePanel('wardrobe', '👕 Garde-robe');
  if (e.code === 'KeyG') togglePanel('family', '👨‍👩‍👧 Famille');
  if (e.code === 'KeyH') togglePanel('help', '❔ Aide');
  if (e.code === 'KeyP') togglePanel('vida');
  if (e.code === 'KeyB' && me.inCar) engine.horn();
  if (e.code === 'KeyM') toast(engine.toggleMute() ? '🔇 Son coupé' : '🔊 Son activé');
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const canvas = renderer.domElement;
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
  document.activeElement?.blur();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  cam.yaw -= (e.clientX - drag.x) * 0.006;
  cam.pitch = THREE.MathUtils.clamp(cam.pitch + (e.clientY - drag.y) * 0.004, 0.05, 1.25);
  drag.x = e.clientX;
  drag.y = e.clientY;
  cam.lastDrag = performance.now();
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointercancel', () => (drag = null));
canvas.addEventListener('wheel', (e) => (cam.dist = THREE.MathUtils.clamp(cam.dist + e.deltaY * 0.01, 3, 22)), { passive: true });

// Joystick tactile
if (IS_TOUCH) {
  document.body.classList.add('touch-on');
  $('#touch').classList.remove('hidden');
  const pad = $('#joystick');
  const stick = $('#stick');
  const reset = () => {
    joy.x = joy.y = 0;
    stick.style.transform = '';
  };
  const move = (e) => {
    const r = pad.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    const max = r.width / 2;
    if (d > max) {
      dx *= max / d;
      dy *= max / d;
    }
    joy.x = dx / max;
    joy.y = -dy / max;
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  pad.addEventListener('pointerdown', (e) => (pad.setPointerCapture(e.pointerId), move(e)));
  pad.addEventListener('pointermove', (e) => e.buttons && move(e));
  pad.addEventListener('pointerup', reset);
  pad.addEventListener('pointercancel', reset);
  for (const b of document.querySelectorAll('#touch-buttons [data-key]')) {
    b.addEventListener('pointerdown', () => {
      keys.add(b.dataset.key);
      if (b.dataset.key === 'KeyE') interact();
    });
    b.addEventListener('pointerup', () => keys.delete(b.dataset.key));
    b.addEventListener('pointerleave', () => keys.delete(b.dataset.key));
  }
}

// --- Actions -----------------------------------------------------------------------
const PANEL_TITLES = {
  jobs: '💼 Agence pour l\'emploi',
  shop: '🛍️ Boutique de mode',
  cars: '🚗 Concessionnaire',
  airport: '✈️ Aéroport — Départs',
  wardrobe: '👕 Garde-robe',
  family: '👨‍👩‍👧 Famille',
  help: '❔ Aide',
  vida: '💎 Vida & Premium',
  account: '👤 Mon compte',
  house: '🏠 Maison',
  admin: '🛡️ Modération',
};

function togglePanel(id, title = PANEL_TITLES[id]) {
  if (panelOpen() === id) return onClosePanel();
  openPanel(id, title, () => PANELS[id](game));
}

function onClosePanel() {
  if (panelOpen() === 'wardrobe' && game.profile) me.character?.setSkin(game.profile.skin); // annule l'aperçu
  closePanel();
}
$('#panel-close').addEventListener('click', onClosePanel);
$('#panel').addEventListener('click', (e) => e.target.id === 'panel' && onClosePanel());

function nearestPlace() {
  let best = null;
  for (const p of Object.values(PLACES)) {
    const d = Math.hypot(me.pos.x - p.door.x, me.pos.z - p.door.z);
    if (d <= INTERACT_RADIUS && (!best || d < best.d)) best = { p, d };
  }
  // Portails des maisons du quartier résidentiel
  for (const lot of LOTS) {
    const d = Math.hypot(me.pos.x - lot.door.x, me.pos.z - lot.door.z);
    if (d <= 3.5 && (!best || d < best.d)) {
      const owner = game.houses?.get(lot.id);
      best = { d, p: { id: 'house', lot: lot.id, label: owner ? `Maison de la famille ${owner.family}` : `${HOUSE_TIERS[lot.tier].name} n°${lot.id} — à vendre` } };
    }
  }
  return best?.p ?? null;
}

function interact() {
  const p = nearestPlace();
  if (!p) return;
  if (p.id === 'house') {
    game.houseLot = p.lot;
    return togglePanel('house', `🏠 ${p.label}`);
  }
  togglePanel(p.id);
}

/** Place un personnage sur la selle (moto) ou le rend au monde. */
function mount(character, car) {
  if (car?.userData.moto) {
    car.userData.body.add(character.group);
    character.group.position.set(0, car.userData.seat.y - 0.92, car.userData.seat.z);
    character.group.rotation.set(0, 0, 0);
    character.sit(true);
    character.group.visible = true;
  } else {
    character.sit(false);
    character.group.visible = !car;
  }
}

function unmount(character, parent) {
  if (character.group.parent !== parent) parent.add(character.group);
  character.sit(false);
  character.group.visible = true;
}

function makeMyCar() {
  const s = game.profile.skin;
  if (me.car) {
    unmount(me.character, scene);
    scene.remove(me.car);
    disposeCar(me.car);
  }
  me.car = createCar(s.car, s.carColor);
  me.car.visible = me.inCar;
  me.drive = new Driving(me.car.userData.vehicle, bodySpec(me.car.userData.vehicle.body).wb);
  // Phares : un vrai projecteur pour son propre véhicule (allumé la nuit)
  const beam = new THREE.SpotLight('#fff4d6', 0, 70, 0.55, 0.5, 1.2);
  beam.position.set(0, 0.9, bodySpec(me.car.userData.vehicle.body).L / 2);
  beam.target.position.set(0, 0, 25);
  me.car.add(beam, beam.target);
  me.car.userData.beam = beam;
  scene.add(me.car);
  if (me.inCar) mount(me.character, me.car);
}

/** Collision d'un véhicule allongé : plusieurs cercles répartis sur sa longueur. */
function collideVehicle(pos, heading, L, W) {
  const r = W / 2 + 0.1;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const n = Math.max(1, Math.round((L - W) / (W * 0.9)));
  let push = { x: 0, z: 0 };
  for (let i = 0; i <= n; i++) {
    const off = -L / 2 + W / 2 + ((L - W) * i) / n;
    const c = { x: pos.x + push.x + fx * off, z: pos.z + push.z + fz * off };
    const moved = resolveCollisions({ ...c }, r, world.layout.colliders);
    push = { x: push.x + moved.x - c.x, z: push.z + moved.z - c.z };
  }
  return push;
}

function toggleCar() {
  if (!game.profile || cinematic) return;
  if (me.inCar) {
    me.inCar = false;
    me.car.visible = false;
    unmount(me.character, scene);
    engine.stop();
    // On sort par la portière gauche
    const left = new THREE.Vector3(Math.cos(me.yaw), 0, -Math.sin(me.yaw)).multiplyScalar(-2.2);
    const p = resolveCollisions({ x: me.pos.x + left.x, z: me.pos.z + left.z }, 0.45, world.layout.colliders);
    me.pos.set(p.x, 0, p.z);
    me.carSpeed = 0;
    net.send('car', { on: false });
  } else {
    const v = VEHICLE_BY_ID.get(game.profile.skin.car);
    if (v?.premiumOnly && !game.profile.premium?.active) return toast(`${v.name} est réservé aux membres ⭐ Premium.`, 'warn');
    if (!me.car || me.car.userData.model !== game.profile.skin.car) makeMyCar();
    const spec = bodySpec(v.body);
    const push = collideVehicle(me.pos, me.yaw, spec.L, spec.W);
    me.pos.set(me.pos.x + push.x, 0, me.pos.z + push.z);
    me.inCar = true;
    me.drive.reset(me.yaw);
    me.car.visible = true;
    mount(me.character, me.car);
    engine.start(v.electric);
    net.send('car', { on: true });
  }
}

for (const b of document.querySelectorAll('#toolbar [data-panel]')) b.addEventListener('click', () => togglePanel(b.dataset.panel));
$('#toolbar [data-action="car"]').addEventListener('click', toggleCar);
$('#hud-top-left').addEventListener('click', () => togglePanel('account'));
$('#toolbar [data-action="servers"]').addEventListener('click', () => {
  net.send('rooms');
  showScreen('servers');
});

// --- Joueurs distants ----------------------------------------------------------------
const lerpAngle = (a, b, t) => a + (((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * t;

class Remote {
  constructor(info) {
    this.sid = info.sid;
    this.group = new THREE.Group();
    this.character = new Character(info.skin);
    this.group.add(this.character.group);
    this.tagEl = h('div', { class: 'nametag' });
    this.tag = new CSS2DObject(this.tagEl);
    this.tag.position.y = 2.25;
    this.group.add(this.tag);
    this.pos = new THREE.Vector3(info.x, info.y, info.z);
    this.ry = info.ry;
    this.buffer = [];
    this.car = null;
    this.vel = 0;
    scene.add(this.group);
    this.setInfo(info);
    this.push([info.sid, info.x, info.y, info.z, info.ry, info.a, info.v]);
  }

  setInfo(info) {
    this.info = info;
    this.character.setSkin(info.skin);
    const job = info.job ? JOBS[info.job]?.icon ?? '' : '';
    const lines = [h('div', {}, info.premium ? h('span', { class: 'premium' }, '⭐ ') : null, h('b', {}, info.name), job ? h('span', { class: 'job' }, ` ${job}`) : null)];
    if (info.family) lines.push(h('div', { class: 'fam' }, `« ${info.family} »`));
    this.tagEl.replaceChildren(...lines);
    if (this.car) this.setCar(this.veh, true);
  }

  setCar(model, force = false) {
    if (model === this.veh && !force) return;
    this.veh = model;
    if (this.car) {
      unmount(this.character, this.group);
      this.group.remove(this.car);
      disposeCar(this.car);
      this.car = null;
    }
    if (model) {
      this.car = createCar(model, this.info.skin.carColor);
      this.group.add(this.car);
      mount(this.character, this.car);
    }
    this.tag.position.y = model ? (model === 'savane-bus' ? 3.6 : 2.6) : 2.25;
  }

  push(s) {
    this.buffer.push({ t: performance.now(), x: s[1], y: s[2], z: s[3], ry: s[4], a: s[5], v: s[6] });
    if (this.buffer.length > 20) this.buffer.shift();
  }

  update(dt) {
    const renderT = performance.now() - 130; // interpolation avec 130 ms de retard
    const b = this.buffer;
    let a = b[0];
    let c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) {
      if (b[i].t <= renderT && b[i + 1].t >= renderT) {
        a = b[i];
        c = b[i + 1];
        break;
      }
    }
    const t = c.t === a.t ? 1 : THREE.MathUtils.clamp((renderT - a.t) / (c.t - a.t), 0, 1);
    const prev = this.pos.clone();
    this.pos.set(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, a.z + (c.z - a.z) * t);
    this.ry = lerpAngle(a.ry, c.ry, t);
    const speed = dt > 0 ? prev.distanceTo(this.pos) / dt : 0;
    this.vel += (speed - this.vel) * Math.min(1, dt * 8);
    this.group.position.copy(this.pos);
    this.setCar(c.v ?? null);
    if (this.car) {
      this.car.rotation.y = this.ry;
      spinWheels(this.car, this.vel * dt);
      if (this.car.userData.moto) this.car.userData.body.rotation.z = THREE.MathUtils.clamp(lerpAngle(0, c.ry - a.ry, 1) * 4, -0.5, 0.5);
    } else {
      this.character.group.rotation.y = this.ry;
      this.character.animate(dt, this.vel, this.pos.y > 0.05);
    }
  }

  dispose() {
    scene.remove(this.group);
    this.tagEl.remove();
    if (this.car) disposeCar(this.car);
    this.character.dispose();
  }
}

function clearRemotes() {
  for (const r of game.remotes.values()) r.dispose();
  game.remotes.clear();
}

// --- Mise à jour par image ------------------------------------------------------------
const tmpV = new THREE.Vector3();
let sendTimer = 0;
let completeTimer = 0;
let hudTimer = 0;

const speedo = $('#speedo');
function updatePlayer(dt) {
  speedo.classList.toggle('hidden', !me.inCar);
  const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + joy.y;
  const side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + joy.x;
  const colliders = world.layout.colliders;
  const blocked = typing() || panelOpen();

  if (!me.inCar) {
    const f = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    const r = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    const move = blocked ? new THREE.Vector3() : f.multiplyScalar(fwd).add(r.multiplyScalar(side));
    const mag = Math.min(1, move.length());
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    me.speed = mag * (run ? 8 : 4.5);
    if (mag > 0.05) {
      move.normalize();
      me.pos.addScaledVector(move, me.speed * dt);
      me.yaw = lerpAngle(me.yaw, Math.atan2(move.x, move.z), Math.min(1, dt * 12));
    }
    if (keys.has('Space') && me.onGround && !blocked) {
      me.vy = 6.5;
      me.onGround = false;
    }
    me.vy -= 20 * dt;
    me.pos.y += me.vy * dt;
    if (me.pos.y <= 0) {
      me.pos.y = 0;
      me.vy = 0;
      me.onGround = true;
    }
    const p = resolveCollisions({ x: me.pos.x, z: me.pos.z }, 0.45, colliders);
    me.pos.x = p.x;
    me.pos.z = p.z;
    me.character.group.position.copy(me.pos);
    me.character.group.rotation.y = me.yaw;
    me.character.animate(dt, me.speed, !me.onGround);
    me.anim = me.speed > 5 ? 2 : me.speed > 0.3 ? 1 : 0;
  } else {
    const d = me.drive;
    const throttle = blocked ? 0 : THREE.MathUtils.clamp(fwd, -1, 1);
    const steer = blocked ? 0 : THREE.MathUtils.clamp(side, -1, 1);
    const { dx, dz } = d.update(dt, { throttle, steer, handbrake: keys.has('Space') && !blocked });
    me.yaw = d.heading;
    const before = { x: me.pos.x, z: me.pos.z };
    me.pos.x += dx;
    me.pos.z += dz;
    const spec = bodySpec(d.v.body);
    const push = collideVehicle(me.pos, me.yaw, spec.L, spec.W);
    const pushed = Math.hypot(push.x, push.z);
    if (pushed > 0.01) d.impact(Math.min(1, pushed / Math.max(0.01, Math.hypot(dx, dz))));
    me.pos.set(me.pos.x + push.x, 0, me.pos.z + push.z);
    me.speed = Math.hypot(me.pos.x - before.x, me.pos.z - before.z) / Math.max(dt, 1e-4);
    me.car.position.copy(me.pos);
    me.car.rotation.y = me.yaw;
    const body = me.car.userData.body;
    if (me.car.userData.moto) body.rotation.set(0, 0, d.lean);
    else body.rotation.set(d.pitch, 0, d.roll);
    spinWheels(me.car, d.vf * dt, d.steer);
    engine.update(d.rpm, Math.max(0, throttle));
    speedo.textContent = `${d.kmh} km/h · ${d.gear < 0 ? 'R' : d.kmh < 2 && throttle === 0 ? 'N' : d.gear}`;
    me.car.userData.beam.intensity = world.night ? 60 : 0;
    me.anim = 3;
    // La caméra se replace derrière la voiture si on ne la manipule pas
    if (performance.now() - cam.lastDrag > 1500) cam.yaw = lerpAngle(cam.yaw, me.yaw + Math.PI, Math.min(1, dt * 2.5));
  }

  // Envoi de l'état (10 Hz)
  sendTimer -= dt;
  if (sendTimer <= 0) {
    sendTimer = 0.1;
    net.send('state', { x: +me.pos.x.toFixed(2), y: +me.pos.y.toFixed(2), z: +me.pos.z.toFixed(2), ry: +me.yaw.toFixed(3), a: me.anim });
  }

  // Mission : validation automatique à l'arrivée
  completeTimer -= dt;
  if (game.mission && completeTimer <= 0 && Math.hypot(me.pos.x - game.mission.target.x, me.pos.z - game.mission.target.z) < 6) {
    completeTimer = 1.5;
    net.send('jobComplete', { id: game.mission.id });
  }

  // Invite d'interaction
  const place = nearestPlace();
  const prompt = $('#prompt');
  if (place && !panelOpen()) {
    prompt.replaceChildren(h('kbd', {}, 'E'), place.label);
    prompt.classList.remove('hidden');
  } else prompt.classList.add('hidden');
}

function updateCamera(dt) {
  const target = tmpV.copy(me.pos).add(new THREE.Vector3(0, me.inCar ? 1.6 : 1.5, 0));
  const dist = me.inCar ? Math.max(cam.dist, 9) : cam.dist;
  const want = new THREE.Vector3(
    target.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * dist,
    target.y + Math.sin(cam.pitch) * dist,
    target.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * dist,
  );
  want.y = Math.max(want.y, 0.6);
  camera.position.lerp(want, Math.min(1, dt * 10));
  camera.lookAt(target);
}

function updateCinematic(dt) {
  const c = cinematic;
  c.t += dt;
  const plane = world.cinePlane;
  const home = world.cinePlaneHome;
  const takeoff = 4.5;
  if (c.t < takeoff) {
    const travelled = 0.5 * 16 * c.t * c.t;
    const lift = Math.max(0, c.t - 2.4);
    plane.position.set(home.x, lift * lift * 4, home.z - travelled);
    plane.rotation.x = -Math.min(0.25, lift * 0.15);
    camera.position.set(home.x - 55, 10, home.z - 150);
    camera.lookAt(plane.position.x, plane.position.y + 3, plane.position.z);
  } else if (!c.cruise) {
    c.cruise = true;
    $('#flight-overlay').classList.add('cruise');
    $('#flight-status').textContent = 'En vol…';
  }
  const progress = Math.min(1, c.t / (c.ms / 1000));
  $('#flight-plane').style.left = `calc(${progress * 100}% - 20px)`;
}

function endCinematic() {
  if (!cinematic) return;
  cinematic = null;
  world.cinePlane.position.copy(world.cinePlaneHome);
  world.cinePlane.rotation.x = 0;
  $('#flight-overlay').classList.add('hidden');
  $('#flight-overlay').classList.remove('cruise');
  $('#hud').classList.remove('hidden');
}

function updateHud() {
  const p = game.profile;
  if (!p) return;
  $('#hud-name').textContent = `${p.name}${p.family ? ` · « ${p.family.name} »` : ''}`;
  $('#hud-money').textContent = formatMoney(p.money);
  $('#hud-vida').textContent = `💎 ${formatVida(p.vida ?? 0)}${p.premium?.active ? ' · ⭐ Premium' : ''}`;
  const c = COUNTRY_BY_CODE.get(game.country ?? p.country);
  $('#hud-country').textContent = c ? `${c.flag} ${c.name}${game.room ? ` · ${game.room.name}` : ''}` : '';
  $('#hud-clock').textContent = `🕒 ${World.clockString()}`;
  const banner = $('#mission-banner');
  if (game.mission) {
    const j = JOBS[game.mission.job];
    const d = Math.round(Math.hypot(me.pos.x - game.mission.target.x, me.pos.z - game.mission.target.z));
    banner.textContent = `${j.icon} ${j.name} — rends-toi au point jaune (${d} m) · ${formatMoney(game.mission.reward)}${j.needsCar && !me.inCar ? ' · 🚗 voiture requise' : ''}`;
    banner.classList.remove('hidden');
  } else banner.classList.add('hidden');
}

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);
  const time = clock.elapsedTime;
  if (world.code && me.character) {
    if (cinematic) updateCinematic(dt);
    else {
      updatePlayer(dt);
      updateCamera(dt);
    }
    for (const r of game.remotes.values()) r.update(dt);
    world.update(dt, cinematic ? world.cinePlane.position : me.pos, time);
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.25;
      updateHud();
      drawMinimap($('#minimap'), { pos: me.pos, yaw: me.yaw, remotes: [...game.remotes.values()].map((r) => r.pos), mission: game.mission?.target, houses: game.houses, myFamily: game.profile.family?.id });
    }
  } else {
    // Écran d'accueil : vue aérienne tournante si un monde est chargé
    camera.position.set(Math.cos(time * 0.05) * 260, 120, Math.sin(time * 0.05) * 260);
    camera.lookAt(0, 0, 0);
    if (world.code) world.update(dt, new THREE.Vector3(), time);
  }
  renderer.render(scene, camera);
  labels.render(scene, camera);
}

// --- Écrans ----------------------------------------------------------------------------
function showScreen(name) {
  $('#screen-login').classList.toggle('hidden', name !== 'login');
  $('#screen-servers').classList.toggle('hidden', name !== 'servers');
}

function renderRooms(rooms) {
  $('#server-list').replaceChildren(
    ...rooms.map((r) =>
      h(
        'li',
        {},
        h('div', {}, h('b', {}, r.name), h('div', { class: 'meta' }, `${r.count}/${r.max} joueurs${game.room?.id === r.id ? ' · tu y es' : ''}`)),
        h('button', { class: 'btn primary', disabled: r.count >= r.max && game.room?.id !== r.id, onclick: () => (game.room?.id === r.id ? showScreen(null) : net.send('join', { room: r.id })) }, game.room?.id === r.id ? 'Reprendre' : 'Rejoindre'),
      ),
    ),
  );
}

// Formulaire de création
const homeSel = $('#login-home');
const guess = (navigator.language.split('-')[1] ?? '').toUpperCase();
for (const c of COUNTRIES) homeSel.append(h('option', { value: c.code, selected: c.code === (COUNTRY_BY_CODE.has(guess) ? guess : 'FR') }, `${c.flag} ${c.name}`));
$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#login-status').textContent = 'Connexion…';
  const hello = () => net.send('hello', { name: $('#login-name').value.trim(), home: homeSel.value });
  if (net.open) hello();
  else {
    const off = net.on('open', () => (off(), hello()));
    net.connect();
  }
});
$('#btn-logout').addEventListener('click', () => {
  if (game.profile && !game.profile.phone && !confirm('Compte invité : sans numéro lié, tu ne pourras pas le récupérer. Changer quand même ?')) return;
  localStorage.removeItem(CREDS_KEY);
  location.reload();
});

// Connexion par téléphone : onglets et formulaire
game.guessCountry = COUNTRY_BY_CODE.has(guess) ? guess : 'BJ';
game.creds = () => loadCreds();
game.rerenderPhone = () => {
  if (panelOpen() === 'account') return refreshPanel();
  const box = $('#phone-box');
  if (!box.classList.contains('hidden')) box.replaceChildren(phoneFlow(game, 'login'));
};
for (const b of document.querySelectorAll('#login-tabs [data-tab]')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('#login-tabs [data-tab]')) x.classList.toggle('active', x === b);
    const phone = b.dataset.tab === 'phone';
    $('#phone-box').classList.toggle('hidden', !phone);
    $('#login-form').classList.toggle('hidden', phone);
    game.rerenderPhone();
  });
}
game.rerenderPhone();

// Chat
$('#chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  if (input.value.trim()) net.send('chat', { text: input.value, ch: $('#chat-channel').value });
  input.value = '';
  input.blur();
});
function chatLine(cls, ...parts) {
  const log = $('#chat-log');
  log.append(h('div', { class: cls }, ...parts));
  while (log.children.length > 80) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}

// --- Réseau ------------------------------------------------------------------------------
const loadCreds = () => {
  try {
    return JSON.parse(localStorage.getItem(CREDS_KEY));
  } catch {
    return null;
  }
};

net.on('open', () => {
  $('#connection').classList.add('hidden');
  const creds = loadCreds();
  if (creds?.id && creds?.token) net.send('hello', creds);
  else net.send('smsInfo');
});
net.on('smsInfo', (m) => {
  game.smsAvailable = m.available;
  if (!m.available) $('#login-tabs [data-tab="guest"]').click(); // pas de SMS : mode invité par défaut
  else game.rerenderPhone();
});
net.on('otpSent', (m) => {
  const f = game.phone;
  Object.assign(f, { step: 'code', busy: false, masked: m.phone, until: Date.now() + m.cooldownMs, dev: m.devCode ?? null });
  game.rerenderPhone();
});
net.on('otpNeedProfile', (m) => {
  Object.assign(game.phone, { step: 'profile', busy: false, ticket: m.ticket });
  game.rerenderPhone();
});
net.on('phoneLinked', () => {
  game.phone = null;
  if (panelOpen() === 'account') refreshPanel();
});
net.on('phoneRequired', (m) => {
  game.pay && (game.pay.window?.close(), (game.pay.window = null));
  toast(m.reason, 'warn');
  openPanel('account', PANEL_TITLES.account, () => PANELS.account(game));
});
net.on('loggedOut', () => {
  localStorage.removeItem(CREDS_KEY);
  net.close();
  location.reload();
});
net.on('close', () => {
  if (game.profile) $('#connection').classList.remove('hidden');
  game.profile = null; // sera renvoyé après reconnexion
});
net.on('authFailed', () => {
  localStorage.removeItem(CREDS_KEY);
  showScreen('login');
});
net.on('welcome', (m) => {
  if (m.token) {
    try {
      localStorage.setItem(CREDS_KEY, JSON.stringify({ id: m.id, token: m.token }));
    } catch {
      toast('Impossible de sauvegarder ta session dans ce navigateur.', 'warn');
    }
  }
  game.profile = m.profile;
  game.sid = m.sid;
  game.myKey = m.key;
  game.phone = null;
  if (m.sms !== undefined) game.smsAvailable = m.sms;
  $('#login-status').textContent = '';
  if (!me.character) {
    me.character = new Character(m.profile.skin);
    scene.add(me.character.group);
  }
  if (game.room) {
    net.send('join', { room: game.room.id }); // reconnexion transparente
  } else {
    $('#servers-hello').textContent = `Bonjour ${m.profile.name} ! Ton solde : ${formatMoney(m.profile.money)}.`;
    renderRooms(m.rooms);
    showScreen('servers');
    // Aperçu du pays du joueur en arrière-plan
    if (world.code !== m.profile.country) world.build(m.profile.country);
  }
});
net.on('rooms', (m) => renderRooms(m.rooms));
net.on('joined', (m) => {
  game.room = m.room;
  showScreen(null);
  $('#hud').classList.remove('hidden');
  chatLine('sys', `Tu as rejoint « ${m.room.name} ». Appuie sur H pour l'aide.`);
});
net.on('zone', (m) => {
  if (world.code !== m.country) world.build(m.country);
  game.country = m.country;
  clearRemotes();
  for (const p of m.players) game.remotes.set(p.sid, new Remote(p));
  me.pos.set(m.pos.x, 0, m.pos.z);
  me.inCar = false;
  me.carSpeed = 0;
  if (me.car) me.car.visible = false;
  unmount(me.character, scene);
  engine.stop();
  camera.position.set(me.pos.x, 8, me.pos.z + 10);
  game.mission = null;
  world.setMissionTarget(null);
  endCinematic();
  updateHud();
});
net.on('snap', (m) => {
  for (const s of m.s) game.remotes.get(s[0])?.push(s);
});
net.on('pjoin', (m) => {
  game.remotes.get(m.p.sid)?.dispose();
  game.remotes.set(m.p.sid, new Remote(m.p));
});
net.on('pinfo', (m) => game.remotes.get(m.p.sid)?.setInfo(m.p));
net.on('pleave', (m) => {
  game.remotes.get(m.sid)?.dispose();
  game.remotes.delete(m.sid);
});
net.on('correct', (m) => {
  me.pos.x = m.x;
  me.pos.z = m.z;
});
net.on('profile', (m) => {
  const old = game.profile;
  game.profile = m.profile;
  me.character?.setSkin(m.profile.skin);
  if (old && me.car && (old.skin.car !== m.profile.skin.car || old.skin.carColor !== m.profile.skin.carColor)) {
    if (old.skin.car !== m.profile.skin.car) {
      makeMyCar();
      me.drive.reset(me.yaw);
      if (me.inCar) engine.start(me.car.userData.vehicle.electric);
      me.car.position.copy(me.pos);
      me.car.rotation.y = me.yaw;
    } else setCarColor(me.car, m.profile.skin.carColor);
  }
  updateHud();
  if (panelOpen() && panelOpen() !== 'wardrobe') refreshPanel();
});
net.on('mission', (m) => {
  game.mission = m.mission;
  world.setMissionTarget(m.mission?.target ?? null);
  if (panelOpen() === 'jobs') refreshPanel();
  updateHud();
});
net.on('flight', (m) => {
  closePanel();
  clearRemotes();
  if (me.inCar) {
    me.inCar = false;
    me.car.visible = false;
    unmount(me.character, scene);
    engine.stop();
  }
  game.mission = null;
  world.setMissionTarget(null);
  const a = COUNTRY_BY_CODE.get(m.from);
  const b = COUNTRY_BY_CODE.get(m.to);
  $('#flight-route').textContent = `${a.flag} ${a.name}  →  ${b.flag} ${b.name}`;
  $('#flight-status').textContent = 'Décollage…';
  $('#flight-overlay').classList.remove('hidden');
  $('#hud').classList.add('hidden');
  cinematic = { t: 0, ms: m.ms, cruise: false };
});
// Joueurs bloqués (liste propre à cet appareil)
const BLOCK_KEY = 'terravida:blocked';
game.blocked = (() => {
  try {
    return new Map(JSON.parse(localStorage.getItem(BLOCK_KEY)) ?? []);
  } catch {
    return new Map();
  }
})();
game.saveBlocked = () => {
  try {
    localStorage.setItem(BLOCK_KEY, JSON.stringify([...game.blocked]));
  } catch {
    /* stockage indisponible : la liste reste valable pour cette session */
  }
};
net.on('chat', (m) => {
  if (m.sys) return chatLine('sys', m.text);
  if (game.blocked.has(m.key)) return;
  const c = COUNTRY_BY_CODE.get(m.country);
  const mine = m.key === game.myKey;
  const actions = mine
    ? []
    : [
        h('button', { class: 'chat-act', title: 'Signaler ce message', onclick: () => confirm(`Signaler le message de ${m.from} pour insulte ou harcèlement ?`) && net.send('report', { id: m.id }) }, '🚩'),
        h(
          'button',
          {
            class: 'chat-act',
            title: 'Bloquer ce joueur',
            onclick: () => {
              if (!confirm(`Bloquer ${m.from} ? Tu ne verras plus ses messages.`)) return;
              game.blocked.set(m.key, m.from);
              game.saveBlocked();
              toast(`🚫 ${m.from} est bloqué. Tu peux le débloquer dans Mon compte.`);
            },
          },
          '🚫',
        ),
      ];
  chatLine(
    `${m.ch === 'family' ? 'fam' : ''}${m.filtered ? ' filtered' : ''}`,
    m.ch === 'family' ? '[Famille] ' : c ? `${c.flag} ` : '',
    m.premium ? h('span', { class: 'premium' }, '⭐') : null,
    h('b', {}, m.from),
    ` : ${m.text}`,
    ...actions,
  );
});
net.on('familyInvite', (m) => {
  toast(`${m.from} t'invite dans la famille « ${m.name} »`, 'info', { label: 'Accepter', fn: () => net.send('familyAccept', { familyId: m.familyId }) });
});
// Paiements
const payState = () => (game.pay ??= { tab: 'buy', pack: 'vida-260', method: null, methods: null, receipts: null, pending: null });
let payPoll = null;
net.on('payInfo', (m) => {
  const pay = payState();
  pay.methods = m.methods;
  pay.method ??= m.methods.find((x) => x.enabled)?.id ?? null;
  if (panelOpen() === 'vida') refreshPanel();
});
net.on('payCreated', (m) => {
  const pay = payState();
  pay.pending = { order: m.order, redirectUrl: m.redirectUrl };
  if (pay.window && !pay.window.closed) pay.window.location.href = m.redirectUrl;
  else window.open(m.redirectUrl, '_blank', 'noopener');
  pay.window = null;
  clearInterval(payPoll);
  const started = Date.now();
  payPoll = setInterval(() => {
    if (pay.pending?.order.status !== 'pending' || Date.now() - started > 15 * 60_000) return clearInterval(payPoll);
    net.send('payCheck', { id: m.order.id });
  }, 6000);
  if (panelOpen() === 'vida') refreshPanel();
});
const onOrder = (m) => {
  const pay = payState();
  if (pay.pending?.order.id === m.order.id) pay.pending.order = m.order;
  if (pay.receipts) pay.receipts = pay.receipts.map((o) => (o.id === m.order.id ? m.order : o));
  if (panelOpen() === 'vida') refreshPanel();
};
net.on('payStatus', onOrder);
net.on('paid', onOrder);
net.on('receipts', (m) => {
  payState().receipts = m.orders;
  if (panelOpen() === 'vida') refreshPanel();
});
// Administration
const adminRefresh = () => panelOpen() === 'admin' && refreshPanel();
net.on('adminBadge', (m) => {
  game.adminOpenCount = m.openCount;
  const b = $('#btn-admin');
  b.classList.remove('hidden');
  b.firstChild.textContent = m.openCount ? `🛡️${m.openCount}` : '🛡️';
  if (game.admin && !game.admin.player) {
    game.admin.open = null; // la liste sera rechargée
    if (panelOpen() === 'admin' && game.admin.tab === 'open') net.send('adminReports', { status: 'open' });
  }
});
net.on('adminReports', (m) => {
  (game.admin ??= {})[m.status] = m.groups;
  game.adminOpenCount = m.openCount;
  adminRefresh();
});
net.on('adminPlayer', (m) => {
  game.admin.playerData = m;
  adminRefresh();
});
net.on('adminSearch', (m) => {
  game.admin.search = m.players;
  adminRefresh();
});
net.on('adminLog', (m) => {
  game.admin.log = m.entries;
  adminRefresh();
});
net.on('banned', (m) => {
  net.close();
  game.room = null;
  $('#hud').classList.add('hidden');
  closePanel();
  showScreen('login');
  $('#login-status').textContent = `⛔ Ce compte est banni ${m.until ? `jusqu'au ${new Date(m.until).toLocaleString('fr-FR')}` : 'définitivement'}. Motif : ${m.reason}`;
});
// Maisons
net.on('houses', (m) => {
  if (m.country !== game.country && m.country !== world.code) return;
  game.houses = new Map(m.houses.map((x) => [x.lot, x]));
  world.updateHouses(m.houses);
  if (panelOpen() === 'house' || panelOpen() === 'family') refreshPanel();
});
net.on('teleport', (m) => {
  if (me.inCar) toggleCar();
  me.pos.set(m.x, 0, m.z);
  me.yaw = m.ry;
  cam.yaw = m.ry + Math.PI;
  camera.position.set(m.x, 8, m.z + 10);
  closePanel();
  toast('🏠 Bienvenue à la maison !', 'success');
});
net.on('toast', (m) => toast(m.message, m.kind));
net.on('error', (m) => {
  toast(m.message, 'error');
  if (game.phone?.busy) {
    game.phone.busy = false;
    game.rerenderPhone();
  }
  if (game.pay?.window) {
    game.pay.window.close(); // l'onglet ouvert pour le paiement ne sert plus
    game.pay.window = null;
  }
  if ($('#login-status').textContent) $('#login-status').textContent = '';
});
net.on('kicked', (m) => {
  net.close();
  game.room = null;
  toast(m.reason, 'warn');
  $('#connection').classList.add('hidden');
  showScreen('login');
});

// Outils de test automatisé (uniquement avec ?debug dans l'URL)
if (new URLSearchParams(location.search).has('debug')) {
  window.__terra = { game, me, world, scene, camera, cam };
  const hour = new URLSearchParams(location.search).get('hour');
  if (hour) World.hourOverride = Number(hour);
}

// --- Démarrage ---------------------------------------------------------------------------
world.build(COUNTRY_BY_CODE.has(guess) ? guess : 'FR');
showScreen(loadCreds() ? null : 'login');
net.connect();
frame();
