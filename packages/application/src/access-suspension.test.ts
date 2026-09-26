import { describe, expect, it, vi } from "vitest";

import { AccessDeniedError, type AuthorizedAccess } from "@inkendar/domain";
import {
  InvalidAccessChangeError,
  createAccessSuspensionService,
  type AccessSuspensionRepositoryPort,
} from "./access-suspension.js";

const owner: AuthorizedAccess = {
  displayName: "Owner",
  role: "OWNER",
  studioId: "20000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000001",
};
const targetId = "40000000-0000-4000-8000-000000000002";

function repository(): AccessSuspensionRepositoryPort {
  return {
    listMembers: vi.fn(async () => [{ id: targetId, displayName: "Artist", role: "ARTIST" as const, status: "ACTIVE" as const }]),
    setArtistStatus: vi.fn(async () => undefined),
  };
}

describe("artist access suspension service", () => {
  it("lists only the authorized owner's tenant", async () => {
    const repo = repository();
    const members = await createAccessSuspensionService(repo).listMembers(owner);
    expect(members).toHaveLength(1);
    expect(repo.listMembers).toHaveBeenCalledWith(owner.studioId);
  });

  it("passes only validated target and ACTIVE/SUSPENDED to the atomic repository mutation", async () => {
    const repo = repository();
    const service = createAccessSuspensionService(repo);
    await service.setArtistStatus(owner, targetId, "SUSPENDED");
    await service.setArtistStatus(owner, targetId, "ACTIVE");
    expect(repo.setArtistStatus).toHaveBeenNthCalledWith(1, targetId, "SUSPENDED");
    expect(repo.setArtistStatus).toHaveBeenNthCalledWith(2, targetId, "ACTIVE");
  });

  it.each(["bad-id", "", "40000000-0000-4000-0000-000000000002"])("rejects malformed target %s before persistence", async (id) => {
    const repo = repository();
    await expect(createAccessSuspensionService(repo).setArtistStatus(owner, id, "SUSPENDED")).rejects.toBeInstanceOf(InvalidAccessChangeError);
    expect(repo.setArtistStatus).not.toHaveBeenCalled();
  });

  it("rejects unrecognized status and non-owner actors before persistence", async () => {
    const repo = repository();
    const service = createAccessSuspensionService(repo);
    await expect(service.setArtistStatus(owner, targetId, "DELETED")).rejects.toBeInstanceOf(InvalidAccessChangeError);
    await expect(service.listMembers({ ...owner, role: "ARTIST" })).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(service.setArtistStatus({ ...owner, role: "ARTIST" }, targetId, "SUSPENDED")).rejects.toBeInstanceOf(AccessDeniedError);
    expect(repo.listMembers).not.toHaveBeenCalled();
    expect(repo.setArtistStatus).not.toHaveBeenCalled();
  });
});
