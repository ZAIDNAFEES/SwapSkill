import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "../firebase";
import { getApiBaseUrl } from "../utils/apiConfig";

export type BattleNotificationType =
  | "battle_invite"
  | "battle_accepted"
  | "battle_declined"
  | "battle_challenger_joined"
  | "battle_starting"
  | "battle_live"
  | "battle_judge_assigned"
  | "battle_result"
  | "battle_judge_approved"
  | "battle_judge_rejected";

export interface SendBattleNotificationInput {
  targetUserId: string;
  type: BattleNotificationType;
  title: string;
  body: string;
  battleId?: string;
  senderId?: string;
  senderName?: string;
  senderPhoto?: string;
}

export async function sendBattleNotification(input: SendBattleNotificationInput): Promise<void> {
  if (!input.targetUserId) return;

  try {
    await addDoc(collection(db, "users", input.targetUserId, "notifications"), {
      type: input.type,
      title: input.title,
      body: input.body,
      battleId: input.battleId || null,
      senderId: input.senderId || auth.currentUser?.uid || null,
      senderName: input.senderName || "SwapSkill Arena",
      senderPhoto: input.senderPhoto || null,
      read: false,
      timestamp: serverTimestamp(),
      createdAtMs: Date.now(),
    });
  } catch (err) {
    console.warn("[BattleNotifications] Could not persist Firestore notification:", err);
  }

  // Best-effort push delivery via existing SwapSkill backend push route
  try {
    const idToken = await auth.currentUser?.getIdToken().catch(() => null);
    if (!idToken) return;
    const baseUrl = getApiBaseUrl();
    const endpoint = baseUrl ? `${baseUrl}/api/notifications/send-push` : "/api/notifications/send-push";
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        targetUid: input.targetUserId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: {
          type: input.type,
          battleId: input.battleId || "",
          senderId: input.senderId || "",
        },
      }),
    }).catch(() => {});
  } catch (_) {}
}

export async function notifyBattleUsers(
  userIds: string[],
  payload: Omit<SendBattleNotificationInput, "targetUserId">
): Promise<void> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;
  await Promise.allSettled(
    uniqueIds.map((targetUserId) =>
      sendBattleNotification({
        ...payload,
        targetUserId,
      })
    )
  );
}
