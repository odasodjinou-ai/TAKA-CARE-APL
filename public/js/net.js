// Client WebSocket minimal avec reconnexion automatique (backoff exponentiel).
export class Net {
  constructor() {
    this.handlers = new Map();
    this.ws = null;
    this.retry = 0;
    this.wantOpen = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) ?? []) fn(msg);
  }

  connect() {
    this.wantOpen = true;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.emit('open');
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      this.emit(msg.t, msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.emit('close');
      if (!this.wantOpen) return;
      const delay = Math.min(10000, 500 * 2 ** this.retry++);
      setTimeout(() => this.wantOpen && this.connect(), delay);
    };
  }

  close() {
    this.wantOpen = false;
    this.ws?.close();
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(t, data = {}) {
    if (this.open) this.ws.send(JSON.stringify({ t, ...data }));
  }
}
