// src/lib/mascotAudio.js
let el = null;

export function publishMascotAudio(a) {
  try {
    window.__mascotAudioEl = a || null;
    window.dispatchEvent(new Event("mascot-audio-el-change"));
  } catch {}
}

export function getMascotAudio() {
  if (el) return el;
  el = new Audio();
  el.preload = "auto";
  el.crossOrigin = "anonymous"; // needed for MediaElementSource
  publishMascotAudio(el);
  return el;
}
