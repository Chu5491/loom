# 스킬 · 규약 작성 가이드

> office-as-code 의 정의 파일을 직접(또는 UI 로) 작성할 때의 약속.
> 로더/검증의 원천은 [apps/server/src/office.ts](../apps/server/src/office.ts), 주입 검증 기록은 [SPEC-INJECTION-VERIFIED.md](./SPEC-INJECTION-VERIFIED.md).

---

## 스킬 (office/skills/)

스킬은 **에이전트가 필요할 때 읽는 기술 문서**다. 본문은 프롬프트에 주입되지 않고,
run 직전 loadout 디스크에 펼쳐진 뒤 **경로 + 한 줄 설명 인덱스만** 프롬프트에 실린다
(토큰 절약 · 캐시 친화). 에이전트는 인덱스를 보고 필요한 스킬만 Read 한다.

### 두 가지 형태

**단일 파일** — 본문 하나면 충분할 때:

```
office/skills/commit-style.md
```

```markdown
---
name: commit-style
description: "커밋 메시지 작성 규칙"
---
# Commit style
...본문(마크다운)...
```

**폴더 스킬** — 참조 자료·예시 파일이 딸릴 때:

```
office/skills/api-conventions/
├── SKILL.md          # 본문 (frontmatter 동일)
└── reference.md      # SKILL.md 에서 상대경로로 참조
```

단일 파일 스킬에 UI 로 파일을 추가하면 자동으로 폴더(`<name>/SKILL.md`)로 승격된다.

### 규칙 (서버가 강제)

| 항목 | 제한 |
|---|---|
| 이름 | `[a-zA-Z0-9][a-zA-Z0-9_-]*` — 영숫자로 시작, 영숫자·`-`·`_` 만 |
| description | 최대 2,000자 — **인덱스에 실리는 한 줄**이므로 짧고 구체적으로 |
| body | 최대 100KB |
| 딸린 파일 경로 | 깊이 최대 4단계, 세그먼트는 `[a-zA-Z0-9][a-zA-Z0-9._-]*`, `..`·`SKILL.md` 금지 |
| 딸린 파일 수 | 최대 200개 |

### frontmatter

`---` 블록은 선택이지만 **description 은 사실상 필수** — 없으면 프롬프트 인덱스에
설명 없이 경로만 실려 에이전트가 언제 읽을지 판단하기 어렵다.

```yaml
---
name: <파일명과 동일 권장>
description: "<이 스킬이 언제 필요한지 한 줄>"
---
```

### 좋은 description 의 기준

에이전트는 description 만 보고 Read 여부를 정한다.

- ❌ `"API 문서"` — 무엇을 언제 쓰는지 모름
- ✅ `"REST 엔드포인트를 새로 만들 때 — 네이밍·에러 코드·페이지네이션 규칙"`

---

## 규약 (office/rules/)

규약은 **항상 적용되는 행동 지침**이다. 스킬과 달리 본문 전체가 프롬프트 앞에
그대로 주입된다(`=== Rules ===` 블록). frontmatter 없음, 순수 마크다운.

```
office/rules/global.md     # 본문만, 최대 100KB
```

**스킬 vs 규약 선택 기준:**

| | 규약 (rules) | 스킬 (skills) |
|---|---|---|
| 주입 | 본문 전체, 매 run | 인덱스만 — 필요 시 에이전트가 Read |
| 용도 | 행동 지침 (어조·금지·커밋 자세) | 기술/참조 (API 규칙·도메인 지식) |
| 비용 | 매 run 토큰 소모 — **짧게** | 길어도 됨 |

> 긴 내용을 규약에 넣으면 매 run 토큰을 태우고 모델 주의를 흩뜨린다
> (SPEC-INJECTION-VERIFIED.md 의 관찰). 길면 스킬로.

---

## 에이전트에 연결

스킬·규약은 에이전트 정의(`office/agents/<name>.json`)가 이름으로 참조해야 실린다:

```json
{
  "adapter": "claude-code",
  "model": "claude-haiku-4-5-20251001",
  "rules": ["global"],
  "skills": ["commit-style", "api-conventions"]
}
```

예외: Talk 컴포저에서 `@스킬명` 으로 **이 run 에만** 명시 첨부할 수 있다
(자동 주입이 아니라 사용자의 명시적 선택 — 헌법 2조가 허용하는 유일한 추가 경로).

## 실제 주입 확인

오피스 화면의 에이전트 행 **프리뷰** 버튼 — 그 에이전트로 run 을 시작하면 CLI 에
실제로 들어갈 합성 프롬프트(규약 + 지침 + loadout 인덱스)를 미리 보여준다.
이미 끝난 run 은 Talk 버블의 "전달된 프롬프트"로 사후 확인.
