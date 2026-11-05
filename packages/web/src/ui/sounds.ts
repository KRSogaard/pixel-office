/**
 * Sound effects, synthesized on the fly (no audio files): a rocket rumble, the
 * lab's fire alarm, Byte's meow, bug squashes, a courier's ding, an achievement
 * fanfare, and soft keyboard clicks from busy desks. Off until you turn on 🔊.
 */
export class Sfx {
  enabled = localStorage.getItem("po.sfx") === "1";
  private ctx: AudioContext | undefined;
  private lastClick = 0;

  set(on: boolean): void {
    this.enabled = on;
    localStorage.setItem("po.sfx", on ? "1" : "0");
    if (on) this.ding();
  }

  rocket(): void {
    this.noise(2.6, 120, 0.22, 0.05, 1.8);
  }

  alarm(): void {
    for (let i = 0; i < 6; i++) this.tone(i % 2 ? 660 : 880, i * 0.22, 0.2, "square", 0.05);
  }

  meow(): void {
    const a = this.audio();
    if (!a) return;
    const t = a.currentTime;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.12);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.45);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const filter = a.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    osc.connect(filter).connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + 0.55);
  }

  squash(): void {
    this.noise(0.08, 900, 0.12, 0.0, 0.08);
    this.tone(140, 0.02, 0.08, "triangle", 0.08);
  }

  ding(): void {
    this.tone(1318.5, 0, 0.4, "sine", 0.08);
    this.tone(1760, 0.08, 0.5, "sine", 0.06);
  }

  fanfare(): void {
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => this.tone(f, i * 0.11, i === 3 ? 0.6 : 0.16, "square", 0.04));
  }

  /** A soft key click; rate-limited so a busy office purrs instead of clatters. */
  click(): void {
    const now = performance.now();
    if (now - this.lastClick < 70) return;
    this.lastClick = now;
    this.noise(0.015, 3000 + Math.random() * 2000, 0.025, 0, 0.015);
  }

  private audio(): AudioContext | undefined {
    if (!this.enabled) return undefined;
    try {
      this.ctx ??= new AudioContext();
      return this.ctx;
    } catch {
      return undefined;
    }
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number): void {
    const a = this.audio();
    if (!a) return;
    const t = a.currentTime + at;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Filtered noise: rumbles (low cutoff) and clicks (high cutoff). */
  private noise(dur: number, cutoff: number, vol: number, attack: number, release: number): void {
    const a = this.audio();
    if (!a) return;
    const t = a.currentTime;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    const gain = a.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + Math.max(0.005, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
    src.connect(filter).connect(gain).connect(a.destination);
    src.start(t);
    src.stop(t + dur);
  }
}
