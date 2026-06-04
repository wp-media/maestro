---
name: wordpress-compliance
description: Use this skill when modifying templates, admin UI, output, hooks, plugin metadata, sanitization, escaping, or any code that must remain compliant with WordPress.org and repository PHPCS rules.
---

# WordPress Compliance

Ensure compatibility with:
- WordPress Plugin Check
- Repository PHPCS rules
- WordPress.org expectations

## Config loading

Read `.claude/maestro.json` to load project-specific values:
- `TEXT_DOMAIN` = `.ai.text_domain` (e.g. `rocket`, `backwpup`, `imagify`)
- `CAPABILITIES` = `.ai.capabilities` (project-registered custom capabilities array)

## Responsibilities

- Respect repository PHPCS configuration.
- Follow WordPress escaping standards.
- Avoid forbidden or deprecated APIs.
- Avoid direct access to superglobals without sanitization.
- Ensure output is escaped for context.

## Escaping heuristics

HTML text: `esc_html()`
HTML attribute: `esc_attr()`
URL: `esc_url()`
Allowed HTML: `wp_kses_post()`

## Text domain

Use `{TEXT_DOMAIN}` from config for all translation calls:

```php
esc_html__( 'Clear Cache', '{TEXT_DOMAIN}' )
esc_attr__( 'Plugin Settings', '{TEXT_DOMAIN}' )
```

## Custom capabilities

If `.ai.capabilities` in repo-map.json is non-empty, always use those capabilities
(not `manage_options`) for capability checks. The PHPCS config should allow them
without warnings.

Example — read the list from config and use accordingly:
```php
// Correct — use the project-registered capability, not manage_options directly
current_user_can( 'plugin_manage_options' )
```

Using `manage_options` directly for plugin-specific actions is incorrect and will flag
in code review unless the project's PHPCS config explicitly allows it.

## JavaScript

- Do not use jQuery. Use native DOM APIs (`document.querySelector`, `addEventListener`, `fetch`, etc.).
- jQuery is available in WordPress but its use introduces an unnecessary dependency and conflicts with modern bundling practices.

## Anti-patterns

- Echoing raw variables
- Introducing unescaped output
- Storing sensitive values in plain text
- Bypassing repository PHPCS configuration
- Using jQuery in new or modified JS code

## Related Specs

When relevant, consult repository specs under `.claude/specs/`, especially:

- `.claude/specs/phpcs/nonce-verification-recommended.md`
- `.claude/specs/phpcs/validated-sanitized-input.md`
- `.claude/specs/phpcs/escaped-output.md`

## Git Operations
Follow the policy defined in AGENTS.md §5.1. Outside the issue workflow, do not run `git commit` or `git push`.
