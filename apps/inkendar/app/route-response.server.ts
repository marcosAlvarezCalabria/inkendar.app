/**
 * React Router serializes returned Responses as loader data and thrown response
 * bodies into hydration. Preserve status and headers while keeping failure data
 * server-side and activating the route ErrorBoundary.
 */
export function routeResponseOrThrow(response: Response): Response {
  if (response.status >= 400) {
    throw new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
}
