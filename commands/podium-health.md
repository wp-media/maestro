---
name: podium-health
description: >
  Check whether the Podium dashboard is installed and running.
  Used by the orchestrator at startup to decide between Podium observability
  and the legacy html-log fallback. Also useful to run manually when
  troubleshooting missing session data.
---

## Check

```bash
curl -s --max-time 1 http://localhost:4820/health
```

**Running (HTTP 200):**
```
Podium: running — http://localhost:4820
  Observability is active. The orchestrator will skip html-log writes.
```

**Not running:**
```
Podium: not running
  To start it: /podium start    (requires the Podium plugin — /plugin install podium@wp-media)
  Fallback: set "html_log": true in .claude/maestro.json to enable the legacy run log.
```
