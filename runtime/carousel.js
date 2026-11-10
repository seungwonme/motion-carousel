// motion-carousel deck runtime. Load it after the slides:
//   <script>window.CAROUSEL = { brand: { name: "Acme", logo: { onLight: "assets/logo-black.png", onDark: "assets/logo-white.png" } } };</script>
//   <script src="/_mc/runtime/carousel.js"></script>
//
// - Every `.slide` is one 1080x1350 card. `data-dur="5"` makes a text slide a 5 s clip;
//   `data-video="rec/clip.mp4"` overlays that recording into the slide's `.box`.
// - Elements with `data-in="0.4"` fade and rise in, starting 0.4 s into the slide.
// - Slides get a top bar (brand + `NN / NN` counter) unless they have `data-noframe`.
// - `<span data-icon="star">` is filled from `<template id="icon-star">`.
// - URL: `?s=3` shows slide 3, `?preview` shows a grid, `?capture` is used by the renderer.
(() => {
	const config = window.CAROUSEL ?? {};

	for (const el of document.querySelectorAll("[data-icon]")) {
		const template = document.getElementById(`icon-${el.dataset.icon}`);
		if (template) el.replaceChildren(template.content.cloneNode(true));
	}

	const slides = [...document.querySelectorAll(".slide")];
	const pad = (n) => String(n).padStart(2, "0");

	slides.forEach((slide, i) => {
		if (slide.hasAttribute("data-noframe")) return;
		const top = document.createElement("div");
		top.className = "top";
		const brand = document.createElement("span");
		brand.className = "brand";
		const logo =
			config.brand?.logo?.[
				slide.classList.contains("dark") ? "onDark" : "onLight"
			];
		if (logo) {
			const img = document.createElement("img");
			img.src = logo;
			img.alt = "";
			brand.append(img);
		}
		brand.append(config.brand?.name ?? "");
		const count = document.createElement("span");
		count.className = "count";
		count.textContent = `${pad(i + 1)} / ${pad(slides.length)}`;
		top.append(brand, count);
		slide.prepend(top);
	});

	const easeOut = (t) => 1 - (1 - Math.max(0, Math.min(1, t))) ** 3;

	/** Draws slide `i` at `t` seconds into its entrance animation. */
	window.render = (i, t) => {
		slides.forEach((slide, j) => {
			slide.classList.toggle("on", j === i);
		});
		for (const el of slides[i].querySelectorAll("[data-in]")) {
			const p = easeOut((t - Number(el.dataset.in)) / 0.8);
			el.style.opacity = p;
			el.style.transform = p >= 1 ? "" : `translateY(${(1 - p) * 20}px)`;
		}
	};
	window.durations = slides.map((slide) => Number(slide.dataset.dur || 0));

	const playVideos = () => {
		for (const video of document.querySelectorAll("video")) {
			video.loop = true;
			void video.play();
		}
	};
	const query = new URLSearchParams(location.search);
	if (query.has("preview")) {
		document.body.classList.add("preview");
		slides.forEach((_, i) => {
			window.render(i, 99);
		});
		for (const slide of slides) slide.classList.add("on");
		playVideos();
	} else if (!query.has("capture")) {
		window.render(Number(query.get("s") || 1) - 1, 99);
		playVideos();
	}
})();
