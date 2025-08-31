

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "../index.css";
import { getMascotAudio, publishMascotAudio } from "../lib/mascotAudio";

const API_BASE = "http://127.0.0.1:8000";

async function waitAF(ms = 0) {
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (ms) await new Promise(r => setTimeout(r, ms));
}
function once(target, type) {
  return new Promise(resolve => {
    const h = () => { target.removeEventListener(type, h); resolve(); };
    target.addEventListener(type, h, { once: true });
  });
}
async function waitUntilPlayable(el) {
  if (el.readyState >= 2) return;
  await Promise.race([once(el, "canplay"), once(el, "loadeddata")]);
}

export default function AskOncePage() {
  const [q, setQ] = useState("");
  const [pair, setPair] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // use the global singleton, not a per-page ref
  const audioEl = getMascotAudio();
  const currentUrlRef = useRef(null);

  // attach/detach page-specific handlers
  useEffect(() => {
    const onended = () => setSpeaking(false);
    const onerror = () => setSpeaking(false);
    audioEl.addEventListener("ended", onended);
    audioEl.addEventListener("error", onerror);
    // (re)publish in case this page mounted first
    publishMascotAudio(audioEl);
    return () => {
      audioEl.removeEventListener("ended", onended);
      audioEl.removeEventListener("error", onerror);
    };
  }, [audioEl]);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const composerRef = useRef(null);
  const listRef = useRef(null);
  const bottomRef = useRef(null);

  function stopAudio() {
    try { audioEl.pause(); } catch {}
    try { audioEl.currentTime = 0; } catch {}
    if (currentUrlRef.current) {
      try { URL.revokeObjectURL(currentUrlRef.current); } catch {}
      currentUrlRef.current = null;
    }
    setSpeaking(false);
  }

  async function playBlob(blob) {
    if (!blob) return;
    stopAudio();
    const url = URL.createObjectURL(blob);
    currentUrlRef.current = url;
    audioEl.src = url;

    // make sure Mascot has the element & had a render tick
    publishMascotAudio(audioEl);
    await waitAF();
    await waitUntilPlayable(audioEl);

    setSpeaking(true);
    try { await audioEl.play(); } catch { setSpeaking(false); }
  }

  async function callQuery(question) {
    const res = await fetch(`${API_BASE}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function callSTT(blob, filename = "recording.webm") {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("language_code", "en");
    const res = await fetch(`${API_BASE}/stt`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function callTTS(text) {
    const res = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch { body = { raw: await res.text() }; }
      console.error("TTS /tts failed:", res.status, body);
      throw new Error(body.detail || `TTS ${res.status}`);
    }
    return res.blob();
  }

  // ---------- Mic (STT) ----------
  async function startRecording() {
    try {
      if (!("MediaRecorder" in window)) {
        alert("MediaRecorder not supported in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      let mime = "audio/webm";
      if (!MediaRecorder.isTypeSupported(mime)) {
        mime = MediaRecorder.isTypeSupported("audio/ogg") ? "audio/ogg" : "audio/mp4";
      }

      const mr = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];

      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mr.mimeType });
          const ext = (mr.mimeType.split("/")[1] || "webm").split(";")[0];
          const { text } = await callSTT(blob, `recording.${ext}`);
          if (text) setQ(text);
        } catch (err) {
          alert(`STT failed: ${err}`);
        } finally {
          chunksRef.current = [];
        }
      };

      mediaRecorderRef.current = mr;
      mr.start();
      setListening(true);
    } catch {
      alert("Mic permission denied or unavailable.");
    }
  }

  function stopRecording() {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    setListening(false);
  }

  function toggleListening() {
    if (!listening) {
      stopAudio();
      startRecording();
    } else {
      stopRecording();
    }
  }

  async function ask() {
    const question = q.trim();
    if (!question || loading) return;

    setLoading(true);
    setPair({ user: question, bot: null, audioBlob: null });
    setQ("");

    try {
      const data = await callQuery(question);
      const answer = data.answer || "No answer.";

      let blob = null;
      try { blob = await callTTS(answer); } catch (e) { console.warn("TTS failed", e); }

      setPair({ user: question, bot: answer, audioBlob: blob });
      if (blob) playBlob(blob);
    } catch (e) {
      setPair({ user: question, bot: "⚠️ Error while querying.", audioBlob: null });
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" }), 0);
    }
  }

  function onReadClick() {
    if (!pair?.audioBlob) return;
    if (!audioEl.paused && !audioEl.ended) {
      stopAudio();
    } else {
      playBlob(pair.audioBlob);
    }
  }

  useEffect(() => {
    const setGap = () => {
      const h = composerRef.current?.offsetHeight || 140;
      document.documentElement.style.setProperty("--composer-gap", `${h + 24}px`);
    };
    setGap();
    const ro = new ResizeObserver(setGap);
    if (composerRef.current) ro.observe(composerRef.current);
    window.addEventListener("resize", setGap);
    return () => {
      window.removeEventListener("resize", setGap);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.stream) {
        mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
      }
      stopAudio();
      // do NOT null the global; the docked Mascot depends on it
    };
  }, []);

  useEffect(() => {
    window.__clearAskUI = () => { setQ(""); setPair(null); stopAudio(); };
    return () => { delete window.__clearAskUI; };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [pair]);

  return (
    <div className="page-with-sidebar">
      <div className="content">
        <div className="content-inner">
          <h1>Query Once — no conversation memory (use Chat for that)</h1>

          <ul className="messages" ref={listRef} style={{ listStyle: "none", padding: 0 }}>
            {pair && (
              <li className="message">
                <div className="bubble user">{pair.user}</div>
                <div className="bot-row">
                  <div className="bubble bot">
                    {pair.bot ? <ReactMarkdown>{pair.bot}</ReactMarkdown> : "Thinking…"}
                  </div>
                  {pair.bot && pair.audioBlob && (
                    <button
                      className={`tts-btn ${speaking ? "speaking" : ""}`}
                      onClick={onReadClick}
                      aria-label={speaking ? "Stop" : "Read this message"}
                      title={speaking ? "Stop" : "Read this message"}
                    >
                      {speaking ? "🔇 Stop" : "🔊 Read"}
                    </button>
                  )}
                </div>
              </li>
            )}
            <div ref={bottomRef} />
          </ul>

          <div className="composer" ref={composerRef}>
            <input
              className="chat-input"
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type your question…"
              onKeyDown={(e) => e.key === "Enter" && ask()}
              aria-label="Ask once input"
            />
            <button
              className={`voice-btn ${listening ? "listening" : ""}`}
              onClick={toggleListening}
              aria-label={listening ? "Stop dictation" : "Start dictation"}
              title={listening ? "Stop dictation" : "Start dictation"}
            >
              {listening ? "🛑" : "🎤"}
            </button>
            <button className="send-btn" onClick={ask} disabled={loading} aria-label="Ask">
              {loading ? "…" : "Ask"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
