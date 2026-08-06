# Style Guide — Comments & Code

Rules for how Claude writes comments and code in this repo. Checked before any commit.

## Comments

- [ ] Explain WHY, not WHAT. Skip comments that just restate what the next line obviously does.
- [ ] Max 1-2 lines per comment. Longer explanations belong in a README or this doc, not inline.
- [ ] No comments that recap the whole function above them.
- [ ] No changelog-style comments ("added this on 3/1", "fixed bug here") — that's what git history is for.
- [ ] No commented-out dead code left behind.
- [ ] Only comment non-obvious logic: tricky edge cases, workarounds, business rules that aren't self-evident from the code.

## Naming

- [ ] Prefer clear naming over a comment explaining unclear naming. Rename instead of annotating.
