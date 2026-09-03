import * as vscode from 'vscode';

import { prepareFiles, projectClause } from '../commands/prepare';
import { PRODUCT } from '../config';
import { log } from '../log';
import { openEclipseSerial } from '../serial/eclipse';
import { reportSerialFailure } from '../serial/failure';
import { SERIAL_BAUD_RATE, TransportSerialPort } from '../serial/transport-port';
import { encodeFiles, type EncodedFile } from './protocol';
import type { Readiness } from './ready';
import type { Simulator } from './view';

/** One simulator, ever: revealed rather than opened a second time. */
export const openSimulator = (simulator: Simulator) => (): Promise<void> => simulator.show();

/**
 * The same selection, warnings and refusals as a flash, then the files
 * themselves rather than a hex: the simulator takes them as they are. No storage
 * check either: upstream's `flash()` writes with `force`, past its own 31.5 KiB
 * cap, so there is nothing to enforce. The command and the board's own play
 * button both come here, so they cannot drift.
 */
export async function filesForSimulator(context: vscode.ExtensionContext): Promise<EncodedFile[] | undefined> {
	const prepared = await prepareFiles(context);
	if (!prepared) return undefined;

	// The selection has already been logged file by file; this is the target line.
	log(`Running ${prepared.files.length} file(s)${projectClause(prepared)} in the simulator`);
	return encodeFiles(prepared.files);
}

export const runInSimulator =
	(simulator: Simulator) =>
	async (context: vscode.ExtensionContext): Promise<void> => {
		// Revealed before anything else, so what follows lands where the user can see it.
		await simulator.show();
		const files = await filesForSimulator(context);
		if (!files) return;

		// No success message: a board visibly restarting is the report.
		const outcome = await simulator.run(files);
		if (outcome.kind !== 'ready') reportNotReady('Run in Simulator', outcome);
	};

/**
 * A REPL on the simulated board, through the companion that owns every terminal
 * here. The board need not be running: a terminal opened before play sits quiet
 * until the program starts, and upstream discards what was typed meanwhile.
 */
export const openSimulatorTerminal = (simulator: Simulator) => async (): Promise<void> => {
	await simulator.show();
	const outcome = await simulator.ready();
	if (outcome.kind !== 'ready') {
		reportNotReady('Open Simulator Terminal', outcome);
		return;
	}

	try {
		// `options` always, or Eclipse asks for a baud rate; `name` always, or `{}` reads
		// as Unknown Vendor. The name leads with Simulator: a narrow tab shows only its start.
		const opened = await openEclipseSerial(
			'simulator',
			new TransportSerialPort(simulator.serial, {
				info: {},
				disconnected: 'The simulator was stopped.',
				banner: 'This terminal is connected to the simulator, not to a real micro:bit.',
			}),
			{ baudRate: SERIAL_BAUD_RATE },
			`Simulator: ${PRODUCT}`
		);
		// Eclipse warns itself when it refuses, and only while the window is focused.
		if (!opened) log('Eclipse did not open a terminal on the simulator');
	} catch (error) {
		// A missing companion costs the terminal and nothing else: the board keeps running.
		await reportSerialFailure(error);
	}
};

function reportNotReady(command: string, outcome: Exclude<Readiness, { kind: 'ready' }>): void {
	// The message below points at the output, so the reason has to be there.
	log(`${command} gave up: ${outcome.kind}${'detail' in outcome ? `, ${outcome.detail}` : ''}`);
	void vscode.window.showErrorMessage(
		outcome.kind === 'failed'
			? `${PRODUCT}: the simulator could not be loaded, see the output for why.`
			: `${PRODUCT}: the simulator did not start in time, see the output for why.`
	);
}
