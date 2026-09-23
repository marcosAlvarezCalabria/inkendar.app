import { createRequestHandler, RouterContextProvider, type ServerBuild } from "react-router";
import * as build from "virtual:react-router/server-build";
import {
  cloudflareContext,
  type InkendarCloudflareEnvironment,
  type InkendarExecutionContext,
} from "../app/cloudflare-context.js";
import { operationalResponse } from "./operational-routes.js";

const requestHandler = createRequestHandler(build as ServerBuild, import.meta.env.MODE);

type WorkerHandler = Readonly<{
  fetch(
    request: Request,
    env: InkendarCloudflareEnvironment,
    ctx: InkendarExecutionContext,
  ): Promise<Response>;
}>;

export default {
  async fetch(request, env, ctx) {
    const operational = operationalResponse(request, env);
    if (operational) return operational;

    const context = new RouterContextProvider();
    context.set(cloudflareContext, { env, ctx });
    return requestHandler(request, context);
  },
} satisfies WorkerHandler;
