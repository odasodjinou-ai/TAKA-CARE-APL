// Physique de conduite arcade-réaliste (modèle « bicyclette ») :
// accélération selon le véhicule, freinage, marche arrière, boîte automatique,
// adhérence latérale (dérapage au frein à main), roulis/tangage de caisse,
// inclinaison des motos. Indépendant du rendu : testable seul.

const GEARS = [0, 0.16, 0.32, 0.5, 0.7, 0.88]; // seuils de vitesse relative par rapport (1 à 6)

export class Driving {
  /** @param {object} vehicle entrée du catalogue (shared/vehicles.js) @param {number} wheelbase */
  constructor(vehicle, wheelbase) {
    this.v = vehicle;
    this.wheelbase = wheelbase;
    this.reset(0);
  }

  reset(heading) {
    this.heading = heading;
    this.vf = 0; // vitesse longitudinale (m/s)
    this.vl = 0; // vitesse latérale (m/s)
    this.steer = 0; // angle de braquage (rad)
    this.yawRate = 0;
    this.longAcc = 0;
    this.gear = 1;
    this.rpm = 900;
    this.roll = 0;
    this.pitch = 0;
    this.lean = 0;
  }

  /**
   * @param {number} dt
   * @param {{throttle:number, steer:number, handbrake:boolean}} input throttle ∈ [-1,1], steer ∈ [-1,1] (+1 = droite)
   * @returns {{dx:number, dz:number}} déplacement à appliquer
   */
  update(dt, input) {
    const max = this.v.speed;
    const moto = this.v.body === 'moto';
    const heavy = ['bus', 'truck'].includes(this.v.body);
    const prevVf = this.vf;

    // --- Longitudinal
    const t = input.throttle;
    if (t > 0) {
      if (this.vf < -0.3) this.vf += 12 * t * dt; // freine la marche arrière
      else this.vf += this.v.accel * t * Math.max(0.03, 1 - (this.vf / max) ** 3) * dt;
    } else if (t < 0) {
      if (this.vf > 0.3) this.vf += 11 * t * dt; // freinage
      else this.vf += this.v.accel * 0.5 * t * dt; // marche arrière
    }
    // Résistance au roulement + aérodynamique
    const drag = 0.15 + 0.0006 * this.vf * this.vf + (t === 0 ? 1.0 : 0);
    this.vf -= Math.sign(this.vf) * Math.min(Math.abs(this.vf), drag * dt);
    if (input.handbrake) this.vf -= Math.sign(this.vf) * Math.min(Math.abs(this.vf), 7 * dt);
    this.vf = Math.max(-max * 0.25, Math.min(max, this.vf));
    this.longAcc = (this.vf - prevVf) / Math.max(dt, 1e-4);

    // --- Direction (moins de braquage à haute vitesse)
    const speedRatio = Math.min(1, Math.abs(this.vf) / max);
    const maxSteer = (heavy ? 0.5 : 0.6) * (1 - 0.65 * speedRatio);
    const target = -input.steer * maxSteer; // braquage à droite = cap décroissant
    this.steer += (target - this.steer) * Math.min(1, dt * 7);
    this.yawRate = (this.vf * Math.tan(this.steer)) / this.wheelbase;
    // Limite d'adhérence : accélération latérale max (≈ 0,9 g voiture, moins pour un bus)
    const latMax = heavy ? 4.5 : moto ? 9 : 8;
    const yawMax = latMax / Math.max(Math.abs(this.vf), 1);
    this.yawRate = Math.max(-yawMax, Math.min(yawMax, this.yawRate));
    if (input.handbrake && Math.abs(this.vf) > 6 && !moto) this.yawRate *= 1.6; // amorce de dérive
    this.heading += this.yawRate * dt;

    // --- Latéral : la force centrifuge crée du glissement, l'adhérence le résorbe
    const grip = moto ? 30 : input.handbrake ? 1.6 : heavy ? 9 : 11;
    this.vl += this.yawRate * this.vf * 0.06 * dt * (input.handbrake ? 6 : 1);
    this.vl *= Math.exp(-grip * dt);

    // --- Boîte automatique & régime moteur
    const r = Math.abs(this.vf) / max;
    let gear = 1;
    for (let i = 1; i < GEARS.length; i++) if (r >= GEARS[i]) gear = i + 1;
    this.gear = this.vf < -0.3 ? -1 : Math.min(gear, 6);
    const lo = GEARS[Math.max(0, this.gear - 1)] ?? 0;
    const hi = GEARS[this.gear] ?? 1.05;
    const inGear = this.gear > 0 ? (r - lo) / Math.max(0.05, hi - lo) : r * 4;
    const targetRpm = 900 + Math.min(1, Math.max(0, inGear)) * 5600 + (t > 0 ? 400 : 0);
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 6);

    // --- Mouvements de caisse
    this.roll += (Math.max(-0.07, Math.min(0.07, this.yawRate * this.vf * 0.004)) - this.roll) * Math.min(1, dt * 5);
    this.pitch += (Math.max(-0.05, Math.min(0.05, -this.longAcc * 0.006)) - this.pitch) * Math.min(1, dt * 5);
    this.lean += (Math.max(-0.6, Math.min(0.6, -this.yawRate * this.vf * 0.05)) - this.lean) * Math.min(1, dt * 6);

    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    // avant = (sin h, cos h), droite = (-cos h, sin h)
    return { dx: (s * this.vf - c * this.vl) * dt, dz: (c * this.vf + s * this.vl) * dt };
  }

  /** Après un choc contre un obstacle. */
  impact(strength) {
    if (strength > 0.05) {
      this.vf *= strength > 0.4 ? -0.25 : 0.5;
      this.vl *= 0.3;
    }
  }

  get kmh() {
    // Vitesse affichée à l'échelle du catalogue (la carte est réduite d'un facteur 1,6)
    return Math.round(Math.abs(this.vf) * 3.6 * 1.6);
  }
}
