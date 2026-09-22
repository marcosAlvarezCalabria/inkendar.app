import type { Config } from "@react-router/dev/config";

import { allowedActionOriginsFromCanonicalOrigin } from "./app-origin-config.js";

export default {
  allowedActionOrigins: allowedActionOriginsFromCanonicalOrigin(process.env.INKENDAR_APP_ORIGIN),
  ssr: true,
} satisfies Config;
