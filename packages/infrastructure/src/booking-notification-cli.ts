import {
  ConversationProviderUnavailableError,
  InvalidBookingNotificationInputError,
  createBookingNotificationRunner,
  type ConversationProviderPort,
} from "@inkendar/application";

import { ChatwootConversationAdapter, ChatwootConnections } from "./chatwoot-conversations.js";
import { createSmtpBookingNotificationProviderFactory } from "./smtp-booking-notifications.js";
import { createSupabaseBookingNotificationRepository } from "./supabase-booking-notifications.js";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type Route = Readonly<{ studioId: string; externalAccountId: string; externalConversationId: string }>;
type Options = Readonly<{ batchSize: number; leaseSeconds: number; timeBudgetMs: number }>;

const DEFAULTS: Options = { batchSize: 25, leaseSeconds: 60, timeBudgetMs: 20_000 };
export const SMTP_CONNECTIONS_ENVIRONMENT_VARIABLE = "INKENDAR_SMTP_CONNECTIONS_JSON";
const OPTION_NAMES = new Map<string, keyof Options>([
  ["--batch-size", "batchSize"],
  ["--lease-seconds", "leaseSeconds"],
  ["--time-budget-ms", "timeBudgetMs"],
]);

export function parseBookingNotificationSchedulerCommand(args: readonly string[]): Options {
  if (args.length % 2 !== 0) invalid();
  const parsed = { ...DEFAULTS };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const rawValue = args[index + 1];
    const property = option === undefined ? undefined : OPTION_NAMES.get(option);
    if (!option || !rawValue || !property || seen.has(option) || !/^[0-9]+$/.test(rawValue)) invalid();
    const value = Number(rawValue);
    if (!Number.isSafeInteger(value)) invalid();
    parsed[property] = value;
    seen.add(option);
  }
  if (parsed.batchSize < 1 || parsed.batchSize > 100
    || parsed.leaseSeconds < 10 || parsed.leaseSeconds > 300
    || parsed.timeBudgetMs < 1_000 || parsed.timeBudgetMs > 30_000) invalid();
  return parsed;
}

export function createChatwootNotificationProviderFactory(serializedConnections: string | undefined, fetcher: Fetch = globalThis.fetch.bind(globalThis)): (route: Route) => ConversationProviderPort {
  const connections = new ChatwootConnections(serializedConnections);
  return (route) => {
    const connection = connections.forStudio(route.studioId);
    if (!connection || connection.accountId !== route.externalAccountId) invalidProvider();
    return new ChatwootConversationAdapter(connection, fetcher);
  };
}

export async function runBookingNotificationScheduler(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  write: (message: string) => void,
): Promise<void> {
  const options = parseBookingNotificationSchedulerCommand(args);
  const repository = createSupabaseBookingNotificationRepository(environment);
  const providerFor = createChatwootNotificationProviderFactory(environment.INKENDAR_CHATWOOT_CONNECTIONS_JSON);
  const emailProviderFor = createSmtpBookingNotificationProviderFactory(
    environment[SMTP_CONNECTIONS_ENVIRONMENT_VARIABLE],
  );
  const summary = await createBookingNotificationRunner({ repository, providerFor, emailProviderFor }).run(options);
  write(JSON.stringify({ status: "completed", ...summary }));
}

function invalid(): never { throw new InvalidBookingNotificationInputError(); }
function invalidProvider(): never { throw new ConversationProviderUnavailableError(); }
