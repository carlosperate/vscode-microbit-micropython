import * as vscode from 'vscode';

import { prepareFiles, projectClause } from '../commands/prepare';
import { PRODUCT } from '../config';
import { log } from '../log';
import { encodeFiles, type EncodedFile } from './protocol';
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

		const outcome = await simulator.run(files);
		if (outcome.kind === 'ready') return;

		// The message below points at the output, so the reason has to be there.
		log(`Run in Simulator gave up: ${outcome.kind}${'detail' in outcome ? `, ${outcome.detail}` : ''}`);
		// No success message on the other branch: a board visibly restarting is the report.
		void vscode.window.showErrorMessage(
			outcome.kind === 'failed'
				? `${PRODUCT}: the simulator could not be loaded, see the output for why.`
				: `${PRODUCT}: the simulator did not start in time, see the output for why.`
		);
	};
