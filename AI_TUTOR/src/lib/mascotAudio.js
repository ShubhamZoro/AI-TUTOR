
let el = null;
let lastObjectUrl = null;

// Publish to Mascot (so it can hook the analyser)
export function publishMascotAudio(a) {
  try {
    window.__mascotAudioEl = a || null;
    window.dispatchEvent(new Event("mascot-audio-el-change"));
  } catch {}
}

// Get the one-and-only <audio> for the whole app
export function getMascotAudio() {
  if (el) return el;
  el = new Audio();
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  el.muted = false;
  el.volume = 1.0;
  publishMascotAudio(el);
  return el;
}

// Safely replace the audio src with a new Blob and start playing
export async function playBlobThroughMascot(blob) {
  if (!blob) return false;
  const a = getMascotAudio();

  // Stop current playback (don’t revoke here yet)
  try { a.pause(); } catch {}
  try { a.currentTime = 0; } catch {}

  // Revoke the previous ObjectURL (if any)
  if (lastObjectUrl) {
    try { URL.revokeObjectURL(lastObjectUrl); } catch {}
    lastObjectUrl = null;
  }

  // Set fresh URL
  const url = URL.createObjectURL(blob);
  lastObjectUrl = url;
  a.removeAttribute("src"); // full reset to avoid stale readyState
  a.src = url;

  // Ensure Mascot has the element and the AudioContext can run
  publishMascotAudio(a);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Wait for it to be playable
  if (a.readyState < 2) {
    await new Promise((resolve) => {
      const h = () => { a.removeEventListener("canplay", h); a.removeEventListener("loadeddata", h); resolve(); };
      a.addEventListener("canplay", h, { once: true });
      a.addEventListener("loadeddata", h, { once: true });
    });
  }

  // Resume context (Mascot’s AudioContext listens for play, but resume here too for safety)
  try {
    const ctx = a._mascotShared?.ctx;
    if (ctx && ctx.state === "suspended") {
      await ctx.resume();
    }
  } catch {}

  // Play
  try {
    await a.play();
    return true;
  } catch {
    return false;
  }
}

// Optional: stop (without revoking URL; we keep it until the next play replaces it)
export function stopMascotAudio() {
  const a = getMascotAudio();
  try { a.pause(); } catch {}
  try { a.currentTime = 0; } catch {}
}

// Optional: call when the app is *really* done (not on page switches)
export function disposeMascotAudio() {
  stopMascotAudio();
  if (lastObjectUrl) {
    try { URL.revokeObjectURL(lastObjectUrl); } catch {}
    lastObjectUrl = null;
  }
}
