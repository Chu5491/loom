// 프로젝트 스코프 라우팅. 홈은 워크스페이스 대시보드, 그 외는 /projects/:id 하위.
//
// 모든 페이지를 React.lazy로 lazy 로드 — 첫 페인트는 가벼운 라우트만 평가하고
// 큰 차트/그래프 페이지(RunDetailPage, GitPage 등)는 사용자가 들어갈 때 fetch.
// HomePage는 진입 페이지 비중이 커서 같이 lazy — vite가 main 청크에서 빼냄.

import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { ProjectShell } from "./components/ProjectShell.js";
import { useI18n } from "./context/I18nContext.js";

const HomePage = lazy(() =>
  import("./pages/HomePage.js").then((m) => ({ default: m.HomePage })),
);
const ProjectsPage = lazy(() =>
  import("./pages/ProjectsPage.js").then((m) => ({ default: m.ProjectsPage })),
);
const WorkspacePage = lazy(() =>
  import("./pages/WorkspacePage.js").then((m) => ({ default: m.WorkspacePage })),
);
const AgentsPage = lazy(() =>
  import("./pages/AgentsPage.js").then((m) => ({ default: m.AgentsPage })),
);
const SpecsPage = lazy(() =>
  import("./pages/SpecsPage.js").then((m) => ({ default: m.SpecsPage })),
);
const McpsPage = lazy(() =>
  import("./pages/McpsPage.js").then((m) => ({ default: m.McpsPage })),
);
const RunsPage = lazy(() =>
  import("./pages/RunsPage.js").then((m) => ({ default: m.RunsPage })),
);
const RunDetailPage = lazy(() =>
  import("./pages/RunDetailPage.js").then((m) => ({
    default: m.RunDetailPage,
  })),
);
const RunComparePage = lazy(() =>
  import("./pages/RunComparePage.js").then((m) => ({
    default: m.RunComparePage,
  })),
);
const GitPage = lazy(() =>
  import("./pages/GitPage.js").then((m) => ({ default: m.GitPage })),
);
const InsightsPage = lazy(() =>
  import("./pages/InsightsPage.js").then((m) => ({ default: m.InsightsPage })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.js").then((m) => ({
    default: m.DashboardPage,
  })),
);
const WorkspaceInsightsPage = lazy(() =>
  import("./pages/WorkspaceInsightsPage.js").then((m) => ({
    default: m.WorkspaceInsightsPage,
  })),
);

function PageLoader() {
  const { t } = useI18n();
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
      {t("common.loading")}
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          path="/"
          element={
            <Suspense fallback={<PageLoader />}>
              <HomePage />
            </Suspense>
          }
        />
        <Route
          path="/projects"
          element={
            <Suspense fallback={<PageLoader />}>
              <ProjectsPage />
            </Suspense>
          }
        />
        {/* 시스템 레벨 카탈로그 — 어떤 프로젝트에서든 같은 것을 본다.
            에이전트는 여기서 골라 자기 loadout을 구성. */}
        <Route
          path="/skills"
          element={
            <Suspense fallback={<PageLoader />}>
              <SpecsPage />
            </Suspense>
          }
        />
        <Route
          path="/skills/:specId"
          element={
            <Suspense fallback={<PageLoader />}>
              <SpecsPage />
            </Suspense>
          }
        />
        <Route
          path="/mcps"
          element={
            <Suspense fallback={<PageLoader />}>
              <McpsPage />
            </Suspense>
          }
        />
        <Route
          path="/mcps/:mcpId"
          element={
            <Suspense fallback={<PageLoader />}>
              <McpsPage />
            </Suspense>
          }
        />
        <Route
          path="/insights"
          element={
            <Suspense fallback={<PageLoader />}>
              <WorkspaceInsightsPage />
            </Suspense>
          }
        />
        <Route path="/projects/:id" element={<ProjectShell />}>
          <Route
            index
            element={
              <Suspense fallback={<PageLoader />}>
                <WorkspacePage />
              </Suspense>
            }
          />
          <Route
            path="dashboard"
            element={
              <Suspense fallback={<PageLoader />}>
                <DashboardPage />
              </Suspense>
            }
          />
          <Route
            path="agents"
            element={
              <Suspense fallback={<PageLoader />}>
                <AgentsPage />
              </Suspense>
            }
          />
          {/* /skills 와 /mcps는 시스템 레벨이라 위쪽 라우트로 이동.
              프로젝트 안에서도 ActivityBar가 시스템 라우트로 직접 보냄. */}
          <Route
            path="runs"
            element={
              <Suspense fallback={<PageLoader />}>
                <RunsPage />
              </Suspense>
            }
          />
          <Route
            path="runs/compare"
            element={
              <Suspense fallback={<PageLoader />}>
                <RunComparePage />
              </Suspense>
            }
          />
          <Route
            path="runs/:runId"
            element={
              <Suspense fallback={<PageLoader />}>
                <RunDetailPage />
              </Suspense>
            }
          />
          <Route
            path="git"
            element={
              <Suspense fallback={<PageLoader />}>
                <GitPage />
              </Suspense>
            }
          />
          <Route
            path="insights"
            element={
              <Suspense fallback={<PageLoader />}>
                <InsightsPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<p className="p-6">Not found</p>} />
      </Route>
    </Routes>
  );
}
