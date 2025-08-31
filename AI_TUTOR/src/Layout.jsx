

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
    const t = setTimeout(() => setHideDock(false), 320);
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
        <Mascot size={220} />
      </div>
    </div>
  );
}
