const CONFIGURATION_ERROR =
  "INKENDAR_APP_ORIGIN must be an exact HTTP(S) origin without credentials, path, query, fragment, or wildcards.";

export function allowedActionOriginsFromCanonicalOrigin(value: string | undefined): string[] {
  if (!value) throw new Error(CONFIGURATION_ERROR);
  if (!URL.canParse(value)) throw new Error(CONFIGURATION_ERROR);

  const origin = new URL(value);
  const usesHttp = origin.protocol === "http:" || origin.protocol === "https:";
  const isExactOrigin = origin.origin === value;
  const usesExactHost = !origin.hostname.includes("*");

  if (!usesHttp || !isExactOrigin || !usesExactHost) throw new Error(CONFIGURATION_ERROR);
  return [origin.host];
}
