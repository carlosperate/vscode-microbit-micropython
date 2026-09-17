/**
 * The BBC micro:bit Manager extension, which this one cannot activate without,
 * unpacked into `.vscode-test/manager/` from Open VSX. Fetched again only when
 * the published version moves, so a run normally touches the network once, for
 * the small query that says what the latest version is.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ID = 'carlosperate.bbcmicrobit-manager';
const [publisher, name] = ID.split('.');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.join(root, '.vscode-test', 'manager');
const stamp = path.join(home, 'version.txt');
const manifest = path.join(home, 'extension', 'package.json');

const here = fs.existsSync(manifest) && fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : undefined;
const latest = await published();

// Nothing to do, and nothing asked of the network beyond the query above.
if (latest === undefined || latest === here) {
	console.log(`[manager] ${ID} ${here ?? 'unknown'} is in .vscode-test/manager`);
	process.exit(0);
}

console.log(`[manager] fetching ${ID} ${latest} from Open VSX`);
// Unpacked beside the cache and swapped in whole, so a failed update leaves a working copy in place.
const staging = `${home}.next`;
try {
	fs.rmSync(staging, { recursive: true, force: true });
	fs.mkdirSync(staging, { recursive: true });
	// `.zip`, not `.vsix`: Windows PowerShell's Expand-Archive refuses any other extension.
	const archive = path.join(staging, 'manager.zip');
	const response = await ask(`https://open-vsx.org/api/${publisher}/${name}/${latest}/file/${publisher}.${name}-${latest}.vsix`);
	if (!response.ok) throw new Error(`could not download ${ID} ${latest} (HTTP ${response.status})`);
	fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
	unzip(archive, staging);
	if (!fs.existsSync(path.join(staging, 'extension', 'package.json'))) {
		throw new Error(`${archive} unpacked without an extension/package.json in it`);
	}
	fs.writeFileSync(path.join(staging, 'version.txt'), `${latest}\n`);
} catch (error) {
	fs.rmSync(staging, { recursive: true, force: true });
	if (!here) throw error;
	console.log(`[manager] could not update to ${latest} (${String(error)}), keeping ${here}`);
	process.exit(0);
}
// Retried: Windows holds handles on freshly written files for a moment.
fs.rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
fs.renameSync(staging, home);
console.log(`[manager] ${ID} ${latest} is in .vscode-test/manager`);

/** `undefined` keeps whatever is cached, so a run offline is a run, not a failure. */
async function published() {
	try {
		const response = await ask(`https://open-vsx.org/api/${publisher}/${name}/latest`);
		// `ask` answers or throws, so this is the one status it passes through.
		if (response.status === 404) throw new Error(`Open VSX has no ${ID}`);
		return (await response.json()).version;
	} catch (error) {
		if (here) {
			console.log(`[manager] Open VSX did not answer (${error.message}), keeping ${here}`);
			return undefined;
		}
		throw new Error(`Open VSX did not answer for ${ID} (${error.message}), and nothing is cached here`);
	}
}

/** Open VSX answers 503 often enough under load that one attempt is not an answer. */
async function ask(url, attempts = 4) {
	let last;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetch(url);
			if (response.ok || response.status === 404) return response;
			last = new Error(`HTTP ${response.status}`);
		} catch (error) {
			last = error;
		}
		if (attempt < attempts) await new Promise((resume) => setTimeout(resume, attempt * 1000));
	}
	throw last;
}

/** A VSIX is a zip, and neither node nor this repository has an unzipper. */
function unzip(from, into) {
	const run =
		process.platform === 'win32'
			? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${from}' -DestinationPath '${into}' -Force`])
			: spawnSync('unzip', ['-q', '-o', from, '-d', into]);
	if (run.status !== 0) throw new Error(`could not unpack ${from}: ${run.stderr?.toString().trim() || `exit ${String(run.status)}`}`);
}
