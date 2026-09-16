import { describe, expect, it, vi } from "vitest";

import { SupabaseBookingNotificationRepository, type BookingNotificationDataGateway } from "./supabase-booking-notifications.js";

function gateway(): BookingNotificationDataGateway {
  return {
    materializeExpirations: vi.fn(async () => ({ data: 2, error: null })),
    claimNext: vi.fn(async () => ({ data: [{ claim_status: "CLAIMED", job_id: "90000000-0000-4000-8000-000000000001", studio_id: "20000000-0000-4000-8000-000000000001", event_type: "CONFIRMED", attempt_count: 1, lease_id: "91000000-0000-4000-8000-000000000001", delivery_channel: "CHATWOOT", external_account_id: "3", external_conversation_id: "42", customer_email: null }], error: null })),
    transition: vi.fn(async () => ({ data: null, error: null })),
  };
}

describe("Supabase booking notifications", () => {
  it("uses bounded service-role RPCs and validates a claimed route", async () => {
    const data = gateway();
    const repository = new SupabaseBookingNotificationRepository(data);
    await expect(repository.materializeExpirations("2026-09-16T10:00:00.000Z", 10)).resolves.toBe(2);
    await expect(repository.claimNext("2026-09-16T10:00:00.000Z", "2026-09-16T10:00:30.000Z")).resolves.toEqual({
      kind: "CLAIMED", jobId: "90000000-0000-4000-8000-000000000001", studioId: "20000000-0000-4000-8000-000000000001", eventType: "CONFIRMED", attemptCount: 1, leaseId: "91000000-0000-4000-8000-000000000001", route: { kind: "CHATWOOT", externalAccountId: "3", externalConversationId: "42" },
    });
    expect(data.materializeExpirations).toHaveBeenCalledWith({ p_now: "2026-09-16T10:00:00.000Z", p_limit: 10 });
    expect(data.claimNext).toHaveBeenCalledWith({ p_now: "2026-09-16T10:00:00.000Z", p_lease_expires_at: "2026-09-16T10:00:30.000Z" });
  });

  it("normalizes an email claim without persisting or returning message content", async () => {
    const data = gateway();
    vi.mocked(data.claimNext).mockResolvedValueOnce({ data: [{
      claim_status: "CLAIMED",
      job_id: "90000000-0000-4000-8000-000000000001",
      studio_id: "20000000-0000-4000-8000-000000000001",
      event_type: "EXPIRED",
      attempt_count: 1,
      lease_id: "91000000-0000-4000-8000-000000000001",
      delivery_channel: "EMAIL",
      external_account_id: null,
      external_conversation_id: null,
      customer_email: "client@example.test",
    }], error: null });
    await expect(new SupabaseBookingNotificationRepository(data).claimNext(
      "2026-09-16T10:00:00.000Z",
      "2026-09-16T10:00:30.000Z",
    )).resolves.toEqual({
      kind: "CLAIMED",
      jobId: "90000000-0000-4000-8000-000000000001",
      studioId: "20000000-0000-4000-8000-000000000001",
      eventType: "EXPIRED",
      attemptCount: 1,
      leaseId: "91000000-0000-4000-8000-000000000001",
      route: { kind: "EMAIL", recipient: "client@example.test" },
    });
  });

  it.each(["EMPTY", "NO_ROUTE", "UNKNOWN"])("normalizes the %s claim state without provider identifiers", async (claimStatus) => {
    const data = gateway();
    vi.mocked(data.claimNext).mockResolvedValueOnce({ data: claimStatus === "EMPTY" ? [] : [{ claim_status: claimStatus, job_id: "90000000-0000-4000-8000-000000000001", studio_id: null, event_type: null, attempt_count: null, lease_id: null, external_account_id: null, external_conversation_id: null }], error: null });
    await expect(new SupabaseBookingNotificationRepository(data).claimNext("2026-09-16T10:00:00.000Z", "2026-09-16T10:00:30.000Z")).resolves.toEqual(claimStatus === "EMPTY" ? { kind: "EMPTY" } : { kind: claimStatus, jobId: "90000000-0000-4000-8000-000000000001" });
  });

  it("transitions only opaque metadata and never message content", async () => {
    const data = gateway();
    const repository = new SupabaseBookingNotificationRepository(data);
    await repository.markSucceeded("90000000-0000-4000-8000-000000000001", "91000000-0000-4000-8000-000000000001", "84", "2026-09-16T10:00:01.000Z");
    expect(data.transition).toHaveBeenCalledWith({ p_job_id: "90000000-0000-4000-8000-000000000001", p_lease_id: "91000000-0000-4000-8000-000000000001", p_status: "SUCCEEDED", p_external_message_id: "84", p_next_attempt_at: null, p_now: "2026-09-16T10:00:01.000Z" });
  });

  it("fails closed on a malformed tenant or route result", async () => {
    const data = gateway();
    vi.mocked(data.claimNext).mockResolvedValueOnce({ data: [{ claim_status: "CLAIMED", job_id: "job", studio_id: "other", event_type: "CONFIRMED", attempt_count: 1, lease_id: "lease", external_account_id: "3", external_conversation_id: "42" }], error: null });
    await expect(new SupabaseBookingNotificationRepository(data).claimNext("2026-09-16T10:00:00.000Z", "2026-09-16T10:00:30.000Z")).rejects.toMatchObject({ code: "SUPABASE_BOOKING_NOTIFICATIONS_FAILED" });
  });
});
