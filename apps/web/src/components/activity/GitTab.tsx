// Git 활동 패널 — *navigation* 전용 사이드바.
//
// 한때 워킹트리 staging (StatusView) 를 여기 넣었는데 GitPage 메인의
// WorkingTreePanel 과 *완전히 같은 콘텐츠* 가 두 자리에 떠서 헷갈렸음.
// 역할 분리:
//   ActivityPanel (이 파일) = 브랜치 트리 + Stash 만 (navigation / 진입점)
//   GitPage 메인        = 커밋 그래프 + 워킹트리 staging / 선택 커밋 상세
//
// "사이드 = 어디 갈지, 메인 = 거기서 뭐 할지" 공식.

import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api } from "../../api/client.js";
import { useI18n } from "../../context/I18nContext.js";
import { BranchTree } from "../../pages/git/BranchTree.js";
import { StashPanel } from "../../pages/git/StashPanel.js";
import { NoProjectState, PanelHeader } from "./shared.js";

export function GitTab() {
  const { t } = useI18n();
  const { id: projectId } = useParams<{ id: string }>();

  if (!projectId) {
    return (
      <>
        <PanelHeader title={t("activity.git")} />
        <NoProjectState message={t("git.noProject")} />
      </>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PanelHeader title={t("activity.git")} />
      {/* 브랜치 트리 — local / remotes. 더블클릭 checkout. */}
      <div className="border-b border-border/60 flex-1 min-h-0 overflow-y-auto">
        <BranchTree projectId={projectId} />
      </div>
      {/* Stash — 변경 있을 때만 활성. */}
      <StashPanelMount projectId={projectId} />
    </div>
  );
}

/** Stash 는 워킹 트리에 변경 있을 때만 의미 있음. status 쿼리 dedup 으로 비용 0. */
function StashPanelMount({ projectId }: { projectId: string }) {
  const status = useQuery({
    queryKey: ["gitStatus", projectId],
    queryFn: () => api.getGitStatus(projectId),
    refetchInterval: 5_000,
    retry: false,
  });
  const s = status.data?.status;
  const hasChanges =
    !!s &&
    (s.staged.length > 0 ||
      s.unstaged.length > 0 ||
      s.untracked.length > 0);
  return (
    <div className="border-b border-border/60">
      <StashPanel projectId={projectId} hasChanges={hasChanges} />
    </div>
  );
}

