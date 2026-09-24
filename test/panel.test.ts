import { describe, expect, it } from 'vitest';

import manifest from '../package.json';
import { BOARD_VIEW_ID, COMMANDS, CONTAINER_ID, PRODUCT, SIMULATOR_VIEW_ID } from '../src/config';

/**
 * The sidebar is strings in the manifest that VS Code interprets: a container
 * id, the views in it, their names, and command ids in markdown. A typo in any
 * of them shows nothing and says nothing, which is why they are checked here.
 */
const container = manifest.contributes.viewsContainers.activitybar.find((entry) => entry.id === CONTAINER_ID);
const views: { id: string; name: string; type?: string; when?: string }[] = manifest.contributes.views[CONTAINER_ID];
const welcome = manifest.contributes.viewsWelcome;
const lines = welcome.flatMap((entry) => entry.contents.split('\n'));

/** Every `[label](command:id)` link in the welcome content, in the order a user reads them. */
const buttons = lines.flatMap((line) =>
	[...line.matchAll(/\[([^\]]+)\]\(command:([^)]+)\)/g)].map((match) => ({
		label: match[1].replace(/\$\([a-z-]+\)\s*/, ''),
		command: match[2],
	}))
);

describe('the sidebar', () => {
	it('is a container of its own, titled with the product name', () => {
		expect(container?.title).toBe(PRODUCT);
		expect(Object.keys(manifest.contributes.views)).toEqual([CONTAINER_ID]);
	});

	/** A webview never shows welcome content, so the native buttons need a view of their own above it. */
	it('is a tree for the buttons above the simulator webview', () => {
		expect(views.map((view) => view.id)).toEqual([BOARD_VIEW_ID, SIMULATOR_VIEW_ID]);
		expect(views[0]?.type).toBeUndefined();
		expect(views[1]?.type).toBe('webview');
		expect(welcome.every((entry) => entry.view === BOARD_VIEW_ID)).toBe(true);
	});

	it('names each view for MicroPython, since the manager can combine them into its own sidebar', () => {
		expect(views.map((view) => view.name)).toEqual([PRODUCT, 'MicroPython Simulator']);
	});

	/** A `when` hides the icon until a key is set, so it would arrive a moment after the window. */
	it('shows every view unconditionally', () => {
		expect(views.every((view) => view.when === undefined)).toBe(true);
	});
});

describe('the buttons', () => {
	/** The view's body is never under 120px, and a third line of any kind overflows it into a scrollbar. */
	it('are Flash and the serial terminal, one per row', () => {
		expect(buttons).toEqual([
			{ label: 'Flash MicroPython project', command: COMMANDS.flash },
			{ label: 'Open serial terminal', command: 'bbcmicrobit-manager.openTerminal' },
		]);
		expect(lines).toHaveLength(buttons.length);
	});

	/** The title bar costs no height, and the icon is the whole button there. */
	it('are joined by Show All Actions as an icon on their view title bar, kept off the palette', () => {
		const titleBar = manifest.contributes.menus['view/title'];
		expect(titleBar).toEqual([
			{ command: COMMANDS.showAllActions, when: `view == ${BOARD_VIEW_ID}`, group: 'navigation' },
		]);
		const command = manifest.contributes.commands.find((entry) => entry.command === COMMANDS.showAllActions);
		expect(command?.icon).toMatch(/^\$\([a-z-]+\)$/);
		expect(manifest.contributes.menus.commandPalette).toContainEqual({ command: COMMANDS.showAllActions, when: 'false' });
	});
});

describe('the dependency on the manager', () => {
	/** Installing this installs the manager, which owns the board. */
	it('is declared', () => {
		expect(manifest.extensionDependencies).toContain('carlosperate.bbcmicrobit-manager');
	});
});
