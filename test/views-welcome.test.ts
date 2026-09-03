import { describe, expect, it } from 'vitest';

import manifest from '../package.json';
import { CAN_PAIR_CONTEXT, COMMANDS, DEVICE_VIEW_ID } from '../src/config';

/**
 * The device section is welcome content, so everything about it is strings in the
 * manifest that VS Code interprets: a view id, command links and context keys. A
 * typo in any of them shows nothing and says nothing, which is why they are
 * checked against the code here.
 */
const views = manifest.contributes.views['bbcmicrobit-micropython'];
const blocks = manifest.contributes.viewsWelcome;
const commandIds = new Set(manifest.contributes.commands.map((command) => command.command));
const contextKeys = new Set([CAN_PAIR_CONTEXT]);

const links = (contents: string) => [...contents.matchAll(/\]\(command:([^)]+)\)/g)].map((match) => match[1]);
const lines = (contents: string) => contents.split('\n').map((line) => line.trim()).filter(Boolean);
/** A line that is one link and nothing else is what VS Code renders as a button. */
const isButton = (line: string) => /^\[[^\]]+\]\(command:[^)]+\)$/.test(line);

describe('the device section', () => {
	it('comes first in the container, above the simulator', () => {
		expect(views[0]?.id).toBe(DEVICE_VIEW_ID);
		expect(views[1]?.type).toBe('webview');
	});

	/**
	 * `initialSize` is a weight. A small one against a large one clamps the device
	 * pane to VS Code's minimum body height, which is what its content needs, and
	 * leaves the rest of the sidebar to the board.
	 */
	it('asks for almost no height, so the simulator starts under the buttons', () => {
		expect(views[0]?.initialSize).toBeGreaterThan(0);
		expect(views[1]?.initialSize).toBeGreaterThanOrEqual(views[0]!.initialSize * 5);
	});

	it('is welcome content over a view that exists', () => {
		expect(blocks.length).toBeGreaterThan(0);
		const viewIds = new Set(views.map((view) => view.id));
		for (const block of blocks) expect(viewIds, block.contents).toContain(block.view);
	});

	/**
	 * `group` is a proposed property: using it makes VS Code show a warning naming
	 * this extension at every activation. Order comes from manifest order instead.
	 */
	it('uses only the properties the stable extension point accepts', () => {
		for (const block of blocks) {
			expect(Object.keys(block).sort(), block.contents).toEqual(
				['contents', 'view', ...('when' in block ? ['when'] : [])].sort()
			);
		}
	});

	/**
	 * Pane headers are rendered with `text-transform: capitalize`, which turns
	 * `micro:bit` into `Micro:Bit`, so a view name has to read right capitalised.
	 */
	it('names the views so that capitalising them changes nothing', () => {
		for (const view of views) {
			const capitalised = view.name.replace(/(^|[^a-z])([a-z])/gi, (_, before: string, letter: string) => `${before}${letter.toUpperCase()}`);
			expect(capitalised, view.id).toBe(view.name);
		}
	});

	it('links only to commands the manifest contributes', () => {
		const linked = blocks.flatMap((block) => links(block.contents));
		expect(linked.length).toBeGreaterThan(0);
		for (const id of linked) expect(commandIds).toContain(id);
	});

	/** Nothing is keyed today; a block that becomes keyed may only use a key the code sets. */
	it('switches on context keys this extension sets, and nothing else', () => {
		for (const block of blocks) {
			const when = 'when' in block ? String(block.when) : undefined;
			if (!when) continue;
			const keys = when.replace(/[!()]|&&|\|\|/g, ' ').split(/\s+/).filter(Boolean);
			expect(keys.length, when).toBeGreaterThan(0);
			for (const key of keys) expect(contextKeys, when).toContain(key);
		}
	});

	it('makes Flash and Serial Terminal the buttons, and the rest links in text', () => {
		const buttons = blocks.flatMap((block) => lines(block.contents).filter(isButton));
		expect(buttons.map((line) => links(line)[0])).toEqual([COMMANDS.flash, COMMANDS.openTerminal]);
	});

	/**
	 * A tree pane's body cannot go below 120 px, and the welcome view spends 1em
	 * above every line and 1em below the last. Two buttons fit; a third line runs
	 * two pixels over on web and the pane grows a scrollbar for its own padding.
	 */
	it('is two lines, which is all the smallest pane can hold without scrolling', () => {
		expect(blocks.flatMap((block) => lines(block.contents))).toHaveLength(2);
	});

	it('spells every codicon the way the renderer reads it', () => {
		for (const block of blocks) {
			for (const [, name] of block.contents.matchAll(/\$\(([^)]*)\)/g)) expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
		}
	});
});

/**
 * "See all options" is an icon in the section header rather than a third line,
 * because a third line puts the pane two pixels over its 120 px minimum body and
 * it grows a scrollbar. The header action is manifest strings too: a menu item, the
 * command it names, and the palette entry that hides that command.
 */
describe('the device section header', () => {
	const item = manifest.contributes.menus['view/title'].find((entry) => entry.command === COMMANDS.showMenu);
	const command = manifest.contributes.commands.find((entry) => entry.command === COMMANDS.showMenu);

	it('carries the menu command as an icon on the device view only', () => {
		expect(item?.when).toBe(`view == ${DEVICE_VIEW_ID}`);
		expect(item?.group).toBe('navigation');
		expect(command?.icon).toMatch(/^\$\([a-z][a-z0-9-]*\)$/);
	});

	it('keeps that command out of the palette, which already lists what it opens', () => {
		const hidden = manifest.contributes.menus.commandPalette.find((entry) => entry.command === COMMANDS.showMenu);
		expect(hidden?.when).toBe('false');
	});
});
