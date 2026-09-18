import type * as vscode from 'vscode';
import { expect, it } from 'vitest';

import manifest from '../package.json';
import { CONTAINER_ID, PRODUCT } from '../src/config';
import { menuGroup } from '../src/manager/menu';

const group = menuGroup({ extension: { packageJSON: manifest } } as unknown as vscode.ExtensionContext);

it('lists its commands under the product name, titled as the palette titles them', () => {
	const titles = new Map(manifest.contributes.commands.map((entry) => [entry.command, entry.title]));
	expect(group.label).toBe(PRODUCT);
	for (const { command, label } of group.commands) expect(label, command).toBe(titles.get(command));
});

/** The manager refuses a whole group whose sidebar names no view, so this is what keeps the menu there. */
it('offers its own container and every view in it, for the manager to combine', () => {
	expect(group.sidebar).toEqual({
		container: CONTAINER_ID,
		views: manifest.contributes.views[CONTAINER_ID].map((view) => view.id),
	});
	expect(group.sidebar?.views.length).toBeGreaterThan(0);
});
