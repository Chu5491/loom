import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { ProjectShell } from "./components/ProjectShell.js";
import { AgentsPage } from "./pages/AgentsPage.js";
import { HomePage } from "./pages/HomePage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { ReviewPage } from "./pages/ReviewPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { RunsPage } from "./pages/RunsPage.js";
import { SpecsPage } from "./pages/SpecsPage.js";
import { WorkspacePage } from "./pages/WorkspacePage.js";

/**
 * Project-scoped routing. The home page is a workspace dashboard;
 * everything else lives under /projects/:id. There are no flat
 * /agents or /specs top-level pages — managing agents always happens
 * inside a project.
 */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectShell />}>
          <Route index element={<WorkspacePage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="skills" element={<SpecsPage />} />
          <Route path="skills/:specId" element={<SpecsPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunDetailPage />} />
          <Route path="review" element={<ReviewPage />} />
        </Route>
        <Route path="*" element={<p className="p-6">Not found</p>} />
      </Route>
    </Routes>
  );
}
