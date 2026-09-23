import { createContext } from "react-router";
import type { ImagesBinding } from "@inkendar/infrastructure";

export type InkendarCloudflareEnvironment = Omit<Env, "IMAGES"> & {
  IMAGES: ImagesBinding;
};

export type InkendarExecutionContext = Readonly<{
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}>;

export const cloudflareContext = createContext<Readonly<{
  env: InkendarCloudflareEnvironment;
  ctx: InkendarExecutionContext;
}>>();
