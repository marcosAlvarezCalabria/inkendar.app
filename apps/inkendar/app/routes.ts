import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("app", "routes/app.tsx"),
  route("app/owner", "routes/owner.tsx"),
  route("app/owner/conversations", "routes/owner-conversations.tsx"),
  route("app/owner/customers", "routes/owner-customers.tsx"),
  route("app/owner/cases", "routes/owner-cases.tsx"),
  route("app/artist", "routes/artist.tsx"),
  route("api/webhooks/chatwoot/:connectionId", "routes/chatwoot-webhook.ts"),
] satisfies RouteConfig;
