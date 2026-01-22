import { execSync } from "child_process";
import { rm } from "fs/promises";

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("Building Next.js application...");
  execSync("npx next build", { stdio: "inherit" });

  console.log("Build completed successfully!");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
