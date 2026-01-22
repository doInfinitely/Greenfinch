import { execSync } from "child_process";
import { rm, mkdir } from "fs/promises";
import { build } from "esbuild";

async function buildAll() {
  await rm("dist", { recursive: true, force: true });
  await mkdir("dist", { recursive: true });

  console.log("Building Next.js application...");
  execSync("npx next build", { stdio: "inherit" });

  console.log("Bundling server for production...");
  await build({
    entryPoints: ["server/index.ts"],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile: "dist/index.cjs",
    external: [
      "next",
      "react",
      "react-dom",
    ],
    minify: true,
  });

  console.log("Build completed successfully!");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
