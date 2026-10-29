// Rep sensor (docs/rep-sensor): integrates a measured vertical acceleration twice, one sample at
// a time, into velocity and position. Built to run live on the phone: each step costs a handful
// of additions, so the position is known the moment the acceleration sample arrives.
//
// Trapezoidal rule: between two samples the acceleration is taken as a straight line, so the
// velocity gained is the average of the two accelerations times the time between them, and the
// distance covered is the average of the two velocities times that time. The time between
// samples comes from the timestamps, not from a nominal rate, since Safari's samples arrive
// unevenly.
//
// Nothing here corrects drift yet: a constant error b in the acceleration grows into b·t in the
// velocity and b·t²/2 in the position. That is what the tests beside this file measure.

export class Integrator {
  constructor() {
    this.t = null   // time of the previous sample (s), null before the first
    this.a = 0      // acceleration of the previous sample (m/s²)
    this.v = 0      // velocity (m/s)
    this.p = 0      // position (m)
  }

  // t in seconds, a in m/s². Returns the velocity and position after this sample.
  step(t, a) {
    if (this.t !== null) {
      const dt = t - this.t
      const v = this.v + (this.a + a) / 2 * dt
      this.p += (this.v + v) / 2 * dt
      this.v = v
    }
    this.t = t
    this.a = a
    return { v: this.v, p: this.p }
  }
}
