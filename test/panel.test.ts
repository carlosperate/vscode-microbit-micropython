import { describe, expect, it } from 'vitest';

import manifest from '../package.json';
import { CONTAINER_ID, MODE_WHEN } from '../src/config';

/**
 * This extension's half of the shared panel is strings in the manifest that VS
 * Code interprets: a container id another extension declares and a context key
 * another extension sets. A typo in either shows nothing and says nothing, which
 * is why they are checked against the code here.
 */
const views: { id: string; name: string; type?: string; when?: string }[] = manifest.contributes.views[CONTAINER_ID];

describe('the view in the shared panel', () => {
	/**
	 * The manager owns the container, and a mode contributes into it. Declaring a
	 * container of our own again would be a second micro:bit icon.
	 */
	it('goes into the container the manager declares, and declares none of its own', () => {
		expect(views.length).toBeGreaterThan(0);
		expect('viewsContainers' in manifest.contributes).toBe(false);
	});

	/**
	 * The workbench splits a section's height equally between the views an
	 * extension puts there, and honours `initialSize` only for the container's
	 * owner, so a second view would take half the panel whatever it held. The
	 * buttons live inside the simulator's document instead, where they cost the
	 * one row they need.
	 */
	it('is one webview, with the buttons drawn inside it', () => {
		expect(views).toHaveLength(1);
		expect(views[0]?.type).toBe('webview');
		expect('initialSize' in (views[0] ?? {})).toBe(false);
		expect('viewsWelcome' in manifest.contributes).toBe(false);
	});

	/**
	 * The manager names the active mode in one key, and this clause is true only
	 * while it names MicroPython, which is how switching hides everything of ours.
	 * A view without the clause would stay visible inside every other mode.
	 */
	it('is gated on the active-mode clause the manager makes true', () => {
		for (const view of views) expect(view.when, view.id).toBe(MODE_WHEN);
	});

	/**
	 * Pane headers are rendered with `text-transform: capitalize`, which turns
	 * `micro:bit` into `Micro:Bit`, so a view name has to read right capitalised.
	 */
	it('is named so that capitalising it changes nothing', () => {
		for (const view of views) {
			const capitalised = view.name.replace(
				/(^|[^a-z])([a-z])/gi,
				(_, before: string, letter: string) => `${before}${letter.toUpperCase()}`
			);
			expect(capitalised, view.id).toBe(view.name);
		}
	});
});

describe('the dependency on the manager', () => {
	/** Installing this installs the manager, and the container it declares is what our view needs. */
	it('is declared, so the container always exists', () => {
		expect(manifest.extensionDependencies).toContain('carlosperate.bbcmicrobit-manager');
	});
});
