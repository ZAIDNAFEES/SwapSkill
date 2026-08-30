import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  query, 
  where 
} from "firebase/firestore";
import { db } from "../firebase";
import { Chat } from "../types";

export const getTimestampMs = (timeVal: any): number => {
  if (!timeVal) return 0;
  if (typeof timeVal === "number") return timeVal > 1e11 ? timeVal : timeVal * 1000;
  if (typeof timeVal.toMillis === "function") return timeVal.toMillis();
  if (timeVal.seconds !== undefined) return timeVal.seconds * 1000 + (timeVal.nanoseconds || 0) / 1e6;
  if (timeVal instanceof Date) return timeVal.getTime();
  if (typeof timeVal === "string") {
    const parsed = Date.parse(timeVal);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

export const getTimestampSeconds = (timeVal: any): number => {
  return getTimestampMs(timeVal) / 1000;
};

/**
 * Returns the deterministic canonical identity for a 1:1 conversation between two Firebase UIDs.
 * Example: ['uidA', 'uidB'].sort().join('_') -> "uidA_uidB"
 * Order of arguments does NOT matter: (A, B) and (B, A) produce the exact same key.
 */
export const getCanonicalParticipantKey = (uid1: string, uid2: string): string => {
  if (!uid1 || !uid2) return "";
  const clean1 = uid1.trim();
  const clean2 = uid2.trim();
  if (!clean1 || !clean2 || clean1 === clean2) return "";
  return [clean1, clean2].sort().join("_");
};

/**
 * Derives the unique participant pair key from any Chat document.
 */
export const getParticipantKeyFromChat = (
  chat: { participantIds?: string[]; id?: string; otherUserId?: string } | null | undefined,
  currentUserId?: string
): string => {
  if (!chat) return "";
  if (Array.isArray(chat.participantIds)) {
    const valid = chat.participantIds
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      .map((id) => id.trim());
    if (valid.length >= 2) {
      return [...valid].sort().join("_");
    }
    if (valid.length === 1 && currentUserId && valid[0] !== currentUserId.trim()) {
      return [valid[0], currentUserId.trim()].sort().join("_");
    }
  }

  if (chat.id && chat.id.includes("_")) {
    const parts = chat.id.split("_").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 2) {
      return parts.sort().join("_");
    }
  }

  if (chat.otherUserId && currentUserId && chat.otherUserId !== currentUserId) {
    return [chat.otherUserId.trim(), currentUserId.trim()].sort().join("_");
  }

  return chat.id || "";
};

/**
 * Accurately extracts the OTHER participant ID from a chat.
 * Never returns the current user's UID.
 */
export const getOtherParticipantId = (
  chat: { participantIds?: string[]; otherUserId?: string; id?: string } | null | undefined,
  currentUserId: string
): string | null => {
  if (!chat || !currentUserId) return null;
  const cleanCurrent = currentUserId.trim();

  if (Array.isArray(chat.participantIds)) {
    const other = chat.participantIds.find((id) => id && id.trim() !== cleanCurrent);
    if (other) return other.trim();
  }

  if (chat.otherUserId && chat.otherUserId.trim() !== cleanCurrent) {
    return chat.otherUserId.trim();
  }

  if (chat.id && chat.id.includes("_")) {
    const parts = chat.id.split("_").map((p) => p.trim()).filter(Boolean);
    const other = parts.find((p) => p !== cleanCurrent);
    if (other) return other;
  }

  return null;
};

/**
 * Consolidates multiple Firestore conversation documents for the exact same pair of Firebase UIDs
 * into a single unified logical conversation row in memory.
 * - Chooses the document with the newest lastMessage / message history as primary.
 * - Retains all merged doc IDs so messages from duplicate documents are never lost.
 * - Combines unread counts and preference flags.
 */
export const consolidateConversations = (rawChats: Chat[], currentUserId?: string): Chat[] => {
  if (!rawChats || rawChats.length === 0) return [];

  const groups = new Map<string, Chat[]>();

  for (const c of rawChats) {
    if (!c || !c.id) continue;
    const key = getParticipantKeyFromChat(c, currentUserId);
    if (!key) {
      const existing = groups.get(c.id) || [];
      existing.push(c);
      groups.set(c.id, existing);
      continue;
    }
    const existing = groups.get(key) || [];
    existing.push(c);
    groups.set(key, existing);
  }

  const consolidated: Chat[] = [];

  for (const [key, group] of groups.entries()) {
    if (group.length === 1) {
      const single = group[0];
      const otherId = currentUserId ? getOtherParticipantId(single, currentUserId) : undefined;
      consolidated.push({
        ...single,
        mergedChatIds: [single.id],
        otherUserId: (single as any).otherUserId || otherId || undefined
      } as Chat);
      continue;
    }

    // Multiple documents found for the EXACT same 2 participant UIDs!
    // Sort group to pick the best primary document:
    // 1. Newest timestamp
    // 2. Non-empty last message
    // 3. Preferred 'conversations' collection over legacy 'chats'
    // 4. Preferred canonical ID (uidA_uidB)
    const sortedGroup = [...group].sort((a, b) => {
      const timeA = getTimestampMs(a.lastMessageAt || a.lastMessageTime || a.updatedAt || a.createdAt);
      const timeB = getTimestampMs(b.lastMessageAt || b.lastMessageTime || b.updatedAt || b.createdAt);
      if (timeB !== timeA) return timeB - timeA;

      const hasMsgA = Boolean(a.lastMessage && a.lastMessage.trim().length > 0);
      const hasMsgB = Boolean(b.lastMessage && b.lastMessage.trim().length > 0);
      if (hasMsgA !== hasMsgB) return hasMsgA ? -1 : 1;

      if (a.isLegacy !== b.isLegacy) return a.isLegacy ? 1 : -1;
      if (a.id === key) return -1;
      if (b.id === key) return 1;
      return 0;
    });

    const primary = sortedGroup[0];
    const allMergedIds = Array.from(new Set(group.map((c) => c.id)));

    // Merge unread counts
    const mergedUnread: Record<string, number> = {};
    for (const c of group) {
      if (c.unreadCount) {
        for (const [uid, count] of Object.entries(c.unreadCount)) {
          mergedUnread[uid] = (mergedUnread[uid] || 0) + (typeof count === "number" ? count : 0);
        }
      }
    }

    const mergedPinned = Array.from(new Set(group.flatMap((c) => c.pinnedUsers || [])));
    const mergedArchived = Array.from(new Set(group.flatMap((c) => c.archivedUsers || [])));
    const mergedMuted = Array.from(new Set(group.flatMap((c) => c.mutedUsers || [])));

    // Choose best lastMessage and timestamps
    const bestLastMessage = primary.lastMessage || group.find((c) => c.lastMessage && c.lastMessage.trim().length > 0)?.lastMessage || "";
    const bestLastMessageSenderId = primary.lastMessageSenderId || group.find((c) => c.lastMessageSenderId)?.lastMessageSenderId || "";
    const bestLastMessageTime = primary.lastMessageTime || group.find((c) => c.lastMessageTime)?.lastMessageTime || primary.lastMessageAt || group.find((c) => c.lastMessageAt)?.lastMessageAt || new Date();
    const bestLastMessageAt = primary.lastMessageAt || primary.lastMessageTime || group.find((c) => c.lastMessageAt || c.lastMessageTime)?.lastMessageAt || bestLastMessageTime;
    const bestUpdatedAt = primary.updatedAt || bestLastMessageAt || new Date();
    const bestCreatedAt = primary.createdAt || bestLastMessageTime || new Date();

    const otherId = currentUserId ? getOtherParticipantId(primary, currentUserId) : undefined;

    consolidated.push({
      ...primary,
      id: primary.id,
      participantIds: Array.isArray(primary.participantIds) && primary.participantIds.length >= 2 
        ? primary.participantIds 
        : key.includes("_") ? key.split("_") : primary.participantIds,
      lastMessage: bestLastMessage,
      lastMessageSenderId: bestLastMessageSenderId,
      lastMessageTime: bestLastMessageTime,
      lastMessageAt: bestLastMessageAt,
      updatedAt: bestUpdatedAt,
      createdAt: bestCreatedAt,
      unreadCount: mergedUnread,
      pinnedUsers: mergedPinned.length > 0 ? mergedPinned : undefined,
      archivedUsers: mergedArchived.length > 0 ? mergedArchived : undefined,
      mutedUsers: mergedMuted.length > 0 ? mergedMuted : undefined,
      mergedChatIds: allMergedIds,
      isLegacy: group.every((c) => c.isLegacy),
      otherUserId: (primary as any).otherUserId || otherId || undefined
    } as Chat);
  }

  return consolidated;
};

// In-memory cache for resolved conversation IDs and in-flight promises to eliminate redundant Firestore queries
const resolvedConversationCache = new Map<string, { chatId: string; isLegacy: boolean }>();
const inFlightConversationPromises = new Map<string, Promise<{ chatId: string; isNew: boolean; isLegacy: boolean }>>();

/**
 * Retrieves an existing conversation or creates exactly ONE canonical conversation
 * for the two Firebase UIDs.
 * Highly optimized for speed: parallelized lookups, in-memory caching, parallel creation writes.
 */
export const getOrCreateConversation = async (
  currentUserId: string,
  otherUserId: string,
  initialLastMessage?: string
): Promise<{ chatId: string; isNew: boolean; isLegacy: boolean }> => {
  if (!currentUserId || !otherUserId) {
    throw new Error("Missing participant ID for conversation");
  }

  const cleanCurrent = currentUserId.trim();
  const cleanOther = otherUserId.trim();

  if (cleanCurrent === cleanOther) {
    throw new Error("Cannot create conversation with oneself");
  }

  const participantIds = [cleanCurrent, cleanOther].sort();
  const canonicalChatId = participantIds.join("_");

  // 0. Check in-memory resolved cache for instant 0ms return
  const cached = resolvedConversationCache.get(canonicalChatId);
  if (cached) {
    return { chatId: cached.chatId, isNew: false, isLegacy: cached.isLegacy };
  }

  // Deduplicate in-flight requests for the same conversation
  if (inFlightConversationPromises.has(canonicalChatId)) {
    return inFlightConversationPromises.get(canonicalChatId)!;
  }

  const executionPromise = (async () => {
    // 1. Parallel check for canonical document in both conversations and chats collections
    try {
      const convRef = doc(db, "conversations", canonicalChatId);
      const chatRef = doc(db, "chats", canonicalChatId);

      const [convSnap, chatSnap] = await Promise.all([
        getDoc(convRef).catch(() => null),
        getDoc(chatRef).catch(() => null),
      ]);

      if (convSnap && convSnap.exists()) {
        resolvedConversationCache.set(canonicalChatId, { chatId: canonicalChatId, isLegacy: false });
        return { chatId: canonicalChatId, isNew: false, isLegacy: false };
      }

      if (chatSnap && chatSnap.exists()) {
        resolvedConversationCache.set(canonicalChatId, { chatId: canonicalChatId, isLegacy: true });
        return { chatId: canonicalChatId, isNew: false, isLegacy: true };
      }
    } catch (e) {
      console.warn("Could not check canonical conversation docs in parallel:", e);
    }

    // 2. Query both collections in parallel if not found by direct ID
    try {
      const qConvs = query(
        collection(db, "conversations"),
        where("participantIds", "array-contains", cleanCurrent)
      );
      const qChats = query(
        collection(db, "chats"),
        where("participantIds", "array-contains", cleanCurrent)
      );

      const [convsSnap, chatsSnap] = await Promise.all([
        getDocs(qConvs).catch(() => null),
        getDocs(qChats).catch(() => null),
      ]);

      if (convsSnap && !convsSnap.empty) {
        for (const docSnap of convsSnap.docs) {
          const data = docSnap.data();
          if (
            Array.isArray(data.participantIds) &&
            data.participantIds.includes(cleanOther)
          ) {
            resolvedConversationCache.set(canonicalChatId, { chatId: docSnap.id, isLegacy: false });
            return { chatId: docSnap.id, isNew: false, isLegacy: false };
          }
        }
      }

      if (chatsSnap && !chatsSnap.empty) {
        for (const docSnap of chatsSnap.docs) {
          const data = docSnap.data();
          if (
            Array.isArray(data.participantIds) &&
            data.participantIds.includes(cleanOther)
          ) {
            resolvedConversationCache.set(canonicalChatId, { chatId: docSnap.id, isLegacy: true });
            return { chatId: docSnap.id, isNew: false, isLegacy: true };
          }
        }
      }
    } catch (e) {
      console.warn("Could not query existing conversations by participantIds:", e);
    }

    // 3. If no conversation exists anywhere, create canonical document and members in parallel
    const now = new Date();
    const initData = {
      id: canonicalChatId,
      participantIds,
      lastMessage: initialLastMessage || "Conversation initiated",
      lastMessageSenderId: cleanCurrent,
      lastMessageTime: now,
      lastMessageAt: now,
      updatedAt: now,
      createdAt: now,
      unreadCount: {
        [cleanCurrent]: 0,
        [cleanOther]: 0,
      },
    };

    const convRef = doc(db, "conversations", canonicalChatId);
    const memberPromises = [
      setDoc(convRef, initData),
      ...participantIds.map(uid => {
        const memberId = `${canonicalChatId}_${uid}`;
        return setDoc(doc(db, "conversationMembers", memberId), {
          id: memberId,
          conversationId: canonicalChatId,
          userId: uid,
          joinedAt: new Date(),
        }).catch((e) => console.warn("Could not write conversationMembers normalization:", e));
      })
    ];

    await Promise.all(memberPromises);

    resolvedConversationCache.set(canonicalChatId, { chatId: canonicalChatId, isLegacy: false });
    return { chatId: canonicalChatId, isNew: true, isLegacy: false };
  })();

  inFlightConversationPromises.set(canonicalChatId, executionPromise);

  try {
    const result = await executionPromise;
    return result;
  } finally {
    inFlightConversationPromises.delete(canonicalChatId);
  }
};
