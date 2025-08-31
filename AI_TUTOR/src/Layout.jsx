

import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import Mascot from "./components/Mascot";

export default function Layout() {
  function handleNewChat() {
    window.__clearChatUI?.();
  }

  const location = useLocation();
  const [hideDock, setHideDock] = useState(false);

  useEffect(() => {
    setHideDock(true);
    const t = setTimeout(() => setHideDock(false), 320); // sync with CSS 0.28s
    return () => clearTimeout(t);
  }, [location.pathname]);

  const dockStyle = useMemo(
    () => ({
      position: "fixed",
      right: 16,
      bottom: "calc(var(--composer-gap, 160px) + 16px)",
      zIndex: 50,
      pointerEvents: "none",
    }),
    []
  );

  // Reactively receive the current audio element from pages
  const [audioEl, setAudioEl] = useState(null);
  useEffect(() => {
    const handler = () => {
      setAudioEl(typeof window !== "undefined" ? window.__mascotAudioEl || null : null);
    };
    handler(); // initial grab
    window.addEventListener("mascot-audio-el-change", handler);
    return () => window.removeEventListener("mascot-audio-el-change", handler);
  }, []);

  return (
    <div className="layout">
      <Sidebar onNewChat={handleNewChat} />
      <main className="main">
        <Outlet />
      </main>

      {/* Borderless, portaled-like dock that never affects layout */}
      <div
        className={`mascot-dock ${hideDock ? "hide" : ""}`}
        style={dockStyle}
        aria-hidden="true"
      >
        <Mascot size={220} audioEl={audioEl} />
      </div>
    </div>
  );
}
