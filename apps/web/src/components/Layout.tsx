import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar.js";

/**
 * Slack/Discord-style shell — persistent left sidebar, main column
 * fills the rest. Pages own their own scrolling so the chat can
 * occupy full height while management pages can scroll naturally.
 */
export function Layout() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
