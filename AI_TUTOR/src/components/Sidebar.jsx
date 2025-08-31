
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

const API_BASE = "http://127.0.0.1:8000";


async function resetServerMemoryIfAny() {
  const sid = sessionStorage.getItem("session_id");
  if (!sid) return;
  try {
    await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sid, message: "[reset]", reset: true }),
      keepalive: true, 
    });
  } catch {
  }
}

export default function Sidebar({ onNewChat }) {
  const navigate = useNavigate();
  const location = useLocation();

  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  async function handleNewChat() {
    await resetServerMemoryIfAny();
    sessionStorage.removeItem("session_id");
    onNewChat?.(); 
    if (location.pathname !== "/chat") navigate("/chat");
  }


async function goAskOnce(e) {
    e?.preventDefault?.();
    await resetServerMemoryIfAny();
    sessionStorage.removeItem("session_id");
  
    window.__clearChatUI?.();
    window.__clearAskUI?.();
  
    if (location.pathname !== "/ask") navigate("/ask");
  }
  
  function clickUpload() {
    if (!uploading) fileInputRef.current?.click();
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Please select a PDF file.");
      e.target.value = "";
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data?.detail || "Upload failed");
      } else {
        alert(data?.detail || "PDF uploaded and indexed!");
      }
    } catch {
      alert("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = ""; // reset file input
    }
  }

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="brand">AI Tutor</div>

      <nav className="nav" aria-label="Primary">
        <button
          className="nav-btn"
          onClick={handleNewChat}
          aria-label="Start a new chat"
          title="Start a new chat"
        >
          Chat
        </button>

        <a
          href="/ask"
          onClick={goAskOnce}
          className="nav-link"
          aria-label="Go to Ask Once"
          title="Ask Once"
        >
          Ask
        </a>


        <button
          className="nav-btn"
          onClick={clickUpload}
          disabled={uploading}
          aria-label="Upload a PDF to use as reference"
          title="Upload PDF"
        >
          {uploading ? "Uploading…" : "📄 Upload PDF"}
        </button>
        <input
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          ref={fileInputRef}
          onChange={handleFileUpload}
        />
      </nav>
    </aside>
  );
}
