import { candidateSlots, validateAvailabilityPreview, validateRules, type AvailabilityRules, type AvailabilitySlot, type BusyInterval } from "@inkendar/domain";
import type { GoogleCalendarConnection, GoogleTokenProtectorPort } from "./google-calendar.js";

export const GOOGLE_FREE_BUSY_SCOPE = "https://www.googleapis.com/auth/calendar.events.freebusy";
export type ArtistAvailabilityConfiguration = Readonly<{ artistProfileId: string; calendarId: string | null; rules: AvailabilityRules | null; connection: GoogleCalendarConnection | null }>;
export interface ArtistAvailabilityRepositoryPort {
  getConfiguration(studioId: string, artistProfileId: string): Promise<ArtistAvailabilityConfiguration>;
  saveRules(studioId: string, artistProfileId: string, rules: AvailabilityRules): Promise<void>;
  markReauthRequired(studioId: string, credentialGeneration: number): Promise<void>;
  listActiveHolds(studioId: string, artistProfileId: string, rangeStart: string, rangeEnd: string, nowUtc: string): Promise<readonly BusyInterval[]>;
}
export interface GoogleFreeBusyPort { queryBusy(refreshToken: string, input: Readonly<{ calendarId: string; timeMin: string; timeMax: string }>): Promise<readonly BusyInterval[]>; }
export class AvailabilitySetupRequiredError extends Error { constructor(readonly reason: "NO_CALENDAR" | "NO_RULES" | "RECONNECT") { super(reason); } }
export class AvailabilityProviderUnavailableError extends Error {}
export class AvailabilityCredentialInvalidError extends Error {}

export function createArtistAvailabilityService(deps: Readonly<{ repository: ArtistAvailabilityRepositoryPort; provider: GoogleFreeBusyPort; tokens: GoogleTokenProtectorPort }>) {
  return {
    async getRules(studioId: string, artistProfileId: string): Promise<AvailabilityRules | null> { return (await deps.repository.getConfiguration(studioId, artistProfileId)).rules; },
    async saveRules(studioId: string, artistProfileId: string, rules: AvailabilityRules): Promise<void> { validateRules(rules); await deps.repository.saveRules(studioId, artistProfileId, rules); },
    async preview(studioId: string, artistProfileId: string, rangeStart: string, rangeEnd: string, durationMinutes: number): Promise<readonly AvailabilitySlot[]> {
      const config = await deps.repository.getConfiguration(studioId, artistProfileId);
      if (!config.rules) throw new AvailabilitySetupRequiredError("NO_RULES");
      validateAvailabilityPreview({ rules: config.rules, rangeStart, rangeEnd, durationMinutes });
      if (!config.calendarId) throw new AvailabilitySetupRequiredError("NO_CALENDAR");
      if (!config.connection || config.connection.status !== "ACTIVE" || !config.connection.encryptedRefreshToken || !config.connection.grantedScopes.includes(GOOGLE_FREE_BUSY_SCOPE)) throw new AvailabilitySetupRequiredError("RECONNECT");
      let busy: readonly BusyInterval[];
      try {
        busy = await deps.provider.queryBusy(deps.tokens.decrypt(config.connection.encryptedRefreshToken), { calendarId: config.calendarId, timeMin: rangeStart, timeMax: rangeEnd });
      } catch (error) {
        if (error instanceof AvailabilityCredentialInvalidError) { await deps.repository.markReauthRequired(studioId, config.connection.credentialGeneration); throw new AvailabilitySetupRequiredError("RECONNECT"); }
        throw new AvailabilityProviderUnavailableError();
      }
      const holds = await deps.repository.listActiveHolds(studioId, artistProfileId, rangeStart, rangeEnd, new Date().toISOString());
      return candidateSlots({ rules: config.rules, rangeStart, rangeEnd, durationMinutes, busy: [...busy, ...holds] });
    },
  };
}
