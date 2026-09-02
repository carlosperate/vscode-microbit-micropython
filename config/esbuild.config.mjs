import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This script lives in config/, but src/ and dist/ are repo-root-relative, so
// `root` steps back up out of config/.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/**
 * What both bundles share. `format: cjs` is what an extension host loads either
 * way, and `vscode` stays external because the host injects it.
 */
const shared = {
	bundle: true,
	format: 'cjs',
	external: ['vscode'],
	// Never shipped: .vscodeignore drops every .map from the VSIX.
	sourcemap: true,
	logLevel: 'warning',
	absWorkingDir: root,
};

/**
 * The bundles this extension ships, rooted at `outDir`. One VSIX carries the two
 * extension bundles and the host picks: `browser` in a Web Worker, `main` in
 * Node. Those paths are a contract with those two fields in package.json. The
 * third runs in the simulator's webview document, which is neither.
 *
 * @param {string} outDir directory to build into
 * @returns {import('esbuild').BuildOptions[]}
 */
export function getBuildOptions(outDir = root) {
	return [
		{
			...shared,
			entryPoints: [path.join(root, 'src', 'browser', 'extension.ts')],
			outfile: path.join(outDir, 'dist', 'browser.js'),
			platform: 'browser',
			target: 'es2020',
			// Prefer `module` over `browser`: a UMD `browser` build assigns to
			// `global`, which the Web Worker doesn't have.
			mainFields: ['module', 'browser', 'main'],
		},
		{
			...shared,
			entryPoints: [path.join(root, 'src', 'node', 'extension.ts')],
			outfile: path.join(outDir, 'dist', 'node.js'),
			platform: 'node',
			// The oldest node any editor meeting `engines.vscode` runs its host on.
			target: 'node18',
			// `module` ahead of node's own default, so both bundles get the same
			// build of a dependency. The CJS half of `@microbit/microbit-fs` carries
			// core-js polyfills that sniff `navigator`, which is neither needed here
			// nor distinguishable from real WebUSB in the guard over these bundles.
			mainFields: ['module', 'main'],
		},
		{
			...shared,
			entryPoints: [path.join(root, 'src', 'webview', 'simulator.ts')],
			outfile: path.join(outDir, 'dist', 'webview', 'simulator.js'),
			platform: 'browser',
			target: 'es2020',
			// A script tag, not a module the host loads, so no CJS wrapper and no
			// `vscode`: the webview reaches the extension through acquireVsCodeApi.
			format: 'iife',
			external: [],
			// The stylesheet arrives as a string and is injected as one <style>, so
			// our whole contribution to upstream's page stays a single tag.
			loader: { '.css': 'text' },
		},
	];
}

/** @param {string} [outDir] */
export async function build(outDir) {
	await Promise.all(getBuildOptions(outDir).map((options) => esbuild.build(options)));
}

// pathToFileURL rather than a `file://` template, which does not match what
// import.meta.url carries on Windows.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	await build();
}
