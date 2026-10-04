import { describe, expect, it, vi } from "vitest";

import { runCloudflare } from "./run-cloudflare.mjs";

describe("Cloudflare command runner", () => {
  it.each([
    ["staging", "https://inkendar-staging.calalva82.workers.dev"],
    ["production", "https://inkendar.calalva82.workers.dev"],
  ])("rebuilds the %s artifact immediately before deploying it", (environment, origin) => {
    const spawn = vi.fn(() => ({ status: 0 }));

    const status = runCloudflare({
      environment,
      operation: "deploy",
      packageManager: "C:\\tools\\pnpm.cjs",
      execPath: "C:\\node\\node.exe",
      spawn,
    });

    expect(status).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(spawn.mock.calls.map(([, args]) => args)).toEqual([
      ["C:\\tools\\pnpm.cjs", "--filter", "@inkendar/gallery-web-component", "run", "build"],
      ["C:\\tools\\pnpm.cjs", "--filter", "@inkendar/app", "exec", "react-router", "build"],
      ["C:\\tools\\pnpm.cjs", "--filter", "@inkendar/app", "exec", "wrangler", "deploy"],
    ]);
    for (const [, , options] of spawn.mock.calls) {
      expect(options).toMatchObject({
        env: {
          CLOUDFLARE_ENV: environment,
          INKENDAR_APP_ORIGIN: origin,
        },
        stdio: "inherit",
      });
    }
  });

  it("does not deploy when the environment-specific build fails", () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 });

    const status = runCloudflare({
      environment: "staging",
      operation: "deploy",
      packageManager: "C:\\tools\\pnpm.cjs",
      execPath: "C:\\node\\node.exe",
      spawn,
    });

    expect(status).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
