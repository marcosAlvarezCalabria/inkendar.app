import { describe, expect, it, vi } from "vitest";
import { ConversationProviderUnavailableError } from "@inkendar/application";
import type { AuthorizedAccess } from "@inkendar/domain";
import { createOwnerConversationImageHandler } from "./owner-conversation-image.server.js";

const studioId = "20000000-0000-4000-8000-000000000001";
const access: AuthorizedAccess = { displayName: "Owner", role: "OWNER", studioId, userId: "10000000-0000-4000-8000-000000000001" };
const png = Uint8Array.from([137, 80, 78, 71]);

describe("owner conversation image handler", () => {
  it("authorizes the OWNER tenant and returns only private same-origin image bytes", async () => {
    const getImageAttachment = vi.fn(async () => ({ bytes: png, mediaType: "image/png" as const, width: 1, height: 1 }));
    const createContext = vi.fn(() => ({ getImageAttachment }));
    const handler = createOwnerConversationImageHandler({
      authorize: async () => ({ access, headers: new Headers({ "Set-Cookie": "session=rotated" }) }),
      createContext,
    });
    const request = new Request("https://app.inkendar.es/app/owner/conversations/42/messages/84/attachments/6");

    const response = await handler(request, { conversationId: "42", messageId: "84", attachmentId: "6" });

    expect(createContext).toHaveBeenCalledWith(request, studioId);
    expect(getImageAttachment).toHaveBeenCalledWith("42", "84", "6", request.signal);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Set-Cookie")).toBe("session=rotated");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
  });

  it("returns an authorization response without composing Chatwoot credentials", async () => {
    const createContext = vi.fn();
    const denied = new Response("Denied", { status: 403 });
    const handler = createOwnerConversationImageHandler({ authorize: async () => denied, createContext });

    await expect(handler(new Request("https://app.inkendar.es/image"), { conversationId: "42", messageId: "84", attachmentId: "6" })).resolves.toBe(denied);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("does not reveal provider errors or compose another tenant", async () => {
    const createContext = vi.fn((request: Request, requestedStudioId: string) => {
      expect(request.url).toBe("https://app.inkendar.es/image");
      expect(requestedStudioId).toBe(studioId);
      return { getImageAttachment: vi.fn(async () => { throw new ConversationProviderUnavailableError(); }) };
    });
    const handler = createOwnerConversationImageHandler({ authorize: async () => ({ access, headers: new Headers() }), createContext });

    const response = await handler(new Request("https://app.inkendar.es/image"), { conversationId: "42", messageId: "84", attachmentId: "6" });

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Imagen no disponible");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("rejects malformed IDs before composing provider state", async () => {
    const createContext = vi.fn();
    const handler = createOwnerConversationImageHandler({ authorize: async () => ({ access, headers: new Headers() }), createContext });
    const response = await handler(new Request("https://app.inkendar.es/image"), { conversationId: "42", messageId: "../84", attachmentId: "6" });
    expect(response.status).toBe(404);
    expect(createContext).not.toHaveBeenCalled();
  });

  it("rejects cross-site image embedding before composing provider state", async () => {
    const createContext = vi.fn();
    const handler = createOwnerConversationImageHandler({ authorize: async () => ({ access, headers: new Headers() }), createContext });
    const response = await handler(new Request("https://app.inkendar.es/image", { headers: { "Sec-Fetch-Site": "cross-site" } }), { conversationId: "42", messageId: "84", attachmentId: "6" });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(createContext).not.toHaveBeenCalled();
  });
});
