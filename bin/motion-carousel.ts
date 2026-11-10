#!/usr/bin/env bun
import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { contactSheet, renderDeck } from "../src/render";
import { PACKAGE_ROOT, serveDeck } from "../src/server";

const HELP = `motion-carousel: HTML deck -> 1080x1350 MP4 + PNG slides

Usage:
  motion-carousel render <deck.html> [--out <dir>] [--only 2,5] [--chrome <path>]
  motion-carousel preview <deck.html> [--port 4321]
  motion-carousel new <dir>

render   Writes slide-NN.mp4, slide-NN.png and contact-sheet.jpg (default: out/ next to the deck).
preview  Serves the deck. Open the printed URL; add ?s=3 for one slide or ?preview for a grid.
new      Copies the starter deck (examples/basic) into <dir>.

Needs Google Chrome (or --chrome <executable>) and ffmpeg on PATH.`;

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		out: { type: "string" },
		only: { type: "string" },
		chrome: { type: "string" },
		port: { type: "string" },
		help: { type: "boolean", short: "h" },
	},
});
const [command, target] = positionals;

function fail(message: string): never {
	console.error(`${message}\n\n${HELP}`);
	process.exit(1);
}

if (values.help || !command) {
	console.log(HELP);
	process.exit(0);
}

if (command === "new") {
	if (!target) fail("new: give a folder name");
	const dest = resolve(target);
	if (existsSync(dest)) fail(`new: ${dest} already exists`);
	cpSync(join(PACKAGE_ROOT, "examples/basic"), dest, {
		recursive: true,
		filter: (src) => !src.split(/[\\/]/).includes("out"),
	});
	console.log(
		`Created ${dest}\nNext: motion-carousel preview ${join(target, "deck.html")}`,
	);
} else if (command === "preview") {
	if (!target || !existsSync(target)) fail("preview: deck file not found");
	const server = serveDeck(target, Number(values.port ?? 4321));
	console.log(`${server.url}\n${server.url}?preview\nCtrl+C to stop.`);
} else if (command === "render") {
	if (!target || !existsSync(target)) fail("render: deck file not found");
	for (const tool of ["ffmpeg"]) {
		if (!Bun.which(tool)) fail(`render: ${tool} not found on PATH`);
	}
	const only = values.only?.split(",").map(Number).filter(Number.isInteger);
	const { outDir, slides } = await renderDeck(target, {
		outDir: values.out,
		only,
		chrome: values.chrome ? { executablePath: values.chrome } : undefined,
	});
	if (!only && slides.length) {
		console.log(`contact sheet: ${contactSheet(outDir, slides)}`);
	}
	console.log(`done: ${slides.length} slides in ${outDir}`);
} else {
	fail(`unknown command: ${command}`);
}
