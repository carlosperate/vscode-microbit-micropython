/** Injected by VS Code into every webview document. */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

/** esbuild's text loader, so the stylesheet stays a real file to edit and diff. */
declare module '*.css' {
	const css: string;
	export default css;
}
