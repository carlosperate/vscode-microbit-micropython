/**
 * Desktop VS Code with this extension loaded from source. Two modes:
 *
 * - no arguments, `npm run desktop`: open the bench interactively, the
 *   counterpart of `npm run chrome`.
 * - `--test`, `npm run test:integration:desktop`: run the integration tests, the
 *   same bundle `npm run test:integration` runs under VS Code Web.
 *
 * Both run a VS Code downloaded into `.vscode-test/` with an extensions
 * directory of their own, so a session is isolated from the machine's own
 * install and no settings of the developer's are read. The interactive profile
 * is wiped on every launch, so the bench opens as a fresh install each time.
 *
 * `--extensionDevelopmentKind` is deliberately not passed. The manifest declares
 * both `main` and `browser`, so desktop picks `main` and runs this in the Node
 * host, which is what a real desktop install gets. Forcing the web kind here
 * would test a bundle no desktop user ever loads.
 */
import { downloadAndUnzipVSCode, runTests, runVSCodeCommand } from '@vscode/test-electron';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This script lives in config/, but the bench and .vscode-test/ are
// repo-root-relative, so `root` steps back up out of config/.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const bench = path.join(root, 'test', 'workspace');
// The two places a bench profile may live, and the only two this script will ever remove.
const benchRoot = path.join(root, '.vscode-test');
const tempPrefix = path.join(os.tmpdir(), 'mbmp-');
const testing = process.argv.includes('--test');
const extraExtensions = process.argv.includes('--extra-extensions');
// `engines.vscode` is the floor, and its node is far older than the @types/node
// this compiles against, so a node API newer than it compiles and then throws.
// Only running there catches that: `--vscode-version=1.91.1`.
const versionArgument = process.argv.find((argument) => argument.startsWith('--vscode-version='));
const version = versionArgument?.slice('--vscode-version='.length);
// Other extensions loaded from source beside this one, `--extension=<path>`,
// repeatable: the manager this extension depends on, a serial companion checkout.
const alongside = process.argv
	.filter((argument) => argument.startsWith('--extension='))
	.map((argument) => path.resolve(root, argument.slice('--extension='.length)));
const developmentPaths = [root, ...alongside];

/** The limit is on the socket path, so it is the socket that gets measured. */
const SOCKET_LIMIT = 103;

/**
 * Whether VS Code could open its socket inside this directory. The real name
 * carries the running version (`1.99-main.sock`), unknown before launch, so this
 * measures a generous stand-in. Bytes, not characters: the limit is on
 * `sun_path`, so an accented folder in the path counts for more than its length.
 *
 * Unix only. Windows uses a named pipe under `\\.\pipe\`, which the profile path
 * is not part of, so measuring there would move a profile for no reason.
 */
const fits = (dir) =>
	process.platform === 'win32' || Buffer.byteLength(path.join(dir, '1.9999-main.sock')) <= SOCKET_LIMIT;

/**
 * Where the profile goes.
 *
 * A test run gets a throwaway one, and the two modes must never share. The tests
 * write settings and toggle state of their own, so a shared profile carries that
 * into every later interactive session, and a test run interrupted midway leaves
 * state behind that fails the *next* run before it starts.
 *
 * The interactive profile sits beside the downloaded VS Code, unless the
 * checkout is too deep for that to fit the socket limit, in which case it moves
 * to the temp directory under a name derived from the checkout so two clones
 * never share one. Announced, so a profile that moved can still be found.
 */
function userDataDir() {
	if (testing) {
		// Measured before the directory is made, so a TMPDIR too deep for a socket
		// does not leave an empty profile behind on every failed run.
		const template = `${tempPrefix}test-XXXXXX`;
		if (!fits(template)) throw tooDeep(template);
		return fs.mkdtempSync(`${tempPrefix}test-`);
	}

	const beside = path.join(benchRoot, 'user-data');
	if (fits(beside)) return beside;

	const key = createHash('sha256').update(root).digest('hex').slice(0, 8);
	const elsewhere = `${tempPrefix}${key}`;
	if (!fits(elsewhere)) throw tooDeep(elsewhere);
	console.log(`[desktop] ${root} is too deep for a profile beside it, so this session keeps its settings in ${elsewhere}`);
	return elsewhere;
}

/** Where a profile goes when it does not fit, and why it had to move. */
const tooDeep = (dir) =>
	new Error(
		`no room for a VS Code profile: ${dir} exceeds the ${SOCKET_LIMIT}-character socket limit. ` +
			'Set TMPDIR to something shorter.'
	);

/**
 * The Copilot sign-in modal is not covered by `--disable-extensions`: it comes
 * from `GitHub.copilot-chat`, which ships as a builtin, and builtins stay
 * enabled. A setting is the only thing that stops it swallowing keystrokes.
 */
function seedSettings(dir) {
	const settings = path.join(dir, 'User', 'settings.json');
	if (fs.existsSync(settings)) return;
	fs.mkdirSync(path.dirname(settings), { recursive: true });
	fs.writeFileSync(settings, `${JSON.stringify({ 'chat.disableAIFeatures': true }, null, '\t')}\n`);
}

/**
 * A bench that remembers is a bench that lies: a collapsed section, a dismissed
 * message or an extension installed last time would all pass for the first run's
 * behaviour. So every interactive launch starts as a fresh install. Only a
 * directory under one of the two bench roots above is ever removed, checked by
 * path. Anything else is refused, whatever asked for it.
 */
function freshBenchDir(dir) {
	if (![benchRoot + path.sep, tempPrefix].some((prefix) => dir.startsWith(prefix))) {
		throw new Error(`refusing to remove ${dir}: it is not a bench directory of this script's making`);
	}
	fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Launched from VS Code's own terminal, the inherited VSCODE_* vars reach the
 * child and its webviews then fail to register a service worker. */
function cleanEnv() {
	return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VSCODE_')));
}

/**
 * The same stripping for a test run, which cannot take a whole environment:
 * `runTests` merges `extensionTestsEnv` over `process.env`, and Node's spawn
 * omits any key whose value is `undefined`, so unsetting is how it is spelled.
 */
function clearedVscodeVars() {
	return Object.fromEntries(
		Object.keys(process.env)
			.filter((key) => key.startsWith('VSCODE_'))
			.map((key) => [key, undefined])
	);
}

const profile = userDataDir();
// Alongside the user data for a test run, so both are thrown away together: an
// extension installed during an interactive session must not reach the tests.
const extensionsDir = testing ? path.join(profile, 'extensions') : path.join(benchRoot, 'extensions');
// A test profile is brand new already; the interactive one is made so here.
if (!testing) {
	for (const dir of [profile, extensionsDir]) freshBenchDir(dir);
	console.log(`[desktop] fresh profile at ${profile}`);
}
seedSettings(profile);

// The ids come from our own manifest, so there is one list rather than two.
if (extraExtensions) {
	const { extensionPack = [] } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
	for (const id of extensionPack) {
		await runVSCodeCommand(
			['--install-extension', id, `--extensions-dir=${extensionsDir}`, `--user-data-dir=${profile}`],
			{ ...(version ? { version } : {}), spawn: { env: cleanEnv() } }
		);
	}
}

const launchArgs = [
	`--user-data-dir=${profile}`,
	`--extensions-dir=${extensionsDir}`,
	'--skip-welcome',
	'--skip-release-notes',
	'--disable-workspace-trust',
	bench,
];

if (testing) {
	// The integration tests' own bundle, unchanged. A script loaded through
	// `--extensionTestsPath` runs in whichever host the extension itself uses, so
	// this one is required by node here and loaded by a worker on the web. It
	// stays a browser build because nothing in it needs a node builtin, and it
	// reads `navigator` only behind a guard, which node has no equivalent of.
	try {
		await runTests({
			...(version ? { version } : {}),
			extensionDevelopmentPath: developmentPaths,
			extensionTestsPath: path.join(root, 'test', 'integration', 'dist', 'index.js'),
			extensionTestsEnv: clearedVscodeVars(),
			launchArgs,
		});
	} catch (error) {
		// The tests report their own failures line by line, so a stack trace on top
		// of them only buries the part worth reading.
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	} finally {
		// Windows holds file handles open for a moment after the window exits, so a
		// single unlink races it and fails the run on cleanup rather than on a test.
		fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
} else {
	const executable = await downloadAndUnzipVSCode(version);
	const args = [
		// Absolute: VS Code resolves a relative path here against its own cwd, not
		// the shell's, and then quietly opens a window with no extension in it.
		...developmentPaths.map((developmentPath) => `--extensionDevelopmentPath=${developmentPath}`),
		...launchArgs,
	];
	/**
	 * Exit as the child did. A signal death carries no status, so reporting 0 there would call a
	 * crash a clean run, and 128 plus the signal is what a shell reports: SIGSEGV reads as 139.
	 */
	const exitAs = (status, signal) => process.exit(signal ? 128 + (os.constants.signals[signal] ?? 0) : (status ?? 0));

	spawn(executable, args, { stdio: 'inherit', env: cleanEnv() }).on('exit', exitAs);
}
