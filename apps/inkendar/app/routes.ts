import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("app", "routes/app.tsx"),
  route("app/owner", "routes/owner.tsx"),
  route("app/artist", "routes/artist.tsx"),
] satisfies RouteConfig;
