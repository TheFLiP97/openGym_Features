// Rep sensor (docs/rep-sensor): the phone's own motion sensor, read through the browser.
//
// Safari (and the WebView inside the iPhone app) delivers `devicemotion` events, about 60 a
// second, each with accelerationIncludingGravity in m/s². On iOS the page has to ask first, and
// only from a tap: DeviceMotionEvent.requestPermission(). Android and desktop browsers have no
// such call and simply deliver (or, without a sensor, never do). Only works over HTTPS.
//
// The page never sees the sensor any other way, so this is the one place to swap in another
// source later (a native plugin, a Bluetooth sensor): same samples, same callback.

export const motionSupported = () => typeof window !== 'undefined' && 'DeviceMotionEvent' in window

// Call from a tap. Resolves true when the page may read the sensor.
export async function requestMotionPermission() {
  const D = typeof window !== 'undefined' ? window.DeviceMotionEvent : undefined
  if (!D) return false
  if (typeof D.requestPermission !== 'function') return true   // no permission step on this platform
  try {
    return (await D.requestPermission()) === 'granted'
  } catch (e) {
    return false   // called without a tap, or refused
  }
}

// Calls onSample(t, ax, ay, az) for every reading: t in seconds (monotonic, from the event's own
// timestamp), acceleration including gravity in m/s². Returns a function that stops listening.
export function startMotion(onSample) {
  const handler = e => {
    const g = e.accelerationIncludingGravity
    if (!g || g.x == null || g.y == null || g.z == null) return   // desktop: events without values
    onSample(e.timeStamp / 1000, g.x, g.y, g.z)
  }
  window.addEventListener('devicemotion', handler)
  return () => window.removeEventListener('devicemotion', handler)
}
