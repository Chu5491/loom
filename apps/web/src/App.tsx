import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { ProjectShell } from "./components/ProjectShell.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { ProjectChatPage } from "./pages/ProjectChatPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { SpecsPage } from "./pages/SpecsPage.js";

/**
 * Project-scoped routing. Top level is just the project picker; once
 * you enter a project everything (agents, skills, runs) is nested
 * underneath /projects/:id. There are no flat /agents or /specs
 * top-level pages — managing agents always happens inside a project.
 */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectShell />}>
          <Route index element={<ProjectChatPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="skills" element={<SpecsPage />} />
          <Route path="skills/:specId" element={<SpecsPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunDetailPage />} />
        </Route>
        <Route path="*" element={<p className="p-6">Not found</p>} />
      </Route>
    </Routes>
  );
}
