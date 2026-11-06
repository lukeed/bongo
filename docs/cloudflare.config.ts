import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "bongo-docs",
		compatibilityDate: "2026-10-13",
		entrypoint: "./worker.ts",
		assets: {
			htmlHandling: "auto-trailing-slash",
			notFoundHandling: "404-page",
			// crowne.io analytics, proxied on paths of this site; every other path is a static asset
			runWorkerFirst: [
				"/x/script.js",
				"/x",
			],
		},
		domains: [
			"bongo.build",
		],
		env: {
			CROWNE_SITE: bindings.text("01M5X84FC4ZH0GC4AJ6DDKVN7J"),
			CROWNE_KEY: bindings.secret(),
			ASSETS: bindings.assets(),
		},
	},
});
