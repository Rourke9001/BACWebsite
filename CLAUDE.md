BAC Website — Project Working Conventions

These are binding for every session in this repo.

Project context
•This repo is baclogistics.co.za: a static site on Azure Static Web Apps (app_location "site", api_location "api") with Azure Functions for the contact form and the dynamic blog (/blog/* served from Blob Storage, published via /admin/ with no deploy).
•README.md documents the repo layout, scope decisions, and the operations runbook (DNS, contact form, secrets).
•DESIGN.md documents the established design system (tokens, breakpoints, component patterns) — read it before any visual/UI change or new page/feature.

Branching and deploys
•develop is the working branch; base feature branches off develop and merge them into develop.
•Pushes to develop deploy staging: https://ambitious-bush-084cda303-staging.7.azurestaticapps.net
•Changes reach main only via PR (develop → main). Open PRs with gh, but the user merges them — never merge to main.
•Pushes to main deploy production: https://baclogistics.co.za (the bare ambitious-bush-084cda303.7.azurestaticapps.net hostname also serves production). PRs to main get preview environments.
•Staging and preview environments share production app settings (blob storage, email) — an /admin/ publish or form submission on staging touches production data.
•Never commit anything under archive/ or any *.sql file (old-site credentials and PII; it is gitignored — keep it that way).

Permissions
•Ask the user before anything outward-facing other than pushing branches and opening PRs.

Local preview
•cd site; python -m http.server 8080 (static pages only; /blog/* needs the Functions host — see README)

Workflow Orchestration

1. Plan Node Default
•Enter plan mode for any non-trivial task (three or more steps, or involving architectural decisions).
•If something goes wrong, stop and re-plan immediately rather than continuing blindly.
•Use plan mode for verification steps, not just implementation.
•Write detailed specifications upfront to reduce ambiguity.

2. Subagent Strategy
•Use subagents liberally to keep the main context window clean.
•Offload research, exploration, and parallel analysis to subagents.
•For complex problems, allocate more compute via subagents.
•Assign one task per subagent to ensure focused execution.

3. Self-Improvement Loop
•After any correction from the user, update tasks/lessons.md with the relevant pattern.
•Create rules for yourself that prevent repeating the same mistake.
•Iterate on these lessons rigorously until the mistake rate declines.
•Review lessons at the start of each session when relevant to the project.

4. Verification Before Done
•Never mark a task complete without proving it works.
•Diff behavior between main and your changes when relevant.
•Ask: “Would a staff engineer approve this?”
•Run tests, check logs, and demonstrate correctness.

5. Demand Elegance (Balanced)
•For non-trivial changes, pause and ask whether there is a more elegant solution.
•If a fix feels hacky, implement the solution you would choose knowing everything you now know.
•Do not over-engineer simple or obvious fixes.
•Critically evaluate your own work before presenting it.

6. Autonomous Bug Fixing
•When given a bug report, fix it without asking for unnecessary guidance.
•Review logs, errors, and failing tests, then resolve them.
•Avoid requiring context switching from the user.
•Fix failing CI tests proactively.

Task Management
1.Plan First: Write the plan to tasks/todo.md with checkable items.
2.Verify Plan: Review before starting implementation.
3.Track Progress: Mark items complete as you go.
4.Explain Changes: Provide a high-level summary at each step.
5.Document Results: Add a review section to tasks/todo.md.
6.Capture Lessons: Update tasks/lessons.md after corrections.

Core Principles
•Simplicity First: Make every change as simple as possible. Minimize code impact.
•No Laziness: Identify root causes. Avoid temporary fixes. Apply senior developer standards.
•Minimal Impact: Touch only what is necessary. Avoid introducing new bugs.