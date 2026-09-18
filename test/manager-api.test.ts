import { describe, expect, it } from 'vitest';

import types from 'vscode-bbcmicrobit-manager-api/package.json';
import { MANAGER_API_VERSION } from '../src/config';
import { checkManager } from '../src/manager/api';

const served = (version: unknown) => ({ version, registerMenuGroup: () => ({ dispose() {} }) });
const kind = (candidate: unknown, wanted = '0.3.0') => checkManager(candidate, wanted).kind;

describe('checking the manager API version', () => {
	it('accepts the version it was built against, and a later one that cannot break it', () => {
		expect(kind(served('0.3.0'))).toBe('accepted');
		expect(kind(served('0.3.1'))).toBe('accepted');
		expect(kind(served('1.4.0'), '1.2.0')).toBe('accepted');
	});

	it('hands back the object it accepted', () => {
		const api = served('0.3.0');
		const check = checkManager(api, '0.3.0');
		expect(check.kind === 'accepted' && check.api).toBe(api);
	});

	/** An older manager lacks what this extension calls, so the manager is the one to update. */
	it('asks for a newer manager when the manager is older', () => {
		expect(checkManager(served('0.2.0'), '0.3.0')).toEqual({ kind: 'update-manager', served: '0.2.0' });
		expect(kind(served('0.3.0'), '0.3.1')).toBe('update-manager');
		expect(kind(served('0.9.9'), '1.0.0')).toBe('update-manager');
		expect(kind(served('1.0.0'), '1.2.0')).toBe('update-manager');
	});

	/** Below 1.0.0 a minor may remove a call this extension makes, so it counts as breaking. */
	it('asks for a newer extension when the manager is a breaking version ahead', () => {
		expect(checkManager(served('0.4.0'), '0.3.0')).toEqual({ kind: 'update-extension', served: '0.4.0' });
		expect(kind(served('1.0.0'), '0.3.0')).toBe('update-extension');
		expect(kind(served('2.0.0'), '1.5.0')).toBe('update-extension');
	});

	it('calls anything without a version it can read missing', () => {
		expect(kind(undefined)).toBe('missing');
		expect(kind(null)).toBe('missing');
		expect(kind('0.3.0')).toBe('missing');
		expect(kind({})).toBe('missing');
		expect(kind(served(3))).toBe('missing');
		expect(kind(served('0.3'))).toBe('missing');
	});
});

/**
 * The version this extension compares against is a version of the types
 * package, and the two are bumped by hand in different files.
 */
it('compares against the API version of the types it was built against', () => {
	expect(MANAGER_API_VERSION).toBe(types.version);
});
