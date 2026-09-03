/**
 * Intercepts global fetch so the harness can fail the first homeserver PUT(s).
 * @synonymdev/pubky uses fetch-cookie around fetch in Node.
 */
let remainingPutFails = 0;
let installed = false;
const originalFetch: typeof fetch | undefined =
  typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined;

export function failNextHomeserverPuts(times: number): void {
  remainingPutFails = times;
}

export function remainingHomeserverPutFails(): number {
  return remainingPutFails;
}

if (!installed && originalFetch) {
  installed = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = String(input instanceof Request ? input.url : input);
    if (
      remainingPutFails > 0 &&
      method === "PUT" &&
      url.includes("/pub/pubky.app/posts/")
    ) {
      remainingPutFails -= 1;
      return new Response("injected put failure", { status: 502, statusText: "Bad Gateway" });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}
