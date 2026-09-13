import { runManualOnboarding } from "../packages/infrastructure/src/manual-onboarding-cli.js";

try {
  await runManualOnboarding(process.argv.slice(2), process.env, (message) => process.stdout.write(`${message}\n`));
} catch (error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "MANUAL_ONBOARDING_FAILED";
  process.stderr.write(`${JSON.stringify({ status: "failed", code })}\n`);
  process.exitCode = 1;
}
