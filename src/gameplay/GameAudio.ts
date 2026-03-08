type AudioCue = 'star' | 'boost' | 'ring' | 'smash' | 'place' | 'bridge' | 'victory'

export class GameAudio {
  private context: AudioContext | null = null

  unlock(): void {
    const AudioContextCtor = window.AudioContext

    if (!AudioContextCtor) {
      return
    }

    if (!this.context) {
      this.context = new AudioContextCtor()
    }

    if (this.context.state !== 'running') {
      void this.context.resume()
    }
  }

  dispose(): void {
    if (!this.context) {
      return
    }

    void this.context.close()
    this.context = null
  }

  play(cue: AudioCue): void {
    if (!this.context || this.context.state !== 'running') {
      return
    }

    const now = this.context.currentTime

    if (cue === 'star') {
      this.blip(now, 640, 0.08, 'triangle', 0.035)
      this.blip(now + 0.05, 860, 0.1, 'triangle', 0.03)
      return
    }

    if (cue === 'boost') {
      this.sweep(now, 320, 180, 0.22, 'sawtooth', 0.05)
      return
    }

    if (cue === 'ring') {
      this.blip(now, 560, 0.12, 'sine', 0.04)
      this.blip(now + 0.08, 880, 0.14, 'sine', 0.035)
      return
    }

    if (cue === 'smash') {
      this.noise(now, 0.1, 0.05)
      this.blip(now, 150, 0.07, 'square', 0.025)
      return
    }

    if (cue === 'place') {
      this.blip(now, 320, 0.05, 'square', 0.02)
      this.blip(now + 0.03, 260, 0.05, 'square', 0.016)
      return
    }

    if (cue === 'bridge') {
      this.blip(now, 420, 0.08, 'triangle', 0.03)
      this.blip(now + 0.07, 540, 0.1, 'triangle', 0.03)
      return
    }

    if (cue === 'victory') {
      this.blip(now, 523, 0.14, 'triangle', 0.045)
      this.blip(now + 0.12, 659, 0.16, 'triangle', 0.04)
      this.blip(now + 0.24, 784, 0.22, 'triangle', 0.04)
    }
  }

  private blip(
    startTime: number,
    frequency: number,
    duration: number,
    type: OscillatorType,
    gainAmount: number,
  ): void {
    if (!this.context) {
      return
    }

    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, startTime)
    gain.gain.setValueAtTime(0.0001, startTime)
    gain.gain.exponentialRampToValueAtTime(gainAmount, startTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
    oscillator.connect(gain).connect(this.context.destination)
    oscillator.start(startTime)
    oscillator.stop(startTime + duration + 0.02)
  }

  private sweep(
    startTime: number,
    fromFrequency: number,
    toFrequency: number,
    duration: number,
    type: OscillatorType,
    gainAmount: number,
  ): void {
    if (!this.context) {
      return
    }

    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(fromFrequency, startTime)
    oscillator.frequency.exponentialRampToValueAtTime(toFrequency, startTime + duration)
    gain.gain.setValueAtTime(0.0001, startTime)
    gain.gain.exponentialRampToValueAtTime(gainAmount, startTime + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
    oscillator.connect(gain).connect(this.context.destination)
    oscillator.start(startTime)
    oscillator.stop(startTime + duration + 0.03)
  }

  private noise(startTime: number, duration: number, gainAmount: number): void {
    if (!this.context) {
      return
    }

    const bufferSize = Math.max(1, Math.floor(this.context.sampleRate * duration))
    const buffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate)
    const data = buffer.getChannelData(0)

    for (let index = 0; index < bufferSize; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / bufferSize)
    }

    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    source.buffer = buffer
    gain.gain.setValueAtTime(gainAmount, startTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
    source.connect(gain).connect(this.context.destination)
    source.start(startTime)
    source.stop(startTime + duration)
  }
}
