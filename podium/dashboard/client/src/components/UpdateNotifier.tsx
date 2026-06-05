/**
 * @file Update notifier — disabled in the Podium fork.
 *
 * Upstream this modal told the user when the dashboard's git checkout was
 * behind its remote and printed the command to update. Podium is maintained as
 * a fork inside the Maestro repo, so self-update checks against the upstream
 * GitHub repo are not meaningful here. The component is intentionally a no-op.
 */

export function UpdateNotifier() {
  return null;
}
