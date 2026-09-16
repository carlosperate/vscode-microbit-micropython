/**
 * Two glyphs from Microsoft's Codicons, the set the workbench draws in welcome
 * content, so this row matches the manager's buttons. Inlined because a webview
 * cannot reach the workbench's icon font; kept as the unchanged `.svg` files,
 * which esbuild folds in as text. CC BY 4.0, credited in the README.
 */
import terminal from './terminal.svg';
import zap from './zap.svg';

/** `$(zap)`, which the font aliases to `symbol-event`. */
export const ZAP = zap;

/** `$(terminal)`. */
export const TERMINAL = terminal;

/** Decorative: the button's text is the label, so the glyph is hidden from readers and sized by CSS. */
export function icon(markup: string): Element {
	const holder = document.createElement('span');
	holder.innerHTML = markup;
	const svg = holder.firstElementChild ?? holder;
	svg.removeAttribute('width');
	svg.removeAttribute('height');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('icon');
	return svg;
}
