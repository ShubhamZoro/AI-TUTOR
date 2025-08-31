


import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import "../index.css";
import {
  getMascotAudio,
  playBlobThroughMascot,
  stopMascotAudio,
} from "../lib/mascotAudio";

const API_BASE = "http://127.0.0.1:8000";

export default function AskOncePage() {
  const [q, setQ] = useState("");
  const [pair, setPair] = useState(null); // { user, bot, audioBlob }
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Touch the global <audio> early so Mascot binds immediately.
  const audioEl = getMascotAudio();

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  const composerRef = useRef(null);
  const listRef = useRef(null);
  const bottomRef = useRef(null);

  // Auto-reset "speaking" when audio finishes so button goes back to Read
  useEffect(() => {
    const onEnded = () => setSpeaking(false);
    audioEl.addEventListener("ended", onEnded);
    return () => audioEl.removeEventListener("ended", onEnded);
  }, [audioEl]);

  // ---------- API helpers ----------
  async function callQuery(question) {
    const res = await fetch(`${API_BASE}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { answer }
  }

  async function callSTT(blob, filename = "recording.webm") {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("language_code", "en");
    const res = await fetch(`${API_BASE}/stt`, { method: "POST", body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { text }
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
    return res.blob(); // mp3 blob
  }

  // ---------- audio helpers ----------
  function stopAudio() {
    stopMascotAudio();
    setSpeaking(false);
  }

  async function playBlob(blob) {
    setSpeaking(false);
    const ok = await playBlobThroughMascot(blob);
    setSpeaking(ok);
  }

  // ---------- mic (STT) ----------
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

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

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
      stopAudio(); // ensure TTS is stopped before mic capture
      startRecording();
    } else {
      stopRecording();
    }
  }

  // ---------- ask once ----------
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
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" }),
        0
      );
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

  // ---------- effects ----------
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
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      }
      stopAudio(); // do NOT revoke URLs here; singleton manages them
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

  // ---------- UI ----------
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

