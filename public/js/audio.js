// Son moteur synthétisé (Web Audio) : pas de fichier audio à télécharger.
// Thermique : deux oscillateurs en dents de scie filtrés, fréquence liée au régime.
// Électrique : sifflement sinusoïdal discret.

export class EngineSound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.running = false;
  }

  /** Doit être appelé suite à un geste utilisateur (politique des navigateurs). */
  ensure() {
    if (this.ctx) return this.ctx.state === 'suspended' ? this.ctx.resume() : null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3;
    this.filter.connect(this.master);
    this.osc1 = this.ctx.createOscillator();
    this.osc2 = this.ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2.type = 'square';
    this.g2 = this.ctx.createGain();
    this.g2.gain.value = 0.35;
    this.osc1.connect(this.filter);
    this.osc2.connect(this.g2).connect(this.filter);
    this.osc1.start();
    this.osc2.start();
    return null;
  }

  start(electric) {
    this.ensure();
    this.electric = electric;
    this.running = true;
    if (!this.ctx) return;
    this.osc1.type = electric ? 'sine' : 'sawtooth';
    this.osc2.type = electric ? 'sine' : 'square';
  }

  stop() {
    this.running = false;
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted && this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** @param {number} rpm @param {number} throttle 0..1 */
  update(rpm, throttle) {
    if (!this.ctx || !this.running || this.muted) return;
    const t = this.ctx.currentTime;
    if (this.electric) {
      const f = 200 + rpm * 0.25;
      this.osc1.frequency.setTargetAtTime(f, t, 0.05);
      this.osc2.frequency.setTargetAtTime(f * 1.5, t, 0.05);
      this.filter.frequency.setTargetAtTime(3000, t, 0.1);
      this.master.gain.setTargetAtTime(0.015 + throttle * 0.02, t, 0.1);
    } else {
      const f = (rpm / 60) * 2; // fréquence d'allumage d'un 4 cylindres
      this.osc1.frequency.setTargetAtTime(f, t, 0.04);
      this.osc2.frequency.setTargetAtTime(f / 2, t, 0.04);
      this.filter.frequency.setTargetAtTime(300 + rpm / 6 + throttle * 600, t, 0.05);
      this.master.gain.setTargetAtTime(0.05 + throttle * 0.06, t, 0.08);
    }
  }

  horn() {
    this.ensure();
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.setTargetAtTime(0, t + 0.35, 0.05);
    g.connect(this.ctx.destination);
    for (const f of [392, 494]) {
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.5);
    }
  }
}
