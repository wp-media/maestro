---
name: sprint
description: Plan and estimate issues for a sprint — capacity planning, story points, HTML report.
---

# Sprint Planner

## Config loading

Read `.claude/maestro.json`:
- `{REPO}` = `.ai.repo`
- `{DISPLAY_NAME}` = `.ai.display_name`
- `{TEMP_ROOT}` = `.ai.temp_root`

---

## Step 1 — Gather input

Ask the user:
1. **Team size** (developers): default to 2. Accept any reasonable number.
2. **Target milestone** (optional): if specified, focus on issues with that milestone. Otherwise analyze all open backlog.

---

## Step 2 — Calculate sprint capacity

```
Total Capacity (Story Points) = Team Size × 8 SP per developer

2 weeks × 5 days/week = 10 working days per dev.
Accounting for reviews, meetings, and overhead: ~8 SP per dev per sprint.
```

Example: 2 devs → 16 SP, 3 devs → 24 SP.

---

## Step 3 — Fetch issues

```bash
gh api "repos/{REPO}/issues" \
  --method GET \
  -f state=open \
  -f per_page=100 \
  --paginate \
  --jq '.[] | select(.assignee == null) | {number: .number, title: .title, body: .body, labels: [.labels[].name], milestone: .milestone.title}'
```

Filter criteria:
- State: `open`
- Assignee: `null` (unassigned only)

If a milestone was specified, keep only issues whose `milestone` matches. Otherwise include all.

---

## Step 4 — Estimate story points

For each issue, analyze title + first 200 chars of body using these heuristics:

| Pattern | Base Points | Notes |
|---------|-------------|-------|
| "typo", "wording", "rename", single-file scope | 1 SP | Trivial |
| Simple fix/enhancement, 1–2 files, well-defined | 2 SP | Low |
| Feature or refactor, 3–5 files, standard | 3 SP | Medium |
| Architecture change, 6+ files, complex | 5 SP | High |
| "Rewrite", "overhaul", cross-module, major | 8 SP | Huge |
| Has `fix:` prefix or `bug` label | −1 SP (min 1) | Bugs tend to be tighter |
| Has `priority:critical` or `critical` label | +1 SP | May be more involved |

If scope is truly ambiguous, default to 3 SP. Don't overthink it — this is a heuristic, not a spec.

---

## Step 5 — Prioritize and build shortlist

Sort in this order:
1. Critical bugs (`priority:critical` + bug label)
2. High-priority bugs (`priority:high` + bug label)
3. Milestone-aligned features (if milestone specified)
4. Regular features
5. Tech debt (refactor, test, docs labels)

Add issues in priority order until total story points reach **100% of sprint capacity**. Reserve roughly **15–20%** of the budget for tech debt.

Identify 2–3 **overflow high-priority issues** that didn't fit, for discussion.

---

## Step 6 — Generate HTML report

Write to: `{TEMP_ROOT}/sprint/sprint-shortlist-YYYY-MM-DD-HHMM.html`

Create the directory if needed. Use the current date/time for the filename.

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Sprint Planner — {DISPLAY_NAME}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; background: #f5f5f5; }
    .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 3px solid #0066cc; padding-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #0066cc; color: white; padding: 12px; text-align: left; }
    td { padding: 12px; border-bottom: 1px solid #ddd; }
    tr:hover { background: #f9f9f9; }
    .param-box { background: #f0f7ff; border-left: 4px solid #0066cc; padding: 15px; margin: 20px 0; }
    .breakdown { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 20px 0; }
    .breakdown-item { padding: 15px; background: #f9f9f9; border-radius: 6px; text-align: center; }
    .breakdown-item h3 { margin: 0 0 10px; color: #555; }
    .breakdown-item .value { font-size: 28px; font-weight: bold; color: #0066cc; }
    .breakdown-item .pct { color: #999; font-size: 12px; margin-top: 5px; }
    .issue-row-bug { border-left: 4px solid #dc3545; }
    .issue-row-feature { border-left: 4px solid #28a745; }
    .issue-row-debt { border-left: 4px solid #ffc107; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Sprint Planner — {DISPLAY_NAME}</h1>

    <div class="param-box">
      <strong>Sprint Parameters:</strong><br>
      Repository: {REPO}<br>
      Team Size: [TEAM_SIZE] developers<br>
      Duration: 2 weeks (10 working days)<br>
      Total Capacity: [CAPACITY] Story Points<br>
      Target Milestone: [MILESTONE or "All Open Backlog"]<br>
      Generated: [TIMESTAMP]
    </div>

    <h2>Capacity Allocation</h2>
    <div class="breakdown">
      <div class="breakdown-item">
        <h3>Bugs</h3>
        <div class="value">[BUG_POINTS] SP</div>
        <div class="pct">[BUG_PCT]% of budget</div>
      </div>
      <div class="breakdown-item">
        <h3>Features</h3>
        <div class="value">[FEATURE_POINTS] SP</div>
        <div class="pct">[FEATURE_PCT]% of budget</div>
      </div>
      <div class="breakdown-item">
        <h3>Tech Debt</h3>
        <div class="value">[DEBT_POINTS] SP</div>
        <div class="pct">[DEBT_PCT]% of budget</div>
      </div>
    </div>

    <h2>Proposed Shortlist ([TOTAL_ISSUES] issues, [TOTAL_SP] / [CAPACITY] SP)</h2>
    <table>
      <thead>
        <tr>
          <th>Issue</th>
          <th>Title</th>
          <th>Type</th>
          <th>Estimated Effort</th>
          <th>Points</th>
        </tr>
      </thead>
      <tbody>
        [ISSUES_TABLE_ROWS]
      </tbody>
    </table>

    <h2>High-Priority Overflow (didn't fit this sprint)</h2>
    <div style="margin: 20px 0;">
      [LEFTOVER_ISSUES]
    </div>

    <div class="footer">
      Lightweight effort estimation — review during sprint planning for scope adjustments.<br>
      Repo: {REPO} &nbsp;·&nbsp; Generated by Maestro sprint
    </div>
  </div>
</body>
</html>
```

Replace placeholders with actual data before writing:
- `[TEAM_SIZE]`, `[CAPACITY]`, `[MILESTONE]`, `[TIMESTAMP]` — from user input and current time
- `[BUG_POINTS]`, `[FEATURE_POINTS]`, `[DEBT_POINTS]`, `[BUG_PCT]`, `[FEATURE_PCT]`, `[DEBT_PCT]` — from tally
- `[TOTAL_ISSUES]`, `[TOTAL_SP]` — final counts
- `[ISSUES_TABLE_ROWS]` — one `<tr>` per shortlisted issue with class `issue-row-bug`, `issue-row-feature`, or `issue-row-debt`
- `[LEFTOVER_ISSUES]` — bulleted list of overflow issues with links to `https://github.com/{REPO}/issues/<N>`

---

## Step 7 — Report to user

Tell the user:
- The output file path
- Capacity utilization (e.g., "18 issues, 15 / 16 SP — 94% loaded")
- Category breakdown (bugs / features / tech debt)
- Overflow issues available if priorities shift

---

## Implementation notes

- Use `gh` CLI for GitHub API calls — relies on the user's stored auth token
- If the specified milestone doesn't exist, warn and fall back to all open backlog
- Estimation fallback: if scope is truly ambiguous, use 3 SP (medium)
- Target ~20 issues for a 16 SP sprint; fewer if heavy L/XL tasks are picked
