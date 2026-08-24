import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// This script lives in config/, but src/ and dist/ are repo-root-relative, so
// `root` steps back up out of config/.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/**
 * The one bundle this extension ships, rooted at `outDir`.
 *
 * `platform: browser` and `format: cjs` are what the extension host worker
 * loads; `vscode` stays external because the host injects it. The path is a
 * contract with `browser` in package.json.
 *
 * @param {string} outDir directory to build into
 * @returns {import('esbuild').BuildOptions}
 */
export function getBuildOptions(outDir = root) {
	return {
		entryPoints: [path.join(root, 'src', 'extension.ts')],
		outfile: path.join(outDir, 'dist', 'extension.js'),
		bundle: true,
		format: 'cjs',
		platform: 'browser',
		target: 'es2020',
		external: ['vscode'],
		// Never shipped: .vscodeignore drops every .map from the VSIX.
		sourcemap: true,
		logLevel: 'warning',
		absWorkingDir: root,
	};
}

/** @param {string} [outDir] */
export async function build(outDir) {
	await esbuild.build(getBuildOptions(outDir));
}

// pathToFileURL rather than a `file://` template, which does not match what
// import.meta.url carries on Windows.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	await build();
}
