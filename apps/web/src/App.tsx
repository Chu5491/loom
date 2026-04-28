import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { SpecsPage } from "./pages/SpecsPage.js";

/**
 * Flat top-level navigation. Projects exist as an optional grouping but every
 * page is a plain list — we deliberately strip the "project shell" wrapper
 * until the harness UX is decided.
 */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/agents" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/specs" element={<SpecsPage />} />
        <Route path="/specs/:specId" element={<SpecsPage />} />
        <Route path="/runs" element={<RunsPage />} />
        <Route path="/runs/:runId" element={<RunDetailPage />} />
        <Route path="*" element={<p>Not found</p>} />
      </Route>
    </Routes>
  );
}
