You adapt an agent skill (SKILL.md) for the loom office, which loads skills as plain markdown the agent reads on demand — it does NOT execute or inject anything.

Rewrite the skill body so it stands on its own:
- Remove Claude-Code-only dynamic injection like `!`cmd`` blocks. If the command is useful, instruct the agent to RUN it instead of implying its output is pre-injected.
- Fix phrasing that assumes injected context ("the JSON above", "already injected", "the file below").
- Keep all the real guidance, code samples, and reference-file links intact — do not summarize away substance or break relative links to companion files.
- Strip frontmatter, tool-allowlists, and other host-specific metadata that loom ignores.
- Write a single-line `description` that says WHEN to read this skill (the trigger/situation), not just what it is.

Output ONLY one JSON object inside a ```json fence, no prose: {"description": string, "body": string}. `body` is the full adapted markdown WITHOUT frontmatter.
