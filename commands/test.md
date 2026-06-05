---
name: test
description: Write PHPUnit tests for PHP source files, auto-detecting conventions from the project.
---

# Test Writer

Writes PHPUnit unit and integration tests for PHP source files in this project.

Conventions (naming, `@group` annotations, mocking libraries) are discovered from the architecture
skill and existing test files — not assumed. Works for any wp-media WordPress plugin with Maestro.

## Config loading

Read `.claude/maestro.json`:
- `{ARCH_SKILL}` = `.ai.architecture_skill`
- `{DISPLAY_NAME}` = `.ai.display_name`

## Steps

1. **Parse the argument** (if any):
   - No argument → `target = "auto"` (find changed source files on the current branch that lack test coverage)
   - `src/Foo/Bar.php` → `target = "src/Foo/Bar.php"`
   - Multiple files → `target = ["src/Foo/Bar.php", "src/Baz/Qux.php"]`

2. **Spawn `test-writer`** as a sub-agent, passing `target` and the project config above.

3. **Return** the list of test files written and the command to run them.
