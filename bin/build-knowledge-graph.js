#!/usr/bin/env node
/**
 * Maestro Knowledge Graph Builder
 *
 * Scans PHP, TypeScript, and JavaScript source files and extracts
 * import/dependency relationships into a structured JSON graph stored at
 * .claude/graph/dependency-graph.json.
 *
 * Project-specific scan directories are read from .claude/maestro.json (areas).
 * Falls back to common directory names if no config is found.
 *
 * First run: full scan of all source files.
 * Subsequent runs: incremental — only files changed since the last recorded commit.
 *
 * Usage:
 *   node bin/build-knowledge-graph.js           # auto (incremental if possible)
 *   node bin/build-knowledge-graph.js --full    # force full rebuild
 *   node bin/build-knowledge-graph.js --dry-run # print stats without writing
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config — read from .claude/maestro.json, fall back to common defaults
// ---------------------------------------------------------------------------

const ROOT       = path.resolve(process.cwd());
const GRAPH_PATH = path.join(ROOT, '.claude', 'graph', 'dependency-graph.json');
const EXTENSIONS = { php: ['.php'], js: ['.js', '.ts', '.tsx', '.jsx'] };

const ARGS    = process.argv.slice(2);
const FORCE   = ARGS.includes('--full');
const DRY_RUN = ARGS.includes('--dry-run');

function loadMaestroConfig() {
	const configPath = path.join(ROOT, '.claude', 'maestro.json');
	if (!fs.existsSync(configPath)) return null;
	try {
		return JSON.parse(fs.readFileSync(configPath, 'utf8'));
	} catch {
		return null;
	}
}

function resolveScanDirs(config) {
	if (!config || !Array.isArray(config.areas)) {
		// Fallback: common directory names used across wp-media projects
		return {
			scanDirs:  ['src', 'classes', 'inc', 'app'],
			assetDirs: ['assets', '_dev/src'],
		};
	}

	const scanDirs  = [];
	const assetDirs = [];

	for (const area of config.areas) {
		if (!area.path) continue;
		const p = area.path.replace(/\/$/, ''); // strip trailing slash
		switch (area.role) {
			case 'third-party':
				// Never scan vendor/third-party directories
				break;
			case 'built-assets':
				assetDirs.push(p);
				break;
			default:
				// namespaced-php, tests, legacy-php, or anything else — scan it
				scanDirs.push(p);
		}
	}

	return { scanDirs, assetDirs };
}

const maestroConfig      = loadMaestroConfig();
const { scanDirs, assetDirs } = resolveScanDirs(maestroConfig);
const projectName        = maestroConfig?.ai?.display_name || path.basename(ROOT);

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(cmd) {
	try {
		return execSync(`git -C "${ROOT}" ${cmd}`, { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
}

function headSha() {
	return git('rev-parse HEAD');
}

function changedFiles(fromSha, toSha = 'HEAD') {
	const out = git(`diff --name-only ${fromSha}..${toSha}`);
	return out ? out.split('\n').filter(Boolean) : [];
}

function allTrackedFiles() {
	const out = git('ls-files');
	return out ? out.split('\n').filter(Boolean) : [];
}

// ---------------------------------------------------------------------------
// PHP parser
// ---------------------------------------------------------------------------

function parsePhp(content) {
	const imports   = [];
	const symbols   = [];
	let   namespace = null;

	const nsMatch = content.match(/^\s*namespace\s+([\w\\]+)\s*;/m);
	if (nsMatch) namespace = nsMatch[1];

	const useRe = /^\s*use\s+([\w\\]+)(?:\\{([^}]+)})?\s*(?:as\s+\w+)?\s*;/gm;
	let m;
	while ((m = useRe.exec(content)) !== null) {
		const base    = m[1];
		const grouped = m[2];
		if (grouped) {
			for (const part of grouped.split(',')) {
				const trimmed = part.trim().replace(/\s+as\s+\w+$/, '');
				imports.push(`${base}\\${trimmed}`);
			}
		} else {
			imports.push(base.replace(/\s+as\s+\w+$/, '').trim());
		}
	}

	const declRe = /^\s*(abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum)\s+(\w+)(?:\s+extends\s+([\w\\,\s]+?))?(?:\s+implements\s+([\w\\,\s]+?))?\s*(?:\{|$)/gm;
	while ((m = declRe.exec(content)) !== null) {
		const kind       = m[2];
		const name       = m[3];
		const rawExtends = m[4] ? m[4].split(',').map(s => s.trim()).filter(Boolean) : [];
		const rawImpls   = m[5] ? m[5].split(',').map(s => s.trim()).filter(Boolean) : [];
		symbols.push({ kind, name, extends: rawExtends, implements: rawImpls });
	}

	return { namespace, symbols, imports: [...new Set(imports)] };
}

// ---------------------------------------------------------------------------
// JS / TS parser
// ---------------------------------------------------------------------------

function parseJs(content) {
	const imports = [];

	const staticRe = /\bimport\s+(?:[\w*{][^'"]*from\s+)?['"]([^'"]+)['"]/g;
	let m;
	while ((m = staticRe.exec(content)) !== null) {
		imports.push(m[1]);
	}

	const dynRe = /(?:\bimport|\brequire)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	while ((m = dynRe.exec(content)) !== null) {
		imports.push(m[1]);
	}

	return { imports: [...new Set(imports)] };
}

// ---------------------------------------------------------------------------
// File scanner
// ---------------------------------------------------------------------------

function isSourceFile(relPath) {
	const allDirs = [...scanDirs, ...assetDirs];
	return allDirs.some(d => relPath.startsWith(d + '/') || relPath.startsWith(d + '\\'));
}

function languageOf(relPath) {
	const ext = path.extname(relPath).toLowerCase();
	if (EXTENSIONS.php.includes(ext)) return 'php';
	if (EXTENSIONS.js.includes(ext))  return 'js';
	return null;
}

function processFile(relPath) {
	const lang = languageOf(relPath);
	if (!lang) return null;
	if (!isSourceFile(relPath)) return null;

	const absPath = path.join(ROOT, relPath);
	if (!fs.existsSync(absPath)) return null;

	const content = fs.readFileSync(absPath, 'utf8');

	if (lang === 'php') {
		const { namespace, symbols, imports } = parsePhp(content);
		return { language: 'php', namespace, symbols, imports };
	}

	const { imports } = parseJs(content);
	return { language: 'js', imports };
}

// ---------------------------------------------------------------------------
// Symbol index
// ---------------------------------------------------------------------------

function buildSymbolIndex(nodes) {
	const index = {};
	for (const [filePath, node] of Object.entries(nodes)) {
		if (node.language !== 'php' || !node.symbols) continue;
		for (const sym of node.symbols) {
			const fqn = node.namespace ? `${node.namespace}\\${sym.name}` : sym.name;
			index[fqn] = filePath;
		}
	}
	return index;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadGraph() {
	if (fs.existsSync(GRAPH_PATH)) {
		try {
			return JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
		} catch {
			// corrupted — start fresh
		}
	}
	return { generated_at: null, base_commit: null, nodes: {}, symbol_index: {} };
}

function saveGraph(graph) {
	fs.mkdirSync(path.dirname(GRAPH_PATH), { recursive: true });
	fs.writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2) + '\n', 'utf8');
}

function run() {
	console.log(`⚙  ${projectName} knowledge graph builder`);
	console.log(`   Scan dirs  : ${[...scanDirs, ...assetDirs].join(', ') || '(none configured)'}`);

	const currentSha = headSha();
	const existing   = loadGraph();

	const isUpToDate    = !FORCE && existing.base_commit === currentSha;
	const isIncremental = !FORCE && existing.base_commit && currentSha &&
	                      existing.base_commit !== currentSha;

	if (isUpToDate) {
		console.log(`✓  Already up to date (${currentSha?.slice(0, 8)}).`);
		return;
	}

	let filesToProcess, mode;

	if (isIncremental) {
		filesToProcess = changedFiles(existing.base_commit, 'HEAD');
		mode = `incremental — ${filesToProcess.length} changed files since ${existing.base_commit?.slice(0, 8)}`;
	} else {
		filesToProcess = allTrackedFiles();
		mode = `full scan — ${filesToProcess.length} tracked files`;
	}

	console.log(`   Mode       : ${mode}`);

	const nodes = isIncremental ? { ...existing.nodes } : {};
	let processed = 0, skipped = 0, removed = 0;

	for (const relPath of filesToProcess) {
		if (!languageOf(relPath) || !isSourceFile(relPath)) { skipped++; continue; }

		const absPath = path.join(ROOT, relPath);
		if (!fs.existsSync(absPath)) {
			if (nodes[relPath]) { delete nodes[relPath]; removed++; }
			continue;
		}

		const node = processFile(relPath);
		if (node) { nodes[relPath] = node; processed++; }
		else skipped++;
	}

	const symbol_index = buildSymbolIndex(nodes);

	const graph = {
		generated_at: new Date().toISOString(),
		base_commit:  currentSha,
		node_count:   Object.keys(nodes).length,
		nodes,
		symbol_index,
	};

	console.log(`   Processed  : ${processed}`);
	if (removed) console.log(`   Removed    : ${removed}`);
	console.log(`   Total nodes: ${graph.node_count}`);
	console.log(`   Symbols    : ${Object.keys(symbol_index).length}`);

	if (DRY_RUN) {
		console.log('ℹ  Dry-run — graph not written.');
		return;
	}

	saveGraph(graph);
	console.log(`✓  Saved → .claude/graph/dependency-graph.json`);
}

run();
