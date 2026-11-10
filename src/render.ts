import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { serveDeck } from "./server";

export const WIDTH = 1080;
export const HEIGHT = 1350;
export const FPS = 30;

const H264 = [
	"-c:v",
	"libx264",
	"-pix_fmt",
	"yuv420p",
	"-crf",
	"18",
	"-preset",
	"slow",
	"-r",
	String(FPS),
	"-movflags",
	"+faststart",
	"-an",
];

type DeckWindow = Window & {
	render: (index: number, seconds: number) => void;
	durations: number[];
};
type Box = { x: number; y: number; w: number; h: number; video: string | null };

export type RenderOptions = {
	/** Output folder. Defaults to `out/` next to the deck. */
	outDir?: string;
	/** Chrome channel or executable for Playwright. Defaults to the installed Chrome. */
	chrome?: { channel?: string; executablePath?: string };
	/** Render only these 1-based slide numbers. */
	only?: number[];
	log?: (line: string) => void;
};

function ffmpeg(args: string[], what: string) {
	const run = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
	if (run.status !== 0) throw new Error(`${what}: ${run.stderr}`);
}

/**
 * Renders every `.slide` of a deck to `slide-NN.mp4` and `slide-NN.png`.
 * - Text slides (`data-dur`): one screenshot per frame of the entrance animation.
 * - Recording slides (`data-video`): the slide is drawn once as a poster and the real
 *   recording is scaled into the measured `.box` with ffmpeg, without re-timing.
 * The PNG is the last frame, for posting as a still card.
 */
export async function renderDeck(
	deckFile: string,
	options: RenderOptions = {},
) {
	const deckPath = resolve(deckFile);
	const outDir = resolve(options.outDir ?? join(dirname(deckPath), "out"));
	const log = options.log ?? console.log;
	mkdirSync(outDir, { recursive: true });

	const server = serveDeck(deckPath);
	const browser = await chromium.launch(
		options.chrome?.executablePath
			? { executablePath: options.chrome.executablePath }
			: { channel: options.chrome?.channel ?? "chrome" },
	);
	const written: string[] = [];
	try {
		const page = await browser.newPage({
			viewport: { width: WIDTH, height: HEIGHT },
			deviceScaleFactor: 1,
		});
		await page.goto(`${server.url}?capture`);
		await page.evaluate(() => document.fonts.ready);
		const durations = await page.evaluate(
			() => (window as unknown as DeckWindow).durations,
		);
		if (!durations?.length) {
			throw new Error(
				`${deckFile}: no .slide found, or runtime/carousel.js not loaded`,
			);
		}

		for (let i = 0; i < durations.length; i++) {
			if (options.only && !options.only.includes(i + 1)) continue;
			const name = `slide-${String(i + 1).padStart(2, "0")}`;
			const png = join(outDir, `${name}.png`);
			const mp4 = join(outDir, `${name}.mp4`);
			await page.evaluate(
				([index]) => (window as unknown as DeckWindow).render(index, 99),
				[i] as const,
			);
			const box: Box = await page.evaluate(
				([index]) => {
					const slide = document.querySelectorAll(".slide")[index];
					const video = slide.getAttribute("data-video");
					const el = slide.querySelector(".box");
					if (!el || !video) return { x: 0, y: 0, w: 0, h: 0, video: null };
					const r = el.getBoundingClientRect();
					el.querySelector("video")?.setAttribute("style", "visibility:hidden");
					return { x: r.x, y: r.y, w: r.width, h: r.height, video };
				},
				[i] as const,
			);
			await page.screenshot({ path: png });

			if (box.video) {
				const graph =
					`[1:v]scale=${box.w}:${box.h}:force_original_aspect_ratio=decrease,setsar=1[rec];` +
					`[0:v][rec]overlay=${box.x}+(${box.w}-w)/2:${box.y}+(${box.h}-h)/2:shortest=1,format=yuv420p[v]`;
				ffmpeg(
					[
						"-loop",
						"1",
						"-framerate",
						String(FPS),
						"-i",
						png,
						"-i",
						join(dirname(deckPath), box.video),
						"-filter_complex",
						graph,
						"-map",
						"[v]",
						...H264,
						mp4,
					],
					name,
				);
				ffmpeg(
					["-sseof", "-0.1", "-i", mp4, "-frames:v", "1", png],
					`${name} poster`,
				);
				log(`${name}: ${box.video} in box`);
			} else {
				const frames = Math.round(durations[i] * FPS);
				if (frames < 1) throw new Error(`${name}: add data-dur or data-video`);
				const ff = spawn("ffmpeg", [
					"-y",
					"-loglevel",
					"error",
					"-f",
					"image2pipe",
					"-framerate",
					String(FPS),
					"-i",
					"-",
					...H264,
					mp4,
				]);
				let stderr = "";
				ff.stderr.on("data", (chunk) => {
					stderr += chunk;
				});
				for (let f = 0; f < frames; f++) {
					await page.evaluate(
						([index, t]) => (window as unknown as DeckWindow).render(index, t),
						[i, f / FPS] as const,
					);
					if (!ff.stdin.write(await page.screenshot({ type: "png" })))
						await once(ff.stdin, "drain");
				}
				ff.stdin.end();
				const [code] = await once(ff, "close");
				if (code !== 0) throw new Error(`${name}: ${stderr}`);
				await page.screenshot({ path: png });
				log(`${name}: ${frames} frames`);
			}
			written.push(name);
		}
	} finally {
		await browser.close();
		server.stop();
	}
	return { outDir, slides: written };
}

/** Writes a 3-column contact sheet of the rendered slides' last frames. */
export function contactSheet(outDir: string, slides: string[], width = 1800) {
	const columns = 3;
	const inputs = slides.flatMap((name) => ["-i", join(outDir, `${name}.png`)]);
	const layout = slides
		.map((_, i) => {
			const x =
				Array.from({ length: i % columns }, (_, c) => `w${c}`).join("+") || "0";
			const y =
				Array.from(
					{ length: Math.floor(i / columns) },
					(_, r) => `h${r * columns}`,
				).join("+") || "0";
			return `${x}_${y}`;
		})
		.join("|");
	const filter =
		slides.length === 1
			? `scale=${width / columns}:-1`
			: `${slides.map((_, i) => `[${i}]`).join("")}xstack=inputs=${slides.length}:layout=${layout}:fill=white,scale=${(width * Math.min(columns, slides.length)) / columns}:-1`;
	const out = join(outDir, "contact-sheet.jpg");
	ffmpeg(
		[...inputs, "-filter_complex", filter, "-q:v", "3", out],
		"contact sheet",
	);
	return out;
}
