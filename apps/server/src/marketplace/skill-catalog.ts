// Skill 마켓플레이스 카탈로그.
//
// 솔직히 — "skill 스토어" 의 표준 형식이 아직 자리 잡지 않았고, 큐레이팅된
// 공개 카탈로그도 빈약함. anthropics/skills 같은 공식 레포는 있지만 그쪽도
// SKILL.md 형식이 loom 의 markdown spec 형식과 100% 호환되진 않음.
//
// 그래서 v1 은:
//   - 인프라(라우트 + UI) 만 갖추고
//   - loom 팀이 큐레이팅한 starter skill 몇 개를 seed
//   - 사용자가 이 파일을 수정해 자기 카탈로그를 만들 수 있게
//
// 새 스킬 추가:
//   - 아래 SKILLS 배열에 entry 추가 (id 는 globally unique 하게 prefix 권장)
//   - content 에 markdown 본문 직접 박음 (간결하게 — 길면 별도 파일 권장)

export interface MarketplaceSkill {
  /** 카탈로그 안 stable id. */
  id: string;
  /** 화면 + install 시 default name. 사용자가 변경 가능. */
  name: string;
  /** 한 줄 설명. */
  description: string;
  /** 출처 / 더 보기 링크 (선택). */
  source?: string;
  publisher: "loom" | "Anthropic" | "Community";
  tags: string[];
  /** SKILL.md 본문. install 시 spec.content 로 그대로 복사. */
  content: string;
}

export const SKILLS: ReadonlyArray<MarketplaceSkill> = [
  {
    id: "loom:concise-commits",
    name: "Concise commits",
    description:
      "Conventional commit style — short subject, why-not-what body, one topic per commit.",
    source: "https://www.conventionalcommits.org/",
    publisher: "loom",
    tags: ["git", "starter"],
    content: `# Concise commits

When making a git commit:

- Subject line ≤ 72 chars, imperative mood ("Add", "Fix", "Refactor"), no trailing period.
- Use a type prefix: \`feat:\` / \`fix:\` / \`refactor:\` / \`docs:\` / \`test:\` / \`chore:\`.
- One topic per commit. If you find yourself writing "and" in the subject, split.
- Body explains *why*, not what — the diff already shows what.
- Wrap body at 72 chars, leave a blank line after the subject.

Don't:
- Don't bundle unrelated changes ("fix typo + redesign auth").
- Don't write "minor changes" or "wip" — describe the change concretely.
- Don't reference internal-only tickets without context if the repo is public.
`,
  },
  {
    id: "loom:code-review-checklist",
    name: "Code review checklist",
    description:
      "Reviewer's pass: correctness, tests, edge cases, naming, abstractions.",
    publisher: "loom",
    tags: ["review", "starter"],
    content: `# Code review checklist

Walk through the diff in this order — don't skip steps even if the change looks small.

## Correctness
- Does the change do what the PR description claims?
- Any obvious off-by-one, null deref, or unhandled error path?
- Edge cases: empty input, large input, unicode, whitespace, concurrency.

## Tests
- Is there a test for the new behavior? For the bug being fixed (regression test)?
- Do existing tests still cover the changed path, or did the change make them vacuous?

## Naming + clarity
- Are new names domain words or generic placeholders ("data", "manager", "helper")?
- Could a reader 6 months later understand the intent without the PR description?

## Abstraction
- Is the code repeated 3+ times? If so, would extracting help?
- Is anything extracted that's only used once? If so, would inlining help?

## Out-of-scope
- Drive-by changes that don't belong in this PR — flag them but don't block.

When something needs changing, suggest the smallest concrete fix rather than a vague principle.
`,
  },
  {
    id: "loom:debugging-systematic",
    name: "Systematic debugging",
    description:
      "Reproduce → bisect → form hypothesis → test → fix. Don't shotgun-edit.",
    publisher: "loom",
    tags: ["debugging", "starter"],
    content: `# Systematic debugging

When stuck on a bug, follow the steps in order. Skipping ahead wastes time.

1. **Reproduce.** Make a minimal command / test that fails reliably. If it's intermittent, find what makes it consistent (concurrency? time? input?).
2. **Bisect.** Narrow the failure window: \`git bisect\`, comment out chunks, simplify input. Find the smallest change between "works" and "doesn't."
3. **Hypothesis.** State *why* you think it fails in one sentence. Don't start patching until you have one.
4. **Test the hypothesis.** Print / breakpoint / assert exactly the variable your hypothesis predicts. If reality matches, you understand it; if not, hypothesis was wrong — go back to step 3 with the new info.
5. **Fix.** Smallest possible change that makes the reproduction pass. Resist scope creep here — refactors come in a separate commit.
6. **Add a regression test.** The reproduction from step 1 becomes the test. If you can't write one, ask why.

If you find yourself making the same change in many places without testing each, stop — you've drifted into shotgun debugging. Re-anchor with step 1.
`,
  },
  {
    id: "loom:no-magic",
    name: "No-magic policy",
    description:
      "Loom's house rule: no auto-injection of system prompts, AGENTS.md, skill bundles. Explicit user input only.",
    publisher: "loom",
    tags: ["starter"],
    content: `# No-magic policy

When configuring an agent or building a feature, follow this rule:

**The CLI receives exactly what the user typed (plus what they explicitly attached).** Nothing else.

What this rules out:
- No automatic discovery of \`AGENTS.md\`, \`CLAUDE.md\`, or similar in the cwd.
- No auto-injection of system prompts the user didn't author.
- No auto-attaching skills "because they look relevant."
- No auto-loading of skill bundles based on file extensions or repo patterns.

What's allowed:
- Skills the user explicitly attached to the agent (or to this run).
- MCP servers the user configured for the agent.
- The user's prompt for this turn.
- The agent's own prompt (which the user wrote).

When in doubt: if the user can't trace where a piece of context came from by looking at the UI, it shouldn't be in the CLI's input.
`,
  },
];
