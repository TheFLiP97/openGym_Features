// Rep sensor (docs/rep-sensor): a first-order low-pass filter, one sample at a time.
//
// Each new sample pulls the output a fraction alpha of the way towards it. alpha comes from
// the cut-off frequency fc and the real time since the last sample:
//   alpha = 1 − e^(−2π · fc · dt)
// so the filter behaves the same at 30, 60 or 100 Hz and with Safari's uneven timing. Movements
// slower than fc pass almost unchanged, faster wiggles are damped. The price is a delay of about
// 1 / (2π · fc): at 5 Hz roughly 30 ms.

export class LowPass {
  constructor(fc) {
    this.fc = fc    // cut-off frequency (Hz)
    this.t = null   // time of the previous sample (s), null before the first
    this.y = 0      // filtered value
  }

  // t in seconds. Returns the filtered value. The first sample is taken as it is.
  step(t, x) {
    if (this.t === null) this.y = x
    else this.y += (1 - Math.exp(-2 * Math.PI * this.fc * (t - this.t))) * (x - this.y)
    this.t = t
    return this.y
  }
}
