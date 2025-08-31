
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import "../index.css";
import Mascot from "../components/Mascot.jsx";

const API_BASE = "https://ai-tutor-p0jv.onrender.com";

function FixedMascot({ audioEl }) {
  return createPortal(
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: "calc(var(--composer-gap, 160px) + 16px)",
        zIndex: 50,
      }}
    >
      <Mascot audioEl={audioEl} />
    </div>,
    document.body
  );
}

export default function ChatPage() {
  const [input, setInput] = useState("");
  const [items, setItems] = useState([]); 
  const [isProcessing, setIsProcessing] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const [sessionId, setSessionId] = useState(
    () => sessionStorage.getItem("session_id") || ""
  );

  
  const audioElRef = useRef(null);
  const currentUrlRef = useRef(null);

 
  const askAbortRef = useRef(null);
  const sttAbortRef = useRef(null);
  const ttsAbortRef = useRef(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);


  const listRef = useRef(null);
  const bottomRef = useRef(null);
  const composerRef = useRef(null);

  function ensureAudioEl() {
    if (!audioElRef.current) {
      const el = new Audio();
      el.preload = "auto";
      el.onended = () => setSpeakingIndex(null);
      el.onerror = () => setSpeakingIndex(null);
      audioElRef.current = el;
    }
    return audioElRef.current;
  }

  function stopAudio() {
    const el = audioElRef.current;
    if (el) {
      try { el.pause(); } catch {}
      try { el.currentTime = 0; } catch {}
    }
    if (currentUrlRef.current) {
      try { URL.revokeObjectURL(currentUrlRef.current); } catch {}
      currentUrlRef.current = null;
    }
    setSpeakingIndex(null);
  }

  async function playBlobForIndex(blob, idx) {
    if (!blob) return;
    stopAudio();
    const el = ensureAudioEl();
    const url = URL.createObjectURL(blob);
    currentUrlRef.current = url;
    el.src = url;
    setSpeakingIndex(idx);
    try { await el.play(); } catch { setSpeakingIndex(null); }
  }


  async function callChat(text, signal) {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        message: text,
        session_id: sessionId || undefined,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); 
  }

  async function callSTT(blob, filename, signal) {
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("language_code", "en");
    const res = await fetch(`${API_BASE}/stt`, { method: "POST", body: form, signal });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function callTTS(text, signal) {
    const res = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("TTS /tts failed:", res.status, errText);
      throw new Error(`TTS ${res.status}: ${errText}`);
    }

    return res.blob(); 
  }

  
  async function startRecording() {
    try {
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
          sttAbortRef.current = new AbortController();
          const { text } = await callSTT(blob, `recording.${ext}`, sttAbortRef.current.signal);
          if (text) setInput(text);
        } catch (err) {
          if (err?.name !== "AbortError") alert("STT failed");
        } finally {
          sttAbortRef.current = null;
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

  
  async function handleRead(index) {
    const item = items[index];
    if (!item?.bot) return;

    const el = audioElRef.current;
    if (speakingIndex === index && el && !el.paused && !el.ended) {
      stopAudio();
      return;
    }

    if (item.audioBlob) {
      await playBlobForIndex(item.audioBlob, index);
      return;
    }

    try {
      ttsAbortRef.current = new AbortController();
      const blob = await callTTS(item.bot, ttsAbortRef.current.signal);
      setItems(prev => {
        const next = [...prev];
        next[index] = { ...next[index], audioBlob: blob };
        return next;
      });
      await playBlobForIndex(blob, index);
    } catch (e) {
      if (e?.name !== "AbortError") alert("TTS failed");
    } finally {
      ttsAbortRef.current = null;
    }
  }

  
  async function send() {
    const q = input.trim();
    if (!q) return;

    if (listening) stopRecording();
    setIsProcessing(true);
    setInput("");

    const myIdx = items.length;
    setItems(prev => [...prev, { user: q, bot: null, audioBlob: null }]);

    try {
      askAbortRef.current = new AbortController();
      const data = await callChat(q, askAbortRef.current.signal);

      if (data.session_id && !sessionId) {
        setSessionId(data.session_id);
        try { sessionStorage.setItem("session_id", data.session_id); } catch {}
      }

      const answer = data.answer || "";

      let blob = null;
      try {
        ttsAbortRef.current = new AbortController();
        blob = await callTTS(answer, ttsAbortRef.current.signal);
      } finally {
        ttsAbortRef.current = null;
      }

      setItems(prev => {
        const next = [...prev];
        next[myIdx] = { ...next[myIdx], bot: answer, audioBlob: blob };
        return next;
      });

      if (blob) await playBlobForIndex(blob, myIdx);

    } catch (e) {
      if (e?.name !== "AbortError") {
        setItems(prev => {
          const next = [...prev];
          next[myIdx] = { ...next[myIdx], bot: "⚠️ Error fetching reply.", audioBlob: null };
          return next;
        });
      }
    } finally {
      setIsProcessing(false);
      askAbortRef.current = null;
    }
  }

  function stopAll() {
    stopAudio();
    if (listening) {
      if (sttAbortRef.current) sttAbortRef.current.abort();
      stopRecording();
    }
    if (askAbortRef.current) askAbortRef.current.abort();
    if (ttsAbortRef.current) ttsAbortRef.current.abort();
    setIsProcessing(false);
  }

  useEffect(() => {
    function sendResetBeacon() {
      const sid = sessionStorage.getItem("session_id");
      if (!sid) return;
      const blob = new Blob(
        [JSON.stringify({ session_id: sid, message: "[reset]", reset: true })],
        { type: "application/json" }
      );
      navigator.sendBeacon?.(`${API_BASE}/chat`, blob);
      try { sessionStorage.removeItem("session_id"); } catch {}
    }
    window.addEventListener("beforeunload", sendResetBeacon);
    return () => window.removeEventListener("beforeunload", sendResetBeacon);
  }, []);


  useEffect(() => {
    window.__clearChatUI = () => { setItems([]); stopAudio(); };
    return () => { delete window.__clearChatUI; };
  }, []);


  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [items]);


  useEffect(() => {
    const updateComposerGap = () => {
      const h = composerRef.current?.offsetHeight || 160;
      document.documentElement.style.setProperty("--composer-gap", `${h + 24}px`);
    };
    updateComposerGap();
    const ro = new ResizeObserver(updateComposerGap);
    if (composerRef.current) ro.observe(composerRef.current);
    const onWinResize = () => updateComposerGap();
    window.addEventListener("resize", onWinResize);
    return () => {
      window.removeEventListener("resize", onWinResize);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="page-with-sidebar">
      <div className="content">
        <div className="content-inner">
          <h1>AI Tutor — Ask me anything</h1>

          <FixedMascot audioEl={audioElRef.current} />

          <ul className="messages" ref={listRef} style={{ listStyle: "none", padding: 0 }}>
            {items.map((it, i) => (
              <li key={i} className="message">
                <div className="bubble user">{it.user}</div>

                <div className="bot-row">
                  <div className="bubble bot">
                    {it.bot ? <ReactMarkdown>{it.bot}</ReactMarkdown> : "Thinking…"}
                  </div>
                  {it.bot && (
                    <button
                      className={`tts-btn ${speakingIndex === i ? "speaking" : ""}`}
                      onClick={() => handleRead(i)}
                      aria-label={speakingIndex === i ? "Stop" : "Read this message"}
                      title={speakingIndex === i ? "Stop" : "Read this message"}
                    >
                      {speakingIndex === i ? "🔇 Stop" : "🔊 Read"}
                    </button>
                  )}
                </div>
              </li>
            ))}
            <div ref={bottomRef} />
          </ul>

          <div className="composer" ref={composerRef}>
            <input
              className="chat-input"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type or dictate a message…"
              onKeyDown={(e) => e.key === "Enter" && (isProcessing ? stopAll() : send())}
              aria-label="Message input"
            />
            <button
              className={`voice-btn ${listening ? "listening" : ""}`}
              onClick={toggleListening}
              aria-label={listening ? "Stop dictation" : "Start dictation"}
              title={listening ? "Stop dictation" : "Start dictation"}
            >
              {listening ? "🛑" : "🎤"}
            </button>
            <button
              className="send-btn"
              onClick={isProcessing ? stopAll : send}
              aria-label={isProcessing ? "Stop" : "Send message"}
              title={isProcessing ? "Stop" : "Send message"}
            >
              {isProcessing ? "⏹️" : "➡️"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



