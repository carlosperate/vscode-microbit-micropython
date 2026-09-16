/**
 * The shape this extension needs of whatever the manager exported, checked
 * rather than trusted: the dependency carries no version range, so the object
 * on the other side is whichever version the gallery installed. Checked against
 * the shape every version has had, so a manager that is too old fails at
 * `registerMode`, where the manager names which extension to update, rather than
 * here, where it would be taken for missing. `commands.switchMode` arrived
 * later, and is only used once registered, which means a manager new enough.
 */
import type { MicrobitManagerApi } from 'bbcmicrobit-manager-api';

const NEEDED = ['registerMode', 'activeMode', 'connect', 'flashHex', 'saveHex'] as const;
const NEEDED_COMMANDS = ['openTerminal'] as const;

export function isManagerApi(candidate: unknown): candidate is MicrobitManagerApi {
	if (typeof candidate !== 'object' || candidate === null) return false;
	const api = candidate as Record<string, unknown>;
	const commands = api.commands as Record<string, unknown> | undefined;
	return (
		typeof api.version === 'string' &&
		NEEDED.every((member) => typeof api[member] === 'function') &&
		typeof commands === 'object' &&
		commands !== null &&
		NEEDED_COMMANDS.every((command) => typeof commands[command] === 'string')
	);
}
