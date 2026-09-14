import type { Route } from "./+types/google-callback";
import { ownerGoogleCalendarHandlers } from "../owner-google-calendar.server.js";
export function headers() { return { "Cache-Control": "private, no-store" }; }
export async function loader({ request }: Route.LoaderArgs) { return ownerGoogleCalendarHandlers.callback(request); }
