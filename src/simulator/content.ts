/**
 * Upstream's `simulator.html` is the webview document itself. One block goes in
 * at `<head>` and nothing else in the file is touched, so an upstream bump
 * brings its own markup rather than a fork of ours.
 */

export interface DocumentUris {
	/** The folder holding simulator.html. Upstream loads its scripts relative to it. */
	assets: string;
	/** Our shell bundle. */
	script: string;
	/** `webview.cspSource`. */
	cspSource: string;
}

/**
 * `'wasm-unsafe-eval'` or the board renders and never runs, saying nothing but
 * `still waiting on run dependencies`. `connect-src` or the wasm never fetches.
 * No nonce anywhere: Chromium ignores `'unsafe-inline'` once one is present, and
 * the board SVG is built on `style` attributes that are refused without it.
 */
function contentSecurityPolicy(cspSource: string): string {
	return [
		`default-src 'none'`,
		`script-src ${cspSource} 'wasm-unsafe-eval'`,
		`style-src ${cspSource} 'unsafe-inline'`,
		`connect-src ${cspSource}`,
		`img-src ${cspSource} data:`,
		`media-src ${cspSource} data:`,
	].join('; ');
}

/**
 * The tags cannot be written into the committed file: `asWebviewUri` yields a
 * different URL per webview and per host, and `cspSource` varies with it.
 */
export function simulatorDocument(upstream: string, uris: DocumentUris): string {
	// The trailing `\s` or `>` is what keeps this off `<header>`.
	const opens = upstream.match(/<head(\s[^>]*)?>/gi) ?? [];
	if (opens.length !== 1) {
		throw new Error(`simulator.html must have exactly one <head>, found ${opens.length}`);
	}

	// The base is what makes upstream's relative `build/` scripts and its wasm
	// fetch resolve; the script is blocking and first, so its prelude runs before
	// upstream's own scripts.
	const block = [
		`<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(uris.cspSource)}">`,
		`<base href="${uris.assets}/">`,
		`<script src="${uris.script}"></script>`,
	].join('\n    ');

	return upstream.replace(opens[0], `${opens[0]}\n    ${block}`);
}
