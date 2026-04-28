import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { ProjectShell } from "./components/ProjectShell.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { ProjectRoomPage } from "./pages/ProjectRoomPage.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { SpecsPage } from "./pages/SpecsPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectShell />}>
          {/* The pixel office IS the project home. */}
          <Route index element={<ProjectRoomPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="specs" element={<SpecsPage />} />
          <Route path="specs/:specId" element={<SpecsPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunDetailPage />} />
        </Route>
        <Route path="*" element={<p>Not found</p>} />
      </Route>
    </Routes>
  );
}
