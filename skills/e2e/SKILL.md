---
name: e2e
description: Run E2E smoke tests (basic) or full acceptance + regression suite (extended).
---

# E2E SKILL

## Config loading

Read `.claude/maestro.json` to resolve project-specific values:
- `{TEMP_ROOT}` = `.ai.temp_root`
- `{REPO}` = `.ai.repo`
- `{SLUG}` = `.ai.slug`
- `{HARNESS}` = `.stack.harness` — the resolved run/test harness: `{HARNESS.kind}`
  (`wp-local` / `web` / `api` / `generic` / `none`), `{HARNESS.base_url}`, `{HARNESS.boot_cmd}`,
  `{HARNESS.ui_entry}`, and `{HARNESS.browser_login}` (`{url, user, pass}`).
- `{E2E_CI}` = `.ai.e2e.ci_integration`

**Compat shim:** if `.stack` is absent (an older config not yet re-onboarded), synthesize
`{HARNESS}` from the legacy `.ai.e2e` block — `base_url` ← `.ai.e2e.local_url`, `boot_cmd` ←
`.ai.e2e.boot_cmd`, `ui_entry` ← `.ai.e2e.settings_path`, `kind` ← `wp-local`. The legacy
`.ai.e2e` block has no login keys, so also synthesize `browser_login` from the WordPress profile
defaults — `browser_login` ← `{ url: "/wp-login.php", user: "admin", pass: "password" }` — so the
basic-tier browser login step has the URL and credentials it needs. With these, existing
WordPress projects behave exactly as before, including the browser login flow.

This skill provides end-to-end test execution at two tiers. The difference is scope and depth;
the toolchain is driven by `{HARNESS.kind}` (Playwright MCP for browser kinds, curl for
`api`/`generic`, plus WP-CLI when `{HARNESS.kind} == "wp-local"`).

The environment is at `{HARNESS.base_url}`; boot or restart it with `{HARNESS.boot_cmd}`. If
`{HARNESS.kind} == "none"`, there is no bootable harness — log `SKIP`. A null `{HARNESS.boot_cmd}`
on an otherwise bootable kind (e.g. `wp-local`) is NOT "no harness": probe `{HARNESS.base_url}`
and smoke the already-running site (see the basic-tier process); only `SKIP` if it is
unreachable.

---

## Tier 1 — Basic

**Purpose:** behavioral verification and smoke tests. Fast enough to fit inside a planning
agent's execution window.

**Invokers:**
- `grooming-agent` — verify behavioral assumptions about the current system *before*
  writing the spec. Use to confirm: does the current feature behave as described in the
  issue? What does the current API or AJAX endpoint return for the scenario being changed?

### Anti-rationalization table

| You'll be tempted to say | Why you can't |
|---|---|
| "The environment probably isn't up, I'll skip" | Run `{HARNESS.boot_cmd}` if non-null. It's idempotent. If `kind == "none"`, log `SKIP`. If `boot_cmd` is null but `kind` is bootable (e.g. `wp-local`), do NOT treat that as "no harness" — probe `{HARNESS.base_url}` and smoke the already-running site (see step 1). Only log `SKIP` when the boot fails or no site is reachable — do not silently omit the step. |
| "The change is backend-only, no need to smoke it" | The primary happy path must be verified. A backend change with no observable behavior change still needs a confirming assertion. |
| "I already read the code, I know it works" | "Seems right" never closes a task. Run the scenario. |
| "One scenario is too slow for this stage" | Basic tier is exactly one primary scenario. The cost is acceptable. |

### Basic tier process

1. Boot the environment (idempotent — safe to run if already up):
   ```bash
   {HARNESS.boot_cmd}
   ```
   - If `{HARNESS.kind} == "none"`, set `status: "SKIP"` with reason "no bootable harness
     configured" and do not block the pipeline.
   - If `{HARNESS.boot_cmd}` is non-null, run it. If it exits non-zero, set `status: "SKIP"`,
     note the reason, and do not block the pipeline.
   - If `{HARNESS.boot_cmd}` is null but `{HARNESS.kind}` is bootable (`wp-local`, `web`, `api`,
     `generic`) — the case for an authored-profile WordPress config that ships a null `boot_cmd`
     default — do NOT equate this with "no bootable harness". Probe the base URL:
     ```bash
     curl -s -o /dev/null -w "%{http_code}" {HARNESS.base_url}
     ```
     If the site responds (2xx/3xx), proceed to step 2 and smoke the already-running site (this
     preserves the develop-era live smoke against `localhost:8888`). Only if the site is
     unreachable do you set `status: "SKIP"` with reason "boot_cmd null and {HARNESS.base_url}
     unreachable".

2. Run the primary happy path scenario from the spec or grooming plan.

   **Backend / API:**
   ```bash
   # Generic: exercise the changed endpoint against the harness base URL
   curl -s {HARNESS.base_url}/<path>

   # Cache / response headers
   curl -sI {HARNESS.base_url}/ | grep -E '(x-cache|cf-cache|cache-control)'
   ```
   When `{HARNESS.kind} == "wp-local"`, the WordPress mechanisms also apply — POST to
   `{HARNESS.base_url}/wp-admin/admin-ajax.php` with `action=<action>&nonce=...`, and run
   WP-CLI via `bin/wp <command>` inside the dev environment.

   **Browser (UI, settings page, notices) — only when `{HARNESS.kind}` is a browser kind
   (`wp-local` / `web`) and `{HARNESS.base_url}` is non-null:**
   Use the Playwright MCP directly for basic-tier smoke. Do not delegate to a browser sub-agent
   at this tier (that is the extended tier path):
   ```
   mcp__playwright__navigate({ url: "{HARNESS.browser_login.url}" })
   # login — credentials from {HARNESS.browser_login}
   mcp__playwright__fill({ selector: "<user-field>", value: "{HARNESS.browser_login.user}" })
   mcp__playwright__fill({ selector: "<pass-field>", value: "{HARNESS.browser_login.pass}" })
   mcp__playwright__click({ selector: "<submit>" })
   # primary scenario
   mcp__playwright__navigate({ url: "{HARNESS.base_url}{HARNESS.ui_entry}" })
   mcp__playwright__snapshot({})
   # Inspect snapshot output to confirm expected element/text is present
   ```
   For `{HARNESS.kind} == "wp-local"` the login selectors are known: `#user_login`,
   `#user_pass`, `#wp-submit`. For any other browser kind the login fields are **not** known —
   discover them by inspecting the page; if they cannot be found, log `SKIP` rather than guess.

   Take at most 1–2 screenshots if helpful, but do not publish them at this tier.

3. Report:
   ```json
   {
     "status": "PASS|FAIL|SKIP",
     "scenarios_tested": ["Settings page loads without errors after enabling X option"],
     "details": "Logged in, navigated to {HARNESS.base_url}{HARNESS.ui_entry}, confirmed no JS console errors and X toggle present"
   }
   ```

   `SKIP`: `{HARNESS.kind} == "none"`, `{HARNESS.boot_cmd}` exited non-zero, or (for a bootable
   kind with a null `boot_cmd`) `{HARNESS.base_url}` is unreachable. A null `boot_cmd` alone on a
   bootable kind is NOT a SKIP when the site responds — smoke it. Record reason. Do not block the
   pipeline.

### Basic tier boundaries

- ✅ Do: verify the **one primary scenario** from the spec or grooming plan
- ✅ Do: probe current-system behavior (grooming-agent only) when an assumption needs verification
- 🚫 Do not: cover all acceptance criteria (that is extended tier)
- 🚫 Do not: write or commit Playwright specs (that is extended tier via `wp-e2e-qa-tester` / `web-e2e-qa-tester`)
- 🚫 Do not: publish screenshots (that is extended tier)

---

## Tier 2 — Extended

**Purpose:** full acceptance criteria coverage, regression testing, edge cases, visual
comparison, and Playwright spec authoring with screenshot evidence.

**Invoker:** `qa-engineer` only.

**Execution:** the qa-engineer agent delegates browser flows to a browser sub-agent chosen by
`.stack.harness.kind` — `wp-e2e-qa-tester` for WordPress (`wp-local`), or `web-e2e-qa-tester`
for generic web apps (`web`, **untested — pending validation**). The sub-agent handles
Playwright MCP driving, temporary spec authoring under `.e2e-temp/`, screenshot publishing via
the commit-SHA method, and clean-up.

The qa-engineer agent itself handles:
- Strategy A (API / functional validation via curl and WP-CLI)
- Strategy C (test-suite-only fallback when the environment is unreachable)

For details, read:
- `.claude/agents/qa-engineer.md` — strategy selection and report format
- `.claude/agents/wp-e2e-qa-tester.md` — WordPress browser flow execution, spec authoring, screenshot publishing
- `.claude/agents/web-e2e-qa-tester.md` — generic web-app browser flow execution (untested — pending validation)

The extended tier writes Playwright specs to `.e2e-temp/` (gitignored, never committed when `{E2E_CI}` is false)
and screenshots to `.e2e-screenshots/`. Screenshots are published to a public GitHub Gist (`gh gist create --public`) to get permanent, publicly accessible raw URLs — no commits to the PR branch. Gist raw URLs never 404 in PR comments, unlike commit-SHA-based URLs.

---

## When to use which tier

| Invoker | Tier | Purpose |
|---|---|---|
| `grooming-agent` | Basic | Verify a behavioral assumption before writing the spec |
| `qa-engineer` | Extended | Full acceptance criteria + regression + screenshots |

---

## Project-specific notes

- The boot script `{HARNESS.boot_cmd}` is **idempotent**. Always run it before testing — don't pre-check whether the environment is up. If `{HARNESS.kind} == "none"`, there is no environment to boot. If `{HARNESS.boot_cmd}` is null on a bootable kind (e.g. `wp-local`), there is no boot script to run, but a site may already be up — probe `{HARNESS.base_url}` and smoke it if reachable.
- Login credentials come from `{HARNESS.browser_login}` (`{url, user, pass}`).
- Primary UI URL: `{HARNESS.base_url}{HARNESS.ui_entry}`.
- Reachability check (no login needed):
  ```bash
  curl -s -o /dev/null -w "%{http_code}" {HARNESS.base_url}{HARNESS.ui_entry}
  ```
- For cache-header tests, send a request to a front-end URL and inspect the project's cache response headers.
- The basic tier never writes Playwright spec files and is invoked by grooming-agent only. Implementation agents (backend-agent, frontend-agent) do not invoke the e2e skill — full E2E validation belongs to the qa-engineer + wp-e2e-qa-tester / web-e2e-qa-tester tier.
- If `{E2E_CI}` is true, the project maintains a permanent E2E suite — the browser sub-agent (`wp-e2e-qa-tester` / `web-e2e-qa-tester`) will commit spec files rather than delete them.
