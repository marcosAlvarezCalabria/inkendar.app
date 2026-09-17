import type { Route } from "./+types/public-gallery";
import { publicGalleryHandlers } from "../public-gallery.server.js";

export function loader({ request, params }: Route.LoaderArgs) {
  return publicGalleryHandlers.loader(request, params.studioSlug);
}

export function action({ request, params }: Route.ActionArgs) {
  return publicGalleryHandlers.loader(request, params.studioSlug);
}
