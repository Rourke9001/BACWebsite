# Lessons

## BAC-13 admin-API 404 debugging (2026-07-18)

1. **Azure Functions reserves the `admin/` route prefix.** Any HTTP function whose
   route starts with `admin/` errors at startup ("The specified route conflicts
   with one or more built in routes") while the rest of the app loads normally.
   The failure is invisible without Application Insights: ARM still lists the
   function, deploys report success, and requests get an empty 404. Never name a
   public route under `/api/admin/…`; we use `/api/blog-admin/…`.

2. **Get host logs before iterating on theories.** Four plausible fixes (edge
   rule removal, restart, redeploy, cache-bust, function rename) were deployed
   and disproven one by one — roughly 90 minutes — before wiring Application
   Insights, whose very first startup trace named the real cause. When a
   platform behaves inexplicably, instrumenting it is cheaper than guessing.

3. **Pin verification to the exact commit's workflow run.** `gh run list
   --limit 1` right after a push often returns the *previous* run, so probes hit
   stale builds and produce misleading negatives (this falsely killed the
   correct "reserved prefix" hypothesis the first time). Match runs by head SHA
   — and remember PR-event runs can surface under the merge commit's SHA, and
   that a merged/closed PR stops building its branch entirely.

4. **A merged PR is a moving fact, not a constant.** The user merged hotfix PR
   #9 mid-debugging; pushes to its branch silently stopped deploying. Before
   interpreting any deployed behavior, re-check `gh pr view <n> --json state`.

5. **`func start` requires a supported Node major.** Node 24 on this machine is
   rejected by Azure Functions Core Tools (exits immediately; earlier looked
   like a hang). Local host testing needs Node 20/22 — until then, unit tests +
   PR preview environments are the loop.

6. **Loading `api/src/functions/*.js` in a bare `node -e` is a cheap smoke.**
   The test suite exercises `lib/` only; the function files themselves are
   never imported by tests, so registration-time errors escape CI. `require()`
   of each function file (test mode) catches syntax/registration issues early —
   though not host-side route validation (see lesson 1).
