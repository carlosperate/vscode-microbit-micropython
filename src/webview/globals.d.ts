/** Injected by VS Code into every webview document. */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

/** esbuild's text loader, so the stylesheet stays a real file to edit and diff. */
declare module '*.css' {
	const css: string;
	export default css;
}

/** The same loader for the icon glyphs, kept as the unchanged files they were copied from. */
declare module '*.svg' {
	const markup: string;
	export default markup;
}
