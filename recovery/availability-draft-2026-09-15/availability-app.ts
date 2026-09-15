import { candidateSlots, validateRules, type AvailabilityRules, type AvailabilitySlot, type BusyInterval } from "@inkendar/domain";
import type { GoogleCalendarConnection, GoogleTokenProtectorPort } from "./google-calendar.js";

export const GOOGLE_FREE_BUSY_SCOPE = "https://www.googleapis.com/auth/calendar.events.freebusy";
export type ArtistAvailabilityConfiguration = Readonly<{ artistProfileId: string; calendarId: string | null; rules: AvailabilityRules | null; connection: GoogleCalendarConnection | null }>;
export interface ArtistAvailabilityRepositoryPort {
  getConfiguration(studioId: string, artistProfileId: string): Promise<ArtistAvailabilityConfiguration>;
  saveRules(studioId: string, artistProfileId: string, rules: AvailabilityRules): Promise<void>;
  markReauthRequired(studioId: string): Promise<void>;
}
export interface GoogleFreeBusyPort { queryBusy(refreshToken: string, input: Readonly<{ calendarId: string; timeMin: string; timeMax: string }>): Promise<readonly BusyInterval[]>; }
export class AvailabilitySetupRequiredError extends Error { constructor(readonly reason: "NO_CALENDAR" | "NO_RULES" | "RECONNECT") { super(reason); } }
export class AvailabilityProviderUnavailableError extends Error {}
export class AvailabilityCredentialInvalidError extends Error {}

export function createArtistAvailabilityService(deps: Readonly<{ repository: ArtistAvailabilityRepositoryPort; provider: GoogleFreeBusyPort; tokens: GoogleTokenProtectorPort }>) {
  return {
    async saveRules(studioId: string, artistProfileId: string, rules: AvailabilityRules): Promise<void> { validateRules(rules); await deps.repository.saveRules(studioId, artistProfileId, rules); },
    async preview(studioId: string, artistProfileId: string, rangeStart: string, rangeEnd: string, durationMinutes: number): Promise<readonly AvailabilitySlot[]> {
      const config = await deps.repository.getConfiguration(studioId, artistProfileId);
      if (!config.calendarId) throw new AvailabilitySetupRequiredError("NO_CALENDAR");
      if (!config.rules) throw new AvailabilitySetupRequiredError("NO_RULES");
      if (!config.connection || config.connection.status !== "ACTIVE" || !config.connection.encryptedRefreshToken || !config.connection.grantedScopes.includes(GOOGLE_FREE_BUSY_SCOPE)) throw new AvailabilitySetupRequiredError("RECONNECT");
      try {
        const busy = await deps.provider.queryBusy(deps.tokens.decrypt(config.connection.encryptedRefreshToken), { calendarId: config.calendarId, timeMin: rangeStart, timeMax: rangeEnd });
        return candidateSlots({ rules: config.rules, rangeStart, rangeEnd, durationMinutes, busy });
      } catch (error) {
        if (error instanceof AvailabilityCredentialInvalidError) { await deps.repository.markReauthRequired(studioId); throw new AvailabilitySetupRequiredError("RECONNECT"); }
        throw new AvailabilityProviderUnavailableError();
      }
    },
  };
}
