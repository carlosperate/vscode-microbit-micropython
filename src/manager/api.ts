/**
 * Whether the manager's exports are an API this extension can use. The manager
 * refuses nobody, so this is the one place a mismatch is noticed. Compatible is
 * npm's caret: at or above ours, same major, and same minor below 1.0.0.
 */
import type { MicrobitManagerApi } from 'vscode-bbcmicrobit-manager-api';

export type ManagerCheck =
	| { readonly kind: 'accepted'; readonly api: MicrobitManagerApi }
	| { readonly kind: 'missing' }
	| { readonly kind: 'update-manager'; readonly served: string }
	| { readonly kind: 'update-extension'; readonly served: string };

export function checkManager(candidate: unknown, wanted: string): ManagerCheck {
	const served = typeof candidate === 'object' && candidate !== null ? (candidate as { version?: unknown }).version : undefined;
	const have = parse(served);
	const need = parse(wanted);
	if (typeof served !== 'string' || !have || !need) return { kind: 'missing' };
	if (compare(have, need) < 0) return { kind: 'update-manager', served };
	if (breaking(have) !== breaking(need)) return { kind: 'update-extension', served };
	return { kind: 'accepted', api: candidate as MicrobitManagerApi };
}

const parse = (version: unknown): number[] | undefined =>
	typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version.split('.').map(Number) : undefined;

const compare = (a: number[], b: number[]): number => a.map((part, at) => part - (b[at] ?? 0)).find((diff) => diff !== 0) ?? 0;

/** The part of a version whose change breaks callers: the major, or below 1.0.0 the minor too. */
const breaking = (version: number[]): string => version.slice(0, version[0] === 0 ? 2 : 1).join('.');
