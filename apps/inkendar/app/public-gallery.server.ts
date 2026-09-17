import { createPublicGalleryService } from "@inkendar/application";
import { createSupabasePublicGalleryRepository } from "@inkendar/infrastructure";
import { createFixedWindowRateLimiter, createPublicGalleryFeedHandler, type PublicGalleryRateLimiter, type PublicGalleryReader } from "@inkendar/public-content";

type Dependencies = Readonly<{ createService(): PublicGalleryReader }>;

const defaults: Dependencies = {
  createService: () => createPublicGalleryService(createSupabasePublicGalleryRepository(process.env)),
};

const defaultLimiter = createFixedWindowRateLimiter({ limit: 120, windowMs: 60_000, maxKeys: 1_024 });

export function createPublicGalleryHandlers(dependencies: Dependencies = defaults, limiter: PublicGalleryRateLimiter = defaultLimiter) {
  const handler = createPublicGalleryFeedHandler({ get: (studioSlug) => dependencies.createService().get(studioSlug) }, limiter);
  return {
    async loader(request: Request, studioSlug: string | undefined): Promise<Response> {
      return handler(request, studioSlug);
    },
  };
}

export const publicGalleryHandlers = createPublicGalleryHandlers();
