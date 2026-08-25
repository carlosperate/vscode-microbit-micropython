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
 * install and no settings of the developer's are read.
 *
 * `--extensionDevelopmentKind=web` is deliberately not passed. With no `main`
 * entry the manifest already puts this in the LocalWebWorker host, so leaving
 * the flag off tests what a real desktop install gets.
 */
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
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
const testing = process.argv.includes('--test');

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
 * keep their own settings. Announced, because a profile that silently moved is a
 * setting that silently disappeared.
 */
function userDataDir() {
	if (testing) {
		// Measured before the directory is made, so a TMPDIR too deep for a socket
		// does not leave an empty profile behind on every failed run.
		const template = path.join(os.tmpdir(), 'mbmp-test-XXXXXX');
		if (!fits(template)) throw tooDeep(template);
		return fs.mkdtempSync(path.join(os.tmpdir(), 'mbmp-test-'));
	}

	const beside = path.join(root, '.vscode-test', 'user-data');
	if (fits(beside)) return beside;

	const key = createHash('sha256').update(root).digest('hex').slice(0, 8);
	const elsewhere = path.join(os.tmpdir(), `mbmp-${key}`);
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
 * Never overwrites, so a level raised in a session survives the next launch.
 */
function seedSettings(dir) {
	const settings = path.join(dir, 'User', 'settings.json');
	if (fs.existsSync(settings)) return;
	fs.mkdirSync(path.dirname(settings), { recursive: true });
	fs.writeFileSync(settings, `${JSON.stringify({ 'chat.disableAIFeatures': true }, null, '\t')}\n`);
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
seedSettings(profile);

// Alongside the user data for a test run, so both are thrown away together: an
// extension installed during an interactive session must not reach the tests.
const extensionsDir = testing
	? path.join(profile, 'extensions')
	: path.join(root, '.vscode-test', 'extensions');

const launchArgs = [
	`--user-data-dir=${profile}`,
	`--extensions-dir=${extensionsDir}`,
	'--skip-welcome',
	'--skip-release-notes',
	'--disable-workspace-trust',
	bench,
];

if (testing) {
	// The integration tests' own bundle, unchanged. It is built for the browser
	// and that is right here too: for an extension with no `main`, a script loaded
	// through `--extensionTestsPath` runs in the **web worker** host on desktop as
	// well, so one bundle serves both runs.
	try {
		await runTests({
			extensionDevelopmentPath: root,
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
	const executable = await downloadAndUnzipVSCode();
	const args = [
		// Absolute: VS Code resolves a relative path here against its own cwd, not
		// the shell's, and then quietly opens a window with no extension in it.
		`--extensionDevelopmentPath=${root}`,
		...launchArgs,
	];
	spawn(executable, args, { stdio: 'inherit', env: cleanEnv() }).on('exit', (status) => process.exit(status ?? 0));
}
