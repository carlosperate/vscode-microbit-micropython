/**
 * Rebuilds `assets/simulator/` from upstream source, using Docker.
 * Upstream ships no release assets nor npm package, so builds are created.
 * The toolchain image is amd64 only, so an arm64 host needs Docker emulation.
 *   node build-scripts/build-simulator.mjs [--ref=v0.1.14]
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'assets', 'simulator');
const dockerfile = path.join(here, 'simulator', 'Dockerfile');

/** Bumping this is the whole of an upstream upgrade; see dev.md. */
const DEFAULT_REF = 'v0.1.14';

/** Container path to path under `assets/simulator/`, posix on both sides.
 *  `build/` has to stay `build/`: `simulator.html` loads the scripts by relative
 *  path. The licence sits at the source root rather than under `build/`, and MIT
 *  asks for it to travel with the copies. */
const FILES = {
	'/src/build/simulator.html': 'simulator.html',
	'/src/build/build/firmware.js': 'build/firmware.js',
	'/src/build/build/simulator.js': 'build/simulator.js',
	'/src/build/build/firmware.wasm': 'build/firmware.wasm',
	'/src/LICENSE': 'LICENSE',
};

/** Windows resolves an extensionless command only through a shell, and a shell
 *  would mean quoting every path that might contain a space. */
const DOCKER = process.platform === 'win32' ? 'docker.exe' : 'docker';

/** The toolchain image is amd64 only, whatever the host is. */
const PLATFORM = 'linux/amd64';

function docker(args, { capture = false } = {}) {
	const result = spawnSync(DOCKER, args, capture ? { encoding: 'utf8' } : { stdio: 'inherit' });
	if (result.error?.code === 'ENOENT') {
		throw new Error('Docker was not found on PATH. This build needs it.');
	}
	if (result.status !== 0) {
		// `error` carries the reason for a permission or resource failure, where
		// `status` is null and stderr empty.
		const why = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
		throw new Error(`docker ${args[0]} failed: ${why}`);
	}
	return result.stdout?.trim();
}

/** Read out of the image that produced the files, so the recorded commits always
 *  match the bytes beside them. Note this reflects the image, cached or not: a
 *  re-cut tag needs `docker build --no-cache` to be noticed at all. */
function readPins(image) {
	const output = docker(
		[
			'run',
			'--rm',
			'--platform',
			PLATFORM,
			image,
			'bash',
			'-lc',
			'cd /src && git rev-parse HEAD && git -C lib/micropython-microbit-v2 rev-parse HEAD ' +
				'&& git -C lib/micropython-microbit-v2/lib/micropython rev-parse HEAD && emcc --version | head -1',
		],
		{ capture: true }
	);
	const lines = output.split('\n').map((line) => line.trim());
	// Positional, so a stray line from the login shell would shift every value.
	if (lines.length !== 4) throw new Error(`expected 4 lines of build pins, got:\n${output}`);
	const [simulator, microbit, micropython, emscripten] = lines;
	return { emscripten, simulator, 'micropython-microbit-v2': microbit, micropython };
}

/** Into a sibling temp directory, never straight into `assets/simulator/`: a copy
 *  that fails halfway would otherwise leave the committed folder gone or
 *  half-written, needing a `git checkout` to recover. */
function extract(image, temp) {
	const container = docker(['create', '--platform', PLATFORM, image], { capture: true });
	try {
		fs.rmSync(temp, { recursive: true, force: true });
		fs.mkdirSync(path.join(temp, 'build'), { recursive: true });
		for (const [from, to] of Object.entries(FILES)) {
			docker(['cp', `${container}:${from}`, path.join(temp, ...to.split('/'))]);
		}
	} finally {
		spawnSync(DOCKER, ['rm', '-f', container], { stdio: 'ignore' });
	}
}

/** The hashes exist so the test suite can catch a corrupt, truncated or stray
 *  file, not to detect a rebuild: `firmware.wasm` changes every time anyway. */
function hashFiles(dir) {
	return Object.values(FILES)
		.sort()
		.map((file) => {
			const bytes = fs.readFileSync(path.join(dir, ...file.split('/')));
			if (bytes.length === 0) throw new Error(`${file} came out of the container empty`);
			return { file, sha256: createHash('sha256').update(bytes).digest('hex') };
		});
}

function main() {
	const ref = process.argv.find((a) => a.startsWith('--ref='))?.slice('--ref='.length) ?? DEFAULT_REF;
	const image = `microbit-simulator-build:${ref}`;

	console.log(`Building the simulator from ${ref}. A clean build compiles MicroPython, so it is slow.`);
	docker([
		'build',
		'--platform',
		PLATFORM,
		'--build-arg',
		`SIMULATOR_REF=${ref}`,
		'-t',
		image,
		'-f',
		dockerfile,
		// The Dockerfile copies nothing in, so its own folder is context enough.
		path.dirname(dockerfile),
	]);

	const builtWith = readPins(image);
	const temp = `${outDir}.tmp`;
	try {
		extract(image, temp);
		const files = hashFiles(temp);
		fs.writeFileSync(
			path.join(temp, 'simulator.json'),
			`${JSON.stringify({ ref, builtWith, files }, null, '\t')}\n`
		);
		fs.rmSync(outDir, { recursive: true, force: true });
		fs.renameSync(temp, outDir);
	} catch (error) {
		fs.rmSync(temp, { recursive: true, force: true });
		throw error;
	}

	console.log(`\nWrote ${Object.keys(FILES).length} files to assets/simulator/ from ${ref}.`);
}

main();
