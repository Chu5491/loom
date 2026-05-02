// 프로젝트 스코프 라우팅. 홈은 워크스페이스 대시보드, 그 외는 /projects/:id 하위.
//
// 모든 페이지를 React.lazy로 lazy 로드 — 첫 페인트는 가벼운 라우트만 평가하고
// 큰 차트/그래프 페이지(ReviewPage, RunDetailPage)는 사용자가 들어갈 때 fetch.
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
const RunsPage = lazy(() =>
  import("./pages/RunsPage.js").then((m) => ({ default: m.RunsPage })),
);
const RunDetailPage = lazy(() =>
  import("./pages/RunDetailPage.js").then((m) => ({
    default: m.RunDetailPage,
  })),
);
const ReviewPage = lazy(() =>
  import("./pages/ReviewPage.js").then((m) => ({ default: m.ReviewPage })),
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
            path="agents"
            element={
              <Suspense fallback={<PageLoader />}>
                <AgentsPage />
              </Suspense>
            }
          />
          <Route
            path="skills"
            element={
              <Suspense fallback={<PageLoader />}>
                <SpecsPage />
              </Suspense>
            }
          />
          <Route
            path="skills/:specId"
            element={
              <Suspense fallback={<PageLoader />}>
                <SpecsPage />
              </Suspense>
            }
          />
          <Route
            path="runs"
            element={
              <Suspense fallback={<PageLoader />}>
                <RunsPage />
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
            path="review"
            element={
              <Suspense fallback={<PageLoader />}>
                <ReviewPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<p className="p-6">Not found</p>} />
      </Route>
    </Routes>
  );
}
