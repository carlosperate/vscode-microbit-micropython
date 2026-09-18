import { describe, expect, it } from 'vitest';

import manifest from '../package.json';
import { CONTAINER_ID, PRODUCT } from '../src/config';

/**
 * The sidebar is strings in the manifest that VS Code interprets: a container
 * id, a view in it, and their names. A typo in any of them shows nothing and
 * says nothing, which is why they are checked against the code here.
 */
const container = manifest.contributes.viewsContainers.activitybar.find((entry) => entry.id === CONTAINER_ID);
const views: { id: string; name: string; type?: string; when?: string }[] = manifest.contributes.views[CONTAINER_ID];

describe('the sidebar', () => {
	it('is a container of its own, titled with the product name', () => {
		expect(container?.title).toBe(PRODUCT);
		expect(Object.keys(manifest.contributes.views)).toEqual([CONTAINER_ID]);
	});

	/**
	 * An expanded view's body is never under 120px, so a second view for two
	 * buttons would cost far more than the row they need inside the simulator's
	 * document.
	 */
	it('is one webview, with the buttons drawn inside it', () => {
		expect(views).toHaveLength(1);
		expect(views[0]?.type).toBe('webview');
		expect('viewsWelcome' in manifest.contributes).toBe(false);
	});

	/** VS Code merges a lone view's name into the container header, and shows it once only when the two match. */
	it('names the view the same as its container', () => {
		expect(views[0]?.name).toBe(container?.title);
	});

	/** A `when` hides the icon until a key is set, so it would arrive a moment after the window. */
	it('shows the view unconditionally', () => {
		expect(views[0]?.when).toBeUndefined();
	});
});

describe('the dependency on the manager', () => {
	/** Installing this installs the manager, which owns the board. */
	it('is declared', () => {
		expect(manifest.extensionDependencies).toContain('carlosperate.bbcmicrobit-manager');
	});
});
