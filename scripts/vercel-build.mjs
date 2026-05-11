import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const localPnpm = path.join(root, ".tools", "package", "bin", "pnpm.cjs");
const pnpmCommand = existsSync(localPnpm) ? [process.execPath, localPnpm] : ["pnpm"];

const build = spawnSync(pnpmCommand[0], [...pnpmCommand.slice(1), "--filter", "@taiwan-live-cam/web", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: false
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const source = path.join(root, "apps", "web", "dist");
const target = path.join(root, "dist");

if (!existsSync(source)) {
  console.error(`Expected web build output at ${source}`);
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });

console.log(`Copied Vite output from ${path.relative(root, source)} to ${path.relative(root, target)}`);
