import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { BookingNotificationClaim, BookingNotificationRepositoryPort } from "@inkendar/application";
import { normalizeCustomerEmail, normalizeExternalConversationId, normalizeResourceId } from "@inkendar/domain";

type Result = Readonly<{ data: unknown; error: unknown }>;
export interface BookingNotificationDataGateway {
  materializeExpirations(parameters: Readonly<Record<string, unknown>>): Promise<Result>;
  claimNext(parameters: Readonly<Record<string, unknown>>): Promise<Result>;
  transition(parameters: Readonly<Record<string, unknown>>): Promise<Result>;
}

export class SupabaseBookingNotificationGateway implements BookingNotificationDataGateway {
  constructor(private readonly client: SupabaseClient) {}
  materializeExpirations = (parameters: Readonly<Record<string, unknown>>) => this.rpc("materialize_due_booking_expirations", parameters);
  claimNext = (parameters: Readonly<Record<string, unknown>>) => this.rpc("claim_booking_notification_job", parameters);
  transition = (parameters: Readonly<Record<string, unknown>>) => this.rpc("transition_booking_notification_job", parameters);
  private async rpc(name: string, parameters: Readonly<Record<string, unknown>>): Promise<Result> {
    const { data, error } = await this.client.rpc(name, parameters);
    return { data, error };
  }
}

export class SupabaseBookingNotificationError extends Error {
  readonly code = "SUPABASE_BOOKING_NOTIFICATIONS_FAILED";
  constructor() { super("Booking notification persistence failed"); this.name = "SupabaseBookingNotificationError"; }
}

export class SupabaseBookingNotificationRepository implements BookingNotificationRepositoryPort {
  constructor(private readonly data: BookingNotificationDataGateway) {}

  async materializeExpirations(nowUtc: string, limit: number): Promise<number> {
    const result = await this.data.materializeExpirations({ p_now: nowUtc, p_limit: limit });
    if (result.error || typeof result.data !== "number" || !Number.isInteger(result.data) || result.data < 0 || result.data > limit) failed();
    return result.data;
  }

  async claimNext(nowUtc: string, leaseExpiresAt: string): Promise<BookingNotificationClaim> {
    const result = await this.data.claimNext({ p_now: nowUtc, p_lease_expires_at: leaseExpiresAt });
    if (result.error || !Array.isArray(result.data) || result.data.length > 1) failed();
    if (result.data.length === 0) return { kind: "EMPTY" };
    const row = object(result.data[0]);
    const status = string(row.claim_status);
    const jobId = resource(row.job_id);
    if (status === "NO_ROUTE" || status === "UNKNOWN") return { kind: status, jobId };
    if (status !== "CLAIMED") failed();
    const eventType = row.event_type;
    if (eventType !== "CONFIRMED" && eventType !== "EXPIRED" && eventType !== "REJECTED") failed();
    const attemptCount = row.attempt_count;
    if (typeof attemptCount !== "number" || !Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > 3) failed();
    const common = {
      kind: "CLAIMED",
      jobId,
      studioId: resource(row.studio_id),
      eventType,
      attemptCount,
      leaseId: resource(row.lease_id),
    } as const;
    if (row.delivery_channel === "CHATWOOT") {
      return {
        ...common,
        route: {
          kind: "CHATWOOT",
          externalAccountId: external(row.external_account_id),
          externalConversationId: external(row.external_conversation_id),
        },
      };
    }
    if (row.delivery_channel === "EMAIL") {
      return {
        ...common,
        route: { kind: "EMAIL", recipient: email(row.customer_email) },
      };
    }
    failed();
  }

  markSucceeded(jobId: string, leaseId: string, externalMessageId: string, nowUtc: string): Promise<void> {
    return this.transition(jobId, leaseId, "SUCCEEDED", externalMessageId, null, nowUtc);
  }
  markFailed(jobId: string, leaseId: string, nextAttemptAt: string, nowUtc: string): Promise<void> {
    return this.transition(jobId, leaseId, "FAILED", null, nextAttemptAt, nowUtc);
  }
  markUnknown(jobId: string, leaseId: string, nowUtc: string): Promise<void> {
    return this.transition(jobId, leaseId, "UNKNOWN", null, null, nowUtc);
  }
  markNoRoute(jobId: string, leaseId: string, nowUtc: string): Promise<void> {
    return this.transition(jobId, leaseId, "NO_ROUTE", null, null, nowUtc);
  }

  private async transition(jobId: string, leaseId: string, status: "SUCCEEDED" | "FAILED" | "UNKNOWN" | "NO_ROUTE", externalMessageId: string | null, nextAttemptAt: string | null, nowUtc: string): Promise<void> {
    const result = await this.data.transition({
      p_job_id: jobId,
      p_lease_id: leaseId,
      p_status: status,
      p_external_message_id: externalMessageId,
      p_next_attempt_at: nextAttemptAt,
      p_now: nowUtc,
    });
    if (result.error) failed();
  }
}

export function createSupabaseBookingNotificationRepository(environment: Readonly<Record<string, string | undefined>>): SupabaseBookingNotificationRepository {
  const url = environment.SUPABASE_URL?.trim();
  const key = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) failed();
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return new SupabaseBookingNotificationRepository(new SupabaseBookingNotificationGateway(client));
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) failed();
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) failed();
  return value;
}
function resource(value: unknown): string {
  try { return normalizeResourceId("id", string(value)); } catch { failed(); }
}
function external(value: unknown): string {
  try { return normalizeExternalConversationId(string(value)); } catch { failed(); }
}
function email(value: unknown): string {
  try {
    const normalized = normalizeCustomerEmail(string(value));
    if (!normalized) failed();
    return normalized;
  } catch { failed(); }
}
function failed(): never { throw new SupabaseBookingNotificationError(); }
