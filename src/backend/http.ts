import { config } from "../config.js";

const COMMON_HEADERS = {
  "Content-Type": "application/json",
  "X-API-Key": config.backend.apiKey,
};

export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return fetch(`${config.backend.baseUrl}${path}`, {
    ...init,
    headers: { ...COMMON_HEADERS, ...(init.headers || {}) },
  });
}
