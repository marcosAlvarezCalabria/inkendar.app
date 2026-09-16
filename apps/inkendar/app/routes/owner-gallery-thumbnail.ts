import type { Route } from "./+types/owner-gallery-thumbnail";
import { ownerGalleryThumbnailHandler } from "../owner-gallery-thumbnail.server.js";

export async function loader({ request, params }: Route.LoaderArgs) { return ownerGalleryThumbnailHandler(request, params.handle ?? ""); }
