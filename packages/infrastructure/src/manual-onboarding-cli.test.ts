import { describe, expect, it } from "vitest";

import { InvalidOnboardingInputError } from "@inkendar/application";

import { parseManualOnboardingCommand } from "./manual-onboarding-cli.js";

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
});
