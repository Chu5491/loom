import { useQuery } from "@tanstack/react-query";
import { Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import type { LayoutOutletContext } from "./Layout.js";
import { useI18n } from "../context/I18nContext.js";
import { useLoomEvent } from "../lib/loomEvents.js";

/** Layout for `/projects/:id/*`. There used to be a tab strip here that
 *  duplicated the activity bar — gone now. The bar on the left is the
 *  single nav surface. */
export function ProjectShell() {
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const layoutContext = useOutletContext<LayoutOutletContext>();
  const navigate = useNavigate();
  const location = useLocation();

  // openFile / viewFile 이벤트를 files 라우트로 포워드.
  // 이미 /files 위에 있으면 search param만 교체 (FilesPage가 반응).
  const goToFile = (path: string) => {
    const target = `/projects/${id}/files?path=${encodeURIComponent(path)}`;
    navigate(target, { replace: location.pathname.endsWith("/files") });
  };
  useLoomEvent("openFile", ({ path }) => goToFile(path));
  useLoomEvent("viewFile", ({ path }) => goToFile(path));

  const project = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
  });

  if (project.isLoading || !project.data) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {project.isError
          ? (project.error as Error)?.message
          : t("common.loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <Outlet context={layoutContext} />
    </div>
  );
}
