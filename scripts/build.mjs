import { build } from "esbuild";

await build({
  entryPoints: {
    background: "src/background.ts",
    popup: "src/popup.ts",
    options: "src/options.ts",
    consent: "src/consent.ts",
  },
  outdir: ".",
  bundle: true,
  format: "iife",
  target: "firefox140",
  platform: "browser",
  sourcemap: false,
  logLevel: "info",
});
