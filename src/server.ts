import { existsSync, statSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";

/** Package root: `runtime/` and `layouts/` are served from here under `/_mc/`. */
export const PACKAGE_ROOT = resolve(import.meta.dir, "..");

function within(root: string, path: string) {
	return path === root || path.startsWith(root + sep);
}

function resolveFile(root: string, urlPath: string) {
	const path = normalize(join(root, decodeURIComponent(urlPath)));
	if (!within(root, path) || !existsSync(path) || !statSync(path).isFile())
		return null;
	return path;
}

export type DeckServer = { url: string; stop: () => void };

/**
 * Serves the deck's folder at `/` and this package at `/_mc/` on 127.0.0.1. A server
 * (not file://) lets decks share one runtime and layout, and lets Chrome load fonts,
 * SVG masks and videos without file-URL restrictions.
 */
export function serveDeck(deckFile: string, port = 0): DeckServer {
	const deckRoot = dirname(resolve(deckFile));
	const deckName = resolve(deckFile).slice(deckRoot.length + 1);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port,
		fetch(request) {
			const { pathname } = new URL(request.url);
			const path = pathname.startsWith("/_mc/")
				? resolveFile(PACKAGE_ROOT, pathname.slice("/_mc".length))
				: resolveFile(deckRoot, pathname === "/" ? `/${deckName}` : pathname);
			if (!path) return new Response("Not found", { status: 404 });
			// Bun.file handles Range requests, which <video> needs for seeking.
			return new Response(Bun.file(path));
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}/${encodeURIComponent(deckName)}`,
		stop: () => {
			void server.stop(true);
		},
	};
}
