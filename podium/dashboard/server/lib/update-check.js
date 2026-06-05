/**
 * @file Detects whether the dashboard git checkout is behind the canonical
 * remote default branch (e.g. upstream/master on a fork, origin/master on a
 * direct clone) after a non-destructive fetch. Branch- and fork-aware:
 * picks the right remote, recognises feature-branch checkouts, and shapes
 * manual_command so it actually closes the gap for the user's situation.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const DEFAULT_ROOT = path.join(__dirname, "..", "..");

// Standard convention for fork workflows: "upstream" points at the canonical
// repo, "origin" points at the user's fork. Prefer upstream when both exist.
const REMOTE_PRIORITY = ["upstream", "origin"];

function execGit(cwd, args, opts = {}) {
  const timeout = opts.timeout ?? 120_000;
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout, maxBuffer: 2_000_000, encoding: "utf8" },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(String(stdout).trim());
      }
    );
  });
}

async function listRemotes(gitRoot) {
  try {
    const out = await execGit(gitRoot, ["remote"], { timeout: 10_000 });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function pickCanonicalRemote(gitRoot) {
  const remotes = await listRemotes(gitRoot);
  for (const candidate of REMOTE_PRIORITY) {
    if (remotes.includes(candidate)) return candidate;
  }
  return remotes[0] || null;
}

async function resolveCompareRefForRemote(gitRoot, remote) {
  const tryRefs = [`${remote}/master`, `${remote}/main`];
  for (const ref of tryRefs) {
    try {
      await execGit(gitRoot, ["rev-parse", "--verify", ref], { timeout: 10_000 });
      return ref;
    } catch {
      // continue
    }
  }
  try {
    const sym = await execGit(gitRoot, ["symbolic-ref", `refs/remotes/${remote}/HEAD`], {
      timeout: 10_000,
    });
    const m = sym.match(/^refs\/remotes\/(.+)$/);
    if (m) return m[1];
  } catch {
    // ignore
  }
  return null;
}

async function getCurrentBranch(gitRoot) {
  try {
    const branch = await execGit(gitRoot, ["symbolic-ref", "--short", "HEAD"], {
      timeout: 10_000,
    });
    return branch || null;
  } catch {
    return null; // detached HEAD
  }
}

async function getBranchUpstream(gitRoot) {
  try {
    return await execGit(gitRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
      timeout: 10_000,
    });
  } catch {
    return null; // no tracking branch configured
  }
}

function stripRemotePrefix(ref) {
  // "upstream/master" -> "master"; "origin/feature/foo" -> "feature/foo"
  const idx = ref.indexOf("/");
  return idx === -1 ? ref : ref.slice(idx + 1);
}

/**
 * @param {string} [gitRoot]
 * @param {{ skipFetch?: boolean }} [options]
 * @returns {Promise<object>}
 */
async function getUpdatesStatus(gitRoot = DEFAULT_ROOT, options = {}) {
  // Disabled: Podium is embedded in Maestro and has no standalone upstream to
  // fetch from. Running git fetch against the repo root would target the
  // parent Maestro repo, which is irrelevant and can fail noisily.
  return { update_available: false, current_sha: "podium-fork", latest_sha: "podium-fork" };
}

module.exports = { getUpdatesStatus, DEFAULT_ROOT };
