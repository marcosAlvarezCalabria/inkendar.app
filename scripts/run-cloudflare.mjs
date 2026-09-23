import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [environment, operation] = process.argv.slice(2);
if (!(["local", "production", "staging"].includes(environment) && ["build", "deploy", "dev", "dry-run", "preview", "typegen"].includes(operation))) {
  throw new Error("Usage: run-cloudflare.mjs <local|production|staging> <build|deploy|dev|dry-run|preview|typegen>");
}
const origins = {
  local: "http://127.0.0.1:5173",
  staging: "https://inkendar-staging.calalva82.workers.dev",
  production: "https://inkendar.calalva82.workers.dev",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageManager = process.env.npm_execpath;
if (!packageManager) throw new Error("This command must run through pnpm");
const packageManagerIsExecutable = packageManager.toLowerCase().endsWith(".exe");
const executable = packageManagerIsExecutable ? packageManager : process.execPath;
const common = ["--filter", "@inkendar/app", "exec"];
const commands = operation === "typegen"
  ? [[...common, "wrangler", "types", "worker-configuration.d.ts", "--include-runtime", "false"], [...common, "react-router", "typegen"]]
  : operation === "build"
  ? [
      ["--filter", "@inkendar/gallery-web-component", "run", "build"],
      [...common, "react-router", "build"],
    ]
  : operation === "dev"
    ? [[...common, "react-router", "dev"]]
    : operation === "preview"
      ? [[...common, "vite", "preview"]]
  : operation === "deploy"
    ? [[...common, "wrangler", "deploy"]]
    : [[...common, "wrangler", "deploy", "--dry-run", "--outdir", `../../dist/cloudflare-${environment}`]];

for (const args of commands) {
  const childArguments = packageManagerIsExecutable ? args : [packageManager, ...args];
  const result = spawnSync(executable, childArguments, {
    cwd: root,
    env: {
      ...process.env,
      ...(environment === "local" ? {} : { CLOUDFLARE_ENV: environment }),
      INKENDAR_APP_ORIGIN: origins[environment],
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
