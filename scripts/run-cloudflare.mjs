import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const origins = {
  local: "http://127.0.0.1:5173",
  staging: "https://inkendar-staging.calalva82.workers.dev",
  production: "https://inkendar.calalva82.workers.dev",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const common = ["--filter", "@inkendar/app", "exec"];
const buildCommands = [
  ["--filter", "@inkendar/gallery-web-component", "run", "build"],
  [...common, "react-router", "build"],
];

function commandsFor(environment, operation) {
  return operation === "typegen"
    ? [[...common, "wrangler", "types", "worker-configuration.d.ts", "--include-runtime", "false"], [...common, "react-router", "typegen"]]
    : operation === "build"
      ? buildCommands
      : operation === "dev"
        ? [[...common, "react-router", "dev"]]
        : operation === "preview"
          ? [[...common, "vite", "preview"]]
          : operation === "deploy"
            ? [...buildCommands, [...common, "wrangler", "deploy"]]
            : [[...common, "wrangler", "deploy", "--dry-run", "--outdir", `../../dist/cloudflare-${environment}`]];
}

export function runCloudflare({
  environment,
  operation,
  packageManager = process.env.npm_execpath,
  execPath = process.execPath,
  spawn = spawnSync,
} = {}) {
  if (!(Object.hasOwn(origins, environment) && ["build", "deploy", "dev", "dry-run", "preview", "typegen"].includes(operation))) {
    throw new Error("Usage: run-cloudflare.mjs <local|production|staging> <build|deploy|dev|dry-run|preview|typegen>");
  }
  if (!packageManager) throw new Error("This command must run through pnpm");

  const packageManagerIsExecutable = packageManager.toLowerCase().endsWith(".exe");
  const executable = packageManagerIsExecutable ? packageManager : execPath;

  for (const args of commandsFor(environment, operation)) {
    const childArguments = packageManagerIsExecutable ? args : [packageManager, ...args];
    const result = spawn(executable, childArguments, {
      cwd: root,
      env: {
        ...process.env,
        ...(environment === "local" ? {} : { CLOUDFLARE_ENV: environment }),
        INKENDAR_APP_ORIGIN: origins[environment],
      },
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) return result.status ?? 1;
  }

  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [environment, operation] = process.argv.slice(2);
  const status = runCloudflare({ environment, operation });
  if (status !== 0) process.exit(status);
}
