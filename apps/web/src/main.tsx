import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import { AuthProvider, useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { SignIn } from "./pages/SignIn";
import { Settings } from "./pages/Settings";
import { NotFound } from "./pages/NotFound";
import { Backtests, GamePage, ModelLab, Ratings } from "./pages/Placeholders";
import { SportSlate } from "./pages/SportSlate";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false } },
});

/** Every page except sign-in requires a session (demo mode has a built-in demo user). */
function Protected() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-8 text-mute" role="status">Loading…</div>;
  if (!user) return <Navigate to="/signin" replace state={{ from: loc.pathname }} />;
  return <Layout />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <HashRouter>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route element={<Protected />}>
              <Route index element={<Dashboard />} />
              <Route path="/:sport" element={<SportSlate />} />
              <Route path="/game/:id" element={<GamePage />} />
              <Route path="/ratings" element={<Ratings />} />
              <Route path="/lab" element={<ModelLab />} />
              <Route path="/backtests" element={<Backtests />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </HashRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
