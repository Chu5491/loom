// 외부 IDE 선택 — 프로젝트 카드 / 생성 폼에서 공통 사용. 라벨은 사용자 친화
// 표시명, value는 PreferredEditor enum과 1:1.

import type { PreferredEditor } from "@loom/core";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";

const EDITORS: ReadonlyArray<{ value: PreferredEditor; label: string }> = [
  { value: "vscode", label: "VS Code" },
  { value: "cursor", label: "Cursor" },
  { value: "antigravity", label: "Antigravity" },
  { value: "zed", label: "Zed" },
  { value: "intellij", label: "IntelliJ IDEA" },
];

export function editorLabel(value: PreferredEditor | null): string {
  if (!value) return "VS Code";
  return EDITORS.find((e) => e.value === value)?.label ?? value;
}

export function EditorPicker({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: PreferredEditor | null;
  onChange: (next: PreferredEditor) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <Select
      value={value ?? "vscode"}
      onValueChange={(v) => onChange(v as PreferredEditor)}
    >
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {EDITORS.map((e) => (
          <SelectItem key={e.value} value={e.value}>
            {e.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
