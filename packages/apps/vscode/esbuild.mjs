import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const config = {
  bundle: true,
  entryPoints: ["src/extension.ts"],
  external: ["vscode"],
  format: "cjs",
  minify: production,
  outfile: "dist/extension.cjs",
  platform: "node",
  sourcemap: !production,
  target: "node24",
};

if (watch) {
  const context = await esbuild.context(config);
  await context.watch();
  console.log("Watching VSCode extension bundle...");
} else {
  await esbuild.build(config);
}
