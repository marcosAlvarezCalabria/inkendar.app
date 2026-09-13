import { describe, expect, it, vi } from "vitest";

import { InvalidOnboardingInputError, ProvisioningOutcomeUnknownError } from "@inkendar/application";

import { parseManualOnboardingCommand, runManualOnboarding } from "./manual-onboarding-cli.js";

const environment = {
  INKENDAR_ONBOARDING_PASSWORD: "private-password",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  SUPABASE_URL: "https://project.supabase.co",
};

describe("manual onboarding CLI boundary", () => {
  it("reads the password from the environment for a closed owner command", () => {
    expect(
      parseManualOnboardingCommand(
        [
          "create-studio-owner",
          "--studio-name",
          "North Ink",
          "--display-name",
          "Owner",
          "--email",
          "owner@example.com",
        ],
        environment,
      ),
    ).toMatchObject({
      operation: "create-studio-owner",
      input: { password: "private-password" },
    });
  });

  it.each(["--password", "--role", "--unexpected"])("rejects the unsupported %s option", (option) => {
    expect(() =>
      parseManualOnboardingCommand(
        [
          "add-artist",
          "--studio-id",
          "20000000-0000-4000-8000-000000000001",
          "--display-name",
          "Artist",
          "--email",
          "artist@example.com",
          option,
          "OWNER",
        ],
        environment,
      ),
    ).toThrow(InvalidOnboardingInputError);
  });

  it("reports a missing secret by key without echoing another environment value", () => {
    expect(() =>
      parseManualOnboardingCommand(
        [
          "create-studio-owner",
          "--studio-name",
          "North Ink",
          "--display-name",
          "Owner",
          "--email",
          "owner@example.com",
        ],
        { ...environment, SUPABASE_SERVICE_ROLE_KEY: undefined },
      ),
    ).toThrow("Missing server environment: SUPABASE_SERVICE_ROLE_KEY");
  });

  it("reports intervention and preserves Auth when both RPC responses are lost", async () => {
    const request = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "10000000-0000-4000-8000-000000000001" }), { status: 200 }),
      )
      .mockRejectedValueOnce(new TypeError("response lost after commit"))
      .mockRejectedValueOnce(new TypeError("response lost after commit"));
    vi.stubGlobal("fetch", request);
    const write = vi.fn();

    await expect(
      runManualOnboarding(
        [
          "create-studio-owner",
          "--studio-name",
          "North Ink",
          "--display-name",
          "Owner",
          "--email",
          "owner@example.com",
        ],
        environment,
        write,
      ),
    ).rejects.toBeInstanceOf(ProvisioningOutcomeUnknownError);

    expect(write).toHaveBeenCalledWith(
      JSON.stringify({
        status: "manual-intervention-required",
        code: "PROVISIONING_OUTCOME_UNKNOWN",
        userId: "10000000-0000-4000-8000-000000000001",
      }),
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.some(([url, init]) => init?.method === "DELETE" || url.includes("/auth/v1/admin/users/"))).toBe(
      false,
    );
    vi.unstubAllGlobals();
  });
});
