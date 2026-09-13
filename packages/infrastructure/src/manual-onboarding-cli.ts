import {
  InvalidOnboardingInputError,
  ProvisioningCompensationFailedError,
  createManualOnboardingService,
  type AddArtistInput,
  type CreateStudioOwnerInput,
} from "@inkendar/application";

import { SupabaseManualOnboardingAdapter } from "./supabase-manual-onboarding.js";

type Environment = Readonly<Record<string, string | undefined>>;

type ManualOnboardingCommand =
  | Readonly<{
      operation: "create-studio-owner";
      input: CreateStudioOwnerInput;
      supabaseUrl: string;
      serviceRoleKey: string;
    }>
  | Readonly<{
      operation: "add-artist";
      input: AddArtistInput;
      supabaseUrl: string;
      serviceRoleKey: string;
    }>;

const COMMON_OPTIONS = new Set(["--display-name", "--email"]);

export function parseManualOnboardingCommand(args: readonly string[], environment: Environment): ManualOnboardingCommand {
  const [operation, ...optionArgs] = args;
  const serviceRoleKey = requireEnvironment(environment, "SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = requireEnvironment(environment, "SUPABASE_URL");
  const password = requireEnvironment(environment, "INKENDAR_ONBOARDING_PASSWORD");

  if (operation === "create-studio-owner") {
    const options = parseOptions(optionArgs, new Set([...COMMON_OPTIONS, "--studio-name"]));
    return {
      operation,
      serviceRoleKey,
      supabaseUrl,
      input: {
        studioName: requireOption(options, "--studio-name"),
        displayName: requireOption(options, "--display-name"),
        email: requireOption(options, "--email"),
        password,
      },
    };
  }

  if (operation === "add-artist") {
    const options = parseOptions(optionArgs, new Set([...COMMON_OPTIONS, "--studio-id"]));
    return {
      operation,
      serviceRoleKey,
      supabaseUrl,
      input: {
        studioId: requireOption(options, "--studio-id"),
        displayName: requireOption(options, "--display-name"),
        email: requireOption(options, "--email"),
        password,
      },
    };
  }

  throw invalidCommand();
}

export async function runManualOnboarding(
  args: readonly string[],
  environment: Environment,
  write: (message: string) => void,
): Promise<void> {
  const command = parseManualOnboardingCommand(args, environment);
  const adapter = new SupabaseManualOnboardingAdapter(command);
  const onboarding = createManualOnboardingService({ identity: adapter, repository: adapter });

  try {
    const result =
      command.operation === "create-studio-owner"
        ? await onboarding.createStudioOwner(command.input)
        : await onboarding.addArtist(command.input);
    write(JSON.stringify({ status: "created", operation: command.operation, ...result }));
  } catch (error: unknown) {
    if (error instanceof ProvisioningCompensationFailedError) {
      write(JSON.stringify({ status: "manual-intervention-required", code: error.code, userId: error.userId }));
    }
    throw error;
  }
}

function requireEnvironment(environment: Environment, key: string): string {
  const value = environment[key];
  if (!value) throw new Error(`Missing server environment: ${key}`);
  return value;
}

function parseOptions(args: readonly string[], allowed: ReadonlySet<string>): Map<string, string> {
  if (args.length % 2 !== 0) throw invalidCommand();
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key || !value || !allowed.has(key) || options.has(key)) throw invalidCommand();
    options.set(key, value);
  }
  return options;
}

function requireOption(options: ReadonlyMap<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) throw invalidCommand();
  return value;
}

function invalidCommand(): InvalidOnboardingInputError {
  return new InvalidOnboardingInputError("command");
}
