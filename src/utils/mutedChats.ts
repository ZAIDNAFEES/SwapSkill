import { safeLocalStorage } from "./safeStorage";

const STORAGE_KEY = "swap_muted_chats_v1";

type MutedChatsMap = Record<string, number>;

function readMutedMap(): MutedChatsMap {
  try {
    const raw = safeLocalStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as MutedChatsMap;
    }
    if (Array.isArray(parsed)) {
      const migrated: MutedChatsMap = {};
      for (const id of parsed) {
        if (typeof id === "string" && id.trim()) migrated[id.trim()] = -1;
      }
      return migrated;
    }
  } catch {
    // Ignore storage parse failure
  }
  return {};
}

function writeMutedMap(map: MutedChatsMap): void {
  try {
    safeLocalStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage write failure
  }
}

export function isChatMuted(chatId?: string | null): boolean {
  if (!chatId) return false;
  const map = readMutedMap();
  const val = map[chatId];
  if (val === undefined) return false;
  if (val === -1) return true;
  if (typeof val === "number" && val > Date.now()) return true;
  // Expired temporary mute — clean lazily
  if (typeof val === "number" && val <= Date.now()) {
    delete map[chatId];
    writeMutedMap(map);
  }
  return false;
}

export function getMutedChatIds(): string[] {
  const map = readMutedMap();
  const now = Date.now();
  const active: string[] = [];
  let dirty = false;
  for (const [id, val] of Object.entries(map)) {
    if (val === -1 || (typeof val === "number" && val > now)) {
      active.push(id);
    } else {
      delete map[id];
      dirty = true;
    }
  }
  if (dirty) writeMutedMap(map);
  return active;
}

export function muteChat(chatId: string, durationMs?: number): void {
  if (!chatId) return;
  const map = readMutedMap();
  map[chatId] = durationMs && durationMs > 0 ? Date.now() + durationMs : -1;
  writeMutedMap(map);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("swapskill_chat_muted_changed", {
        detail: { chatId, muted: true, allMutedIds: Object.keys(map) },
      })
    );
  }
}

export function unmuteChat(chatId: string): void {
  if (!chatId) return;
  const map = readMutedMap();
  if (chatId in map) {
    delete map[chatId];
    writeMutedMap(map);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("swapskill_chat_muted_changed", {
        detail: { chatId, muted: false, allMutedIds: Object.keys(map) },
      })
    );
  }
}

export function toggleChatMute(chatId: string): boolean {
  if (!chatId) return false;
  if (isChatMuted(chatId)) {
    unmuteChat(chatId);
    return false;
  }
  muteChat(chatId);
  return true;
}
