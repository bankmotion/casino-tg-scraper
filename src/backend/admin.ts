import { apiFetch } from "./http.js";
import type { ChannelDef, ChannelInput, ChannelPatch } from "./types.js";

/**
 * Admin CRUD wrappers around /api/admin/channels.
 * Called by the Telegram admin bot.
 */

export async function listAllChannels(): Promise<ChannelDef[]> {
  const res = await apiFetch("/api/admin/channels");
  if (!res.ok) throw new Error(`GET /api/admin/channels failed: ${res.status}`);
  return (await res.json()) as ChannelDef[];
}

export async function createChannel(input: ChannelInput): Promise<ChannelDef> {
  const res = await apiFetch("/api/admin/channels", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(
      `POST /api/admin/channels failed: ${res.status} ${await res.text()}`
    );
  }
  return (await res.json()) as ChannelDef;
}

export async function updateChannel(
  id: number,
  patch: ChannelPatch
): Promise<ChannelDef> {
  const res = await apiFetch(`/api/admin/channels/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(
      `PATCH /api/admin/channels/${id} failed: ${res.status} ${await res.text()}`
    );
  }
  return (await res.json()) as ChannelDef;
}

export async function deleteChannel(id: number, hard = false): Promise<void> {
  const qs = hard ? "?hard=true" : "";
  const res = await apiFetch(`/api/admin/channels/${id}${qs}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(
      `DELETE /api/admin/channels/${id} failed: ${res.status} ${await res.text()}`
    );
  }
}
