import { NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { env } from "../lib/env";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/nfl", label: "NFL" },
  { to: "/ncaaf", label: "College Football" },
  { to: "/nba", label: "NBA" },
  { to: "/ratings", label: "Power Ratings" },
  { to: "/lab", label: "Model Lab" },
  { to: "/backtests", label: "Backtesting" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen flex flex-col">
      {env.demo && (
        <div role="status" className="bg-warn/15 border-b border-warn/40 text-warn text-xs px-4 py-1.5 text-center">
          <strong>DEMO DATA</strong> · Supabase isn't configured. Everything shown is labeled sample data, not live odds or projections.
        </div>
      )}
      <header className="border-b border-line bg-panel/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto max-w-[1600px] flex items-center gap-4 px-4 h-12">
          <a href="#/" className="flex items-center gap-2 font-semibold tracking-tight">
            <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#111723" /><path d="M7 22l6-7 5 4 7-9" stroke="#38bdf8" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>EdgeBoard</span>
          </a>
          <nav aria-label="Main" className="hidden lg:flex items-center gap-1 text-sm">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}
                className={({ isActive }) => `px-2.5 py-1.5 rounded-md ${isActive ? "bg-panel-2 text-ink" : "text-mute hover:text-ink"}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-xs text-mute">
            {user && !user.demo && <span className="hidden sm:inline">{user.email}</span>}
            {user && !user.demo && <button className="btn" onClick={() => void signOut()}>Sign out</button>}
            <button className="btn lg:hidden" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>Menu</button>
          </div>
        </div>
        {open && (
          <nav id="mobile-nav" aria-label="Main" className="lg:hidden border-t border-line px-2 py-2 grid grid-cols-2 gap-1 text-sm">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
                className={({ isActive }) => `px-3 py-2 rounded-md ${isActive ? "bg-panel-2 text-ink" : "text-mute"}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}
      </header>
      <main className="flex-1 mx-auto w-full max-w-[1600px] px-4 py-5">
        <Outlet />
      </main>
      <footer className="border-t border-line text-[11px] text-faint px-4 py-3 text-center">
        EdgeBoard is a personal research tool. It does not accept or place wagers. Model outputs are estimates, not guarantees.
        Data: nflverse (CC-BY-4.0), CollegeFootballData, BALLDONTLIE, The Odds API.
      </footer>
    </div>
  );
}
