package com.swapskill.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.HashMap;
import java.util.Map;

/**
 * Custom FirebaseMessagingService for SwapSkill.
 * Intercepts high-priority FCM data messages across foreground, background, locked, and closed states.
 * Renders native Android MessagingStyle chat notifications with Reply + Mute actions and direct deep links.
 */
public class SwapSkillMessagingService extends FirebaseMessagingService {

    private static final String TAG = "SwapSkillFCM";
    public static final Object CHAT_PUSH_QUEUE_LOCK = new Object();
    public static final Object CHAT_HISTORY_LOCK = new Object();
    private static final String PREFS_NAME = "swapskill_fcm_prefs";

    public static boolean isAllowedBackendOrigin(String rawUrl) {
        if (rawUrl == null) return false;
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty() || trimmed.length() > 512) return false;
        try {
            java.net.URL parsed = new java.net.URL(trimmed);
            String protocol = parsed.getProtocol();
            String host = parsed.getHost() != null ? parsed.getHost().toLowerCase(java.util.Locale.ROOT) : "";
            String userInfo = parsed.getUserInfo();
            if (userInfo != null && !userInfo.isEmpty()) return false;
            if ("https".equals(protocol)) {
                return "swapskill.ai.studio".equals(host)
                        || "swapskill.app".equals(host)
                        || "www.swapskill.app".equals(host)
                        || host.endsWith(".swapskill.app");
            }
            if ("http".equals(protocol)) {
                return "127.0.0.1".equals(host) || "localhost".equals(host);
            }
            return false;
        } catch (Exception ignored) {
            return false;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannelExists(this, "swapskill_calls");
        ensureChannelExists(this, "swapskill_messages");
        ensureChannelExists(this, "swapskill_session_alarms");
        ensureChannelExists(this, "swapskill_general");
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        boolean userUnlocked = SafeStorageUtils.isUserUnlocked(this);

        if (data == null || data.isEmpty()) {
            RemoteMessage.Notification notif = remoteMessage.getNotification();
            if (notif != null) {
                Map<String, String> fallbackData = new HashMap<>();
                fallbackData.put("title", notif.getTitle() != null ? notif.getTitle() : "SwapSkill");
                fallbackData.put("body", notif.getBody() != null ? notif.getBody() : "");
                fallbackData.put("channelId", notif.getChannelId() != null ? notif.getChannelId() : "swapskill_general");
                if (!MainActivity.isAppInForeground) {
                    showStandardDataNotification(fallbackData);
                }
            }
            if (userUnlocked) {
                try {
                    PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
                } catch (Exception ignored) {}
            }
            return;
        }

        String type = data.get("type");
        String callId = data.get("callId");

        Log.i(TAG, "[FCM_MESSAGE] Received remote message. type=" + type + ", callId=" + callId + ", directBootUnlocked=" + userUnlocked);

        // 1. Handle Remote Call Cancellation / Terminal State FIRST (prevents out-of-order ghost calls)
        if ("call_cancelled".equals(type) || "call_ended".equals(type) || "call_rejected".equals(type) || "call_missed".equals(type) || "call_accepted".equals(type)) {
            Log.i(TAG, "[CALL_PUSH] Remote call terminal/accepted signal: type=" + type + " callId=" + callId);
            try {
                IncomingCallManager.getInstance(this).markCallTerminated(callId);
                IncomingCallManager.getInstance(this).stopIncomingCall(this, callId);
            } catch (Exception ignored) {}
            if (!"call_accepted".equals(type)) {
                try {
                    if (CallForegroundPlugin.pendingAcceptedCallCache != null &&
                            (callId == null || callId.equals(CallForegroundPlugin.pendingAcceptedCallCache.getString("callId", "")))) {
                        CallForegroundPlugin.pendingAcceptedCallCache = null;
                    }
                    SharedPreferences callPrefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(this, "swapskill_call_prefs");
                    if (callPrefs != null) {
                        String pendingId = callPrefs.getString("pending_accepted_call_id", null);
                        if (pendingId != null && (callId == null || callId.trim().isEmpty() || callId.equals(pendingId))) {
                            callPrefs.edit()
                                    .putBoolean("pending_accepted_consumed", true)
                                    .remove("pending_accepted_call_id")
                                    .apply();
                        }
                    }
                } catch (Exception ignored) {}
                try {
                    CallForegroundService.terminateNativeCall(this, callId, "fcm_" + type);
                } catch (Exception e) {
                    Log.w(TAG, "Error terminating call foreground service: " + e.getMessage());
                }
            }
            if (userUnlocked) {
                try {
                    PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
                } catch (Exception ignored) {}
            }
            return;
        }

        // 2. Handle Incoming Call (Strictly type=incoming_call)
        if ("incoming_call".equals(type) && callId != null && !callId.isEmpty()) {
            // Check freshness (drop >40s stale incoming call pushes) and terminated blacklist
            try {
                String tsStr = data.get("timestamp");
                if (tsStr != null && !tsStr.trim().isEmpty()) {
                    long pushTs = Long.parseLong(tsStr.trim());
                    if (pushTs > 0 && System.currentTimeMillis() - pushTs > 40000L) {
                        Log.i(TAG, "[CALL_PUSH] Dropping stale incoming_call push callId=" + callId);
                        IncomingCallManager.getInstance(this).markCallTerminated(callId);
                        return;
                    }
                }
            } catch (Exception ignored) {}

            if (IncomingCallManager.getInstance(this).isCallTerminated(callId)) {
                Log.i(TAG, "[CALL_PUSH] Dropping incoming_call push for already-terminated callId=" + callId);
                return;
            }

            if (CallForegroundService.isCallActive) {
                Log.i(TAG, "[CALL_PUSH] Dropping incoming_call push while another call is active callId=" + callId);
                return;
            }

            String sessionId = data.get("sessionId");
            String callerId = data.get("callerId");
            String callerName = data.get("callerName");
            if (callerName == null || callerName.trim().isEmpty()) {
                callerName = data.get("title");
                if (callerName == null || callerName.trim().isEmpty()) {
                    callerName = "Skill Swap Partner";
                }
            }
            String callerPhoto = data.get("callerPhoto");
            String callType = data.get("callType");
            String skillName = data.get("skillName");
            String conversationId = data.get("conversationId");

            Log.i(TAG, "[TIMING] FCM_RECEIVED: callId=" + callId + " caller=" + callerName + " foreground=" + MainActivity.isAppInForeground + " t=" + System.currentTimeMillis());

            if (userUnlocked) {
                try {
                    PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
                } catch (Exception ignored) {}
            }

            android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            boolean isLocked = km != null && km.isKeyguardLocked();

            if (!MainActivity.isAppInForeground || isLocked) {
                try {
                    IncomingCallManager.getInstance(this).showIncomingCall(
                            this,
                            callId,
                            sessionId,
                            callerId,
                            callerName,
                            callerPhoto,
                            callType,
                            skillName,
                            conversationId
                    );
                } catch (Throwable t) {
                    Log.e(TAG, "Error in showIncomingCall, falling back to safe data notification: " + t.getMessage(), t);
                    showStandardDataNotification(data);
                }
            }
            return;
        }

        // 3. Normal notifications (Chat message, Session alarm, Announcement)
        String chatId = data.get("chatId");
        if (chatId == null || chatId.trim().isEmpty()) {
            chatId = data.get("referenceId");
        }
        boolean isChatPush =
                "chat".equals(type) ||
                "message".equals(type) ||
                "message_request".equals(type) ||
                (chatId != null && !chatId.trim().isEmpty());

        if (userUnlocked) {
            try {
                PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
            } catch (Exception e) {
                Log.d(TAG, "PushNotificationsPlugin could not receive message: " + e.getMessage());
            }
        }

        android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        boolean isLocked = km != null && km.isKeyguardLocked();

        // Always persist chat payload when backgrounded/killed/locked so chat state hydrates at 0ms
        if (isChatPush && (!MainActivity.isAppInForeground || isLocked)) {
            queueChatPushPayload(this, data, chatId);
        }

        if (!MainActivity.isAppInForeground || isLocked) {
            // Respect per-chat Mute setting silently while keeping chat sync intact
            if (isChatPush && isChatMuted(this, chatId)) {
                Log.i(TAG, "[CHAT_NOTIF] Chat " + chatId + " is muted — skipping system tray banner.");
                return;
            }

            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    PowerManager.WakeLock chatWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SwapSkill:ChatPushWakeLock");
                    chatWakeLock.acquire(3000);
                }
            } catch (Exception ignored) {}

            showStandardDataNotification(data);
        }
    }

    public static boolean isChatMuted(Context ctx, String chatId) {
        if (ctx == null || chatId == null || chatId.trim().isEmpty()) return false;
        synchronized (CHAT_HISTORY_LOCK) {
            try {
                SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(ctx, PREFS_NAME);
                if (prefs == null) return false;
                String raw = prefs.getString("muted_chats_json", "[]");
                org.json.JSONArray arr = new org.json.JSONArray(raw);
                for (int i = 0; i < arr.length(); i++) {
                    if (chatId.equals(arr.optString(i))) return true;
                }
            } catch (Exception ignored) {}
            return false;
        }
    }

    public static void setChatMuted(Context ctx, String chatId, boolean muted) {
        if (ctx == null || chatId == null || chatId.trim().isEmpty()) return;
        synchronized (CHAT_HISTORY_LOCK) {
            try {
                SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(ctx, PREFS_NAME);
                if (prefs == null) return;
                String raw = prefs.getString("muted_chats_json", "[]");
                org.json.JSONArray arr;
                try {
                    arr = new org.json.JSONArray(raw);
                } catch (Exception e) {
                    arr = new org.json.JSONArray();
                }
                org.json.JSONArray next = new org.json.JSONArray();
                boolean found = false;
                for (int i = 0; i < arr.length(); i++) {
                    String id = arr.optString(i, "");
                    if (id.isEmpty()) continue;
                    if (chatId.equals(id)) {
                        found = true;
                        if (muted) next.put(id);
                    } else {
                        next.put(id);
                    }
                }
                if (muted && !found) {
                    next.put(chatId);
                }
                prefs.edit().putString("muted_chats_json", next.toString()).apply();
            } catch (Exception ignored) {}
        }
    }

    public static void syncMutedChatsList(Context ctx, java.util.List<String> mutedIds) {
        if (ctx == null) return;
        synchronized (CHAT_HISTORY_LOCK) {
            try {
                SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(ctx, PREFS_NAME);
                if (prefs == null) return;
                org.json.JSONArray arr = new org.json.JSONArray();
                if (mutedIds != null) {
                    for (String id : mutedIds) {
                        if (id != null && !id.trim().isEmpty()) {
                            arr.put(id.trim());
                        }
                    }
                }
                prefs.edit().putString("muted_chats_json", arr.toString()).apply();
            } catch (Exception ignored) {}
        }
    }

    public static void clearChatMessageHistory(Context ctx, String chatId) {
        if (ctx == null || chatId == null || chatId.trim().isEmpty()) return;
        synchronized (CHAT_HISTORY_LOCK) {
            try {
                SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(ctx, PREFS_NAME);
                if (prefs != null) {
                    prefs.edit().remove("chat_msg_history_" + chatId.trim()).apply();
                }
            } catch (Exception ignored) {}
        }
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                int rawHash = chatId.trim().hashCode() & 0x7fffffff;
                int notifId = rawHash == 0 ? 1001 : rawHash;
                nm.cancel(notifId);
            }
        } catch (Exception ignored) {}
    }

    public static void queueLocalReplyPayload(Context ctx, String chatId, String myUserId, String text) {
        if (ctx == null || chatId == null || chatId.trim().isEmpty() || text == null || text.trim().isEmpty()) return;
        Map<String, String> replyData = new HashMap<>();
        replyData.put("chatId", chatId.trim());
        replyData.put("senderId", myUserId != null ? myUserId : "");
        replyData.put("senderName", "You");
        replyData.put("body", text.trim());
        replyData.put("fullMessage", text.trim());
        replyData.put("messageId", "native_reply_" + System.currentTimeMillis());
        replyData.put("createdAtMs", String.valueOf(System.currentTimeMillis()));
        queueChatPushPayload(ctx, replyData, chatId.trim());
    }

    private static void queueChatPushPayload(Context ctx, Map<String, String> data, String resolvedChatId) {
        if (ctx == null || data == null || resolvedChatId == null || resolvedChatId.trim().isEmpty()) return;
        synchronized (CHAT_PUSH_QUEUE_LOCK) {
            try {
                SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(ctx, PREFS_NAME);
                if (prefs == null) return;
                String existingRaw = prefs.getString("pending_chat_pushes_json", "[]");
                org.json.JSONArray arr;
                try {
                    arr = new org.json.JSONArray(existingRaw);
                } catch (Exception parseErr) {
                    arr = new org.json.JSONArray();
                }

                org.json.JSONObject entry = new org.json.JSONObject();
                entry.put("chatId", resolvedChatId.trim());
                entry.put("senderId", data.get("senderId") != null ? data.get("senderId") : "");
                entry.put("senderName", data.get("senderName") != null ? data.get("senderName") : (data.get("title") != null ? data.get("title") : ""));
                entry.put("senderPhoto", data.get("senderPhoto") != null ? data.get("senderPhoto") : (data.get("icon") != null ? data.get("icon") : ""));
                String bodyText = data.get("body") != null ? data.get("body") : (data.get("message") != null ? data.get("message") : (data.get("text") != null ? data.get("text") : ""));
                String fullText = data.get("fullMessage") != null && !data.get("fullMessage").isEmpty() ? data.get("fullMessage") : bodyText;
                entry.put("message", bodyText);
                entry.put("fullMessage", fullText);
                entry.put("messageId", data.get("messageId") != null ? data.get("messageId") : "");
                long createdAtMs = System.currentTimeMillis();
                try {
                    String rawTs = data.get("createdAtMs");
                    if (rawTs != null && !rawTs.trim().isEmpty()) {
                        long parsedTs = Long.parseLong(rawTs.trim());
                        if (parsedTs > 0) createdAtMs = parsedTs;
                    }
                } catch (Exception ignored) {}
                entry.put("createdAtMs", createdAtMs);

                arr.put(entry);
                if (arr.length() > 25) {
                    org.json.JSONArray trimmed = new org.json.JSONArray();
                    for (int i = arr.length() - 25; i < arr.length(); i++) {
                        trimmed.put(arr.get(i));
                    }
                    arr = trimmed;
                }
                prefs.edit().putString("pending_chat_pushes_json", arr.toString()).apply();
            } catch (Exception e) {
                Log.w(TAG, "Failed to persist pending chat push payload: " + e.getMessage());
            }
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        Log.i(TAG, "[TOKEN_SYNC] New FCM Registration Token generated");

        try {
            SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(this, PREFS_NAME);
            if (prefs != null) {
                prefs.edit()
                        .putString("latest_fcm_token", token)
                        .putLong("token_timestamp", System.currentTimeMillis())
                        .apply();
            }
        } catch (Exception ignored) {}

        if (SafeStorageUtils.isUserUnlocked(this)) {
            try {
                PushNotificationsPlugin.onNewToken(token);
            } catch (Exception e) {
                Log.w(TAG, "Failed to pass new token to Capacitor: " + e.getMessage());
            }
        }

        new Thread(() -> {
            try {
                SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(this, PREFS_NAME);
                if (prefs == null) return;
                String userId = prefs.getString("current_user_id", null);
                String customBackend = prefs.getString("backend_api_url", null);
                String idToken = prefs.getString("current_id_token", null);
                if (userId != null && !userId.trim().isEmpty()) {
                    java.util.List<String> endpoints = new java.util.ArrayList<>();
                    if (isAllowedBackendOrigin(customBackend)) {
                        endpoints.add(customBackend.trim().replaceAll("/+$", "") + "/api/notifications/sync-token");
                    }
                    endpoints.add("https://swapskill.ai.studio/api/notifications/sync-token");
                    endpoints.add("http://127.0.0.1:3000/api/notifications/sync-token");

                    org.json.JSONObject payload = new org.json.JSONObject();
                    payload.put("userId", userId.trim());
                    payload.put("token", token);
                    payload.put("platform", "android");
                    String jsonPayload = payload.toString();

                    for (String endpointUrl : endpoints) {
                        if (!isAllowedBackendOrigin(endpointUrl)) continue;
                        try {
                            java.net.URL url = new java.net.URL(endpointUrl);
                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                            conn.setRequestMethod("POST");
                            conn.setInstanceFollowRedirects(false);
                            conn.setRequestProperty("Content-Type", "application/json");
                            if (idToken != null && !idToken.trim().isEmpty()) {
                                conn.setRequestProperty("Authorization", "Bearer " + idToken.trim());
                            }
                            conn.setConnectTimeout(4000);
                            conn.setReadTimeout(4000);
                            conn.setDoOutput(true);
                            try (java.io.OutputStream os = conn.getOutputStream()) {
                                os.write(jsonPayload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                            }
                            int responseCode = conn.getResponseCode();
                            conn.disconnect();
                            if (responseCode >= 200 && responseCode < 300) {
                                Log.i(TAG, "[TOKEN_SYNC] Successfully synced refreshed token");
                                break;
                            }
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "[TOKEN_SYNC] Background token sync non-fatal: " + e.getMessage());
            }
        }).start();
    }

    /**
     * Posts or updates a WhatsApp-style MessagingStyle chat notification with stacked bubbles,
     * interactive Reply (RemoteInput) keeping the shade open across consecutive replies, and Mute.
     */
    public static void postChatMessagingNotification(
            Context ctx,
            String chatId,
            String senderId,
            String senderName,
            String senderPhoto,
            String recipientId,
            String messageText,
            String backendUrl,
            boolean isMeReply
    ) {
        postChatMessagingNotification(
                ctx,
                chatId,
                senderId,
                senderName,
                senderPhoto,
                recipientId,
                messageText,
                backendUrl,
                isMeReply,
                null
        );
    }

    public static void postChatMessagingNotification(
            Context ctx,
            String chatId,
            String senderId,
            String senderName,
            String senderPhoto,
            String recipientId,
            String messageText,
            String backendUrl,
            boolean isMeReply,
            String messageId
    ) {
        if (ctx == null || chatId == null || chatId.trim().isEmpty()) return;
        String cleanChatId = chatId.trim();
        String cleanMsgId = messageId != null ? messageId.trim() : "";
        ensureChannelExists(ctx, "swapskill_messages");

        String safeSenderName = (senderName != null && !senderName.trim().isEmpty()) ? senderName.trim() : "SwapSkill";
        String safeText = (messageText != null && !messageText.trim().isEmpty()) ? messageText.trim() : "New message";
        long nowTs = System.currentTimeMillis();

        org.json.JSONArray historyArr;
        synchronized (CHAT_HISTORY_LOCK) {
            historyArr = new org.json.JSONArray();
            try {
                SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(ctx, PREFS_NAME);
                if (prefs != null) {
                    String raw = prefs.getString("chat_msg_history_" + cleanChatId, "[]");
                    try {
                        historyArr = new org.json.JSONArray(raw);
                    } catch (Exception ignored) {
                        historyArr = new org.json.JSONArray();
                    }

                    // Dedupe by messageId or identical back-to-back partner payload within 3s
                    boolean duplicate = false;
                    if (!isMeReply && historyArr.length() > 0) {
                        if (!cleanMsgId.isEmpty()) {
                            for (int i = historyArr.length() - 1; i >= 0; i--) {
                                org.json.JSONObject prevObj = historyArr.optJSONObject(i);
                                if (prevObj != null && cleanMsgId.equals(prevObj.optString("msgId", ""))) {
                                    duplicate = true;
                                    break;
                                }
                            }
                        }
                        if (!duplicate) {
                            org.json.JSONObject last = historyArr.optJSONObject(historyArr.length() - 1);
                            if (last != null && !last.optBoolean("isMe", false)
                                    && safeText.equals(last.optString("text", ""))
                                    && Math.abs(nowTs - last.optLong("ts", 0)) < 3000) {
                                duplicate = true;
                            }
                        }
                    }
                    if (duplicate) {
                        Log.d(TAG, "[CHAT_NOTIF] Skipping duplicate partner notification chatId=" + cleanChatId + " msgId=" + cleanMsgId);
                        return;
                    }

                    org.json.JSONObject item = new org.json.JSONObject();
                    item.put("isMe", isMeReply);
                    item.put("name", isMeReply ? "You" : safeSenderName);
                    item.put("text", safeText);
                    item.put("ts", nowTs);
                    if (!cleanMsgId.isEmpty()) {
                        item.put("msgId", cleanMsgId);
                    }
                    historyArr.put(item);
                    if (historyArr.length() > 8) {
                        org.json.JSONArray sliced = new org.json.JSONArray();
                        for (int i = historyArr.length() - 8; i < historyArr.length(); i++) {
                            sliced.put(historyArr.get(i));
                        }
                        historyArr = sliced;
                    }
                    prefs.edit().putString("chat_msg_history_" + cleanChatId, historyArr.toString()).apply();
                }
            } catch (Exception e) {
                Log.w(TAG, "Error updating MessagingStyle history: " + e.getMessage());
            }
        }

        int rawHash = cleanChatId.hashCode() & 0x7fffffff;
        int notifId = rawHash == 0 ? 1001 : rawHash;

        Intent clickIntent = new Intent(ctx, MainActivity.class);
        clickIntent.setAction(Intent.ACTION_VIEW);
        clickIntent.setData(Uri.parse("swapskill://chat/" + Uri.encode(cleanChatId)));
        clickIntent.putExtra("chatId", cleanChatId);
        clickIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int immutableFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            immutableFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentPendingIntent = PendingIntent.getActivity(ctx, notifId, clickIntent, immutableFlags);

        Person mePerson = new Person.Builder().setName("You").setKey("me").build();
        Person partnerPerson = new Person.Builder()
                .setName(safeSenderName)
                .setKey(senderId != null && !senderId.isEmpty() ? senderId : cleanChatId)
                .build();

        NotificationCompat.MessagingStyle messagingStyle = new NotificationCompat.MessagingStyle(mePerson);
        for (int i = 0; i < historyArr.length(); i++) {
            org.json.JSONObject obj = historyArr.optJSONObject(i);
            if (obj == null) continue;
            boolean itemIsMe = obj.optBoolean("isMe", false);
            String itemText = obj.optString("text", "");
            long itemTs = obj.optLong("ts", nowTs);
            if (!itemText.isEmpty()) {
                messagingStyle.addMessage(itemText, itemTs, itemIsMe ? mePerson : partnerPerson);
            }
        }

        // Action 1: Inline Reply (background broadcast via ChatActionReceiver; never opens app)
        RemoteInput remoteInput = new RemoteInput.Builder(ChatActionReceiver.KEY_TEXT_REPLY)
                .setLabel("Reply...")
                .build();

        Intent replyIntent = new Intent(ctx, ChatActionReceiver.class);
        replyIntent.setAction(ChatActionReceiver.ACTION_REPLY);
        replyIntent.setData(Uri.parse("swapskill://notif-reply/" + Uri.encode(cleanChatId)));
        replyIntent.putExtra("chatId", cleanChatId);
        replyIntent.putExtra("notifId", notifId);
        replyIntent.putExtra("senderId", senderId);
        replyIntent.putExtra("senderName", safeSenderName);
        replyIntent.putExtra("senderPhoto", senderPhoto);
        replyIntent.putExtra("recipientId", recipientId);
        replyIntent.putExtra("backendUrl", backendUrl);

        int replyPendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            replyPendingFlags |= PendingIntent.FLAG_MUTABLE;
        }
        PendingIntent replyPendingIntent = PendingIntent.getBroadcast(ctx, notifId + 20, replyIntent, replyPendingFlags);

        NotificationCompat.Action replyAction = new NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_send,
                "Reply",
                replyPendingIntent
        ).addRemoteInput(remoteInput)
         .setAllowGeneratedReplies(true)
         .build();

        // Action 2: Mute chat (background broadcast via ChatActionReceiver)
        Intent muteIntent = new Intent(ctx, ChatActionReceiver.class);
        muteIntent.setAction(ChatActionReceiver.ACTION_MUTE);
        muteIntent.setData(Uri.parse("swapskill://notif-mute/" + Uri.encode(cleanChatId)));
        muteIntent.putExtra("chatId", cleanChatId);
        muteIntent.putExtra("notifId", notifId);
        PendingIntent mutePendingIntent = PendingIntent.getBroadcast(ctx, notifId + 30, muteIntent, immutableFlags);

        NotificationCompat.Action muteAction = new NotificationCompat.Action.Builder(
                android.R.drawable.ic_lock_silent_mode,
                "Mute",
                mutePendingIntent
        ).build();

        int smallIcon = R.drawable.ic_stat_swapskill;
        if (smallIcon == 0) {
            smallIcon = android.R.drawable.stat_notify_chat;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, "swapskill_messages")
                .setSmallIcon(smallIcon)
                .setColor(0xFFC9A96E)
                .setContentTitle(safeSenderName)
                .setContentText(safeText)
                .setStyle(messagingStyle)
                .setGroup("swapskill_chat_" + cleanChatId)
                .setShowWhen(true)
                .setAutoCancel(true)
                .setOnlyAlertOnce(isMeReply)
                .setSilent(isMeReply)
                .setPriority(isMeReply ? NotificationCompat.PRIORITY_DEFAULT : NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setDefaults(isMeReply ? 0 : NotificationCompat.DEFAULT_ALL)
                .setContentIntent(contentPendingIntent)
                .addAction(replyAction)
                .addAction(muteAction);

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.notify(notifId, builder.build());
                Log.i(TAG, "[CHAT_NOTIF] Posted MessagingStyle notifId=" + notifId + " isMeReply=" + isMeReply);
            } catch (Exception e) {
                Log.w(TAG, "MessagingStyle notify fallback: " + e.getMessage());
                try {
                    NotificationCompat.Builder fallback = new NotificationCompat.Builder(ctx, "swapskill_messages")
                            .setSmallIcon(android.R.drawable.stat_notify_chat)
                            .setColor(0xFFC9A96E)
                            .setContentTitle(safeSenderName)
                            .setContentText(safeText)
                            .setAutoCancel(true)
                            .setOnlyAlertOnce(isMeReply)
                            .setSilent(isMeReply)
                            .setPriority(NotificationCompat.PRIORITY_HIGH)
                            .setContentIntent(contentPendingIntent);
                    nm.notify(notifId, fallback.build());
                } catch (Exception ignored) {}
            }
        }
    }

    private void showStandardDataNotification(Map<String, String> data) {
        String title = data.get("title");
        if (title == null || title.trim().isEmpty()) {
            title = data.get("senderName");
        }
        if (title == null || title.trim().isEmpty()) {
            title = "SwapSkill";
        }

        String body = data.get("fullMessage");
        if (body == null || body.trim().isEmpty()) {
            body = data.get("body");
        }
        if (body == null || body.trim().isEmpty()) {
            body = data.get("message");
        }
        if (body == null || body.trim().isEmpty()) {
            body = data.get("text");
        }
        if (body == null) {
            body = "";
        }

        String channelId = data.get("channelId");
        if (channelId == null || channelId.trim().isEmpty()) {
            channelId = "swapskill_messages";
        }

        ensureChannelExists(this, channelId);

        String chatId = data.get("chatId");
        if (chatId == null || chatId.trim().isEmpty()) {
            chatId = data.get("referenceId");
        }
        String sessionId = data.get("sessionId");
        String callId = data.get("callId");
        boolean isCall = "incoming_call".equals(data.get("type")) && callId != null && !callId.isEmpty();

        // Delegate chat pushes directly to WhatsApp-grade MessagingStyle builder
        if (!isCall && chatId != null && !chatId.trim().isEmpty()) {
            String senderName = data.get("senderName");
            if (senderName == null || senderName.trim().isEmpty()) senderName = title;
            postChatMessagingNotification(
                    this,
                    chatId.trim(),
                    data.get("senderId"),
                    senderName,
                    data.get("senderPhoto"),
                    data.get("recipientId"),
                    body,
                    data.get("backendUrl"),
                    false,
                    data.get("messageId")
            );
            return;
        }

        Intent clickIntent = new Intent(this, MainActivity.class);
        clickIntent.setAction(Intent.ACTION_VIEW);
        if (sessionId != null && !sessionId.isEmpty()) {
            clickIntent.setData(Uri.parse("swapskill://session/" + Uri.encode(sessionId)));
        } else if (callId != null && !callId.isEmpty()) {
            clickIntent.setData(Uri.parse("swapskill://call/" + Uri.encode(callId) + "?sessionId=" + Uri.encode(sessionId != null ? sessionId : "")));
        } else {
            clickIntent.setData(Uri.parse("swapskill://home"));
        }
        clickIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        int notifId;
        if (callId != null && !callId.isEmpty()) {
            notifId = Math.abs(callId.hashCode());
        } else if (sessionId != null && !sessionId.isEmpty()) {
            notifId = Math.abs(sessionId.hashCode());
        } else {
            notifId = Math.abs((title + body).hashCode());
        }

        PendingIntent contentPendingIntent = PendingIntent.getActivity(this, notifId, clickIntent, pendingFlags);

        int smallIcon = isCall
                ? android.R.drawable.stat_sys_phone_call
                : R.drawable.ic_stat_swapskill;
        if (smallIcon == 0) {
            smallIcon = android.R.drawable.stat_notify_chat;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(smallIcon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(!isCall)
                .setOngoing(isCall)
                .setPriority(isCall ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
                .setCategory(isCall ? NotificationCompat.CATEGORY_CALL : NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(isCall ? NotificationCompat.VISIBILITY_PUBLIC : NotificationCompat.VISIBILITY_PRIVATE)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setContentIntent(contentPendingIntent);

        if (isCall && callId != null && !callId.isEmpty()) {
            Intent answerIntent = new Intent(this, CallActionReceiver.class);
            answerIntent.setAction(CallActionReceiver.ACTION_ACCEPT);
            answerIntent.putExtra("callId", callId);
            answerIntent.putExtra("sessionId", sessionId);
            answerIntent.putExtra("callerId", data.get("callerId"));
            answerIntent.putExtra("callerName", data.get("callerName"));
            answerIntent.putExtra("callerPhoto", data.get("callerPhoto"));
            answerIntent.putExtra("callType", data.get("callType"));
            answerIntent.putExtra("skillName", data.get("skillName"));
            answerIntent.putExtra("conversationId", data.get("conversationId"));
            PendingIntent answerPendingIntent = PendingIntent.getBroadcast(this, notifId + 1, answerIntent, pendingFlags);

            Intent declineIntent = new Intent(this, CallActionReceiver.class);
            declineIntent.setAction(CallActionReceiver.ACTION_DECLINE);
            declineIntent.putExtra("callId", callId);
            declineIntent.putExtra("sessionId", sessionId);
            PendingIntent declinePendingIntent = PendingIntent.getBroadcast(this, notifId + 2, declineIntent, pendingFlags);

            builder.addAction(android.R.drawable.ic_menu_call, "Answer", answerPendingIntent);
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePendingIntent);
        }

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.notify(notifId, builder.build());
            } catch (Exception e) {
                try {
                    NotificationCompat.Builder fallbackBuilder = new NotificationCompat.Builder(this, channelId)
                            .setSmallIcon(isCall ? android.R.drawable.stat_sys_phone_call : android.R.drawable.stat_notify_chat)
                            .setContentTitle(title)
                            .setContentText(body)
                            .setAutoCancel(!isCall)
                            .setPriority(isCall ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
                            .setDefaults(NotificationCompat.DEFAULT_ALL)
                            .setContentIntent(contentPendingIntent);
                    nm.notify(notifId, fallbackBuilder.build());
                } catch (Exception ignored) {}
            }
        }
    }

    public static void ensureChannelExists(Context ctx, String channelId) {
        if (ctx != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(channelId) == null) {
                String name = "General Notifications";
                int importance = NotificationManager.IMPORTANCE_HIGH;
                if ("swapskill_messages".equals(channelId)) {
                    name = "Chat Messages";
                } else if ("swapskill_session_alarms".equals(channelId)) {
                    name = "Session Reminders";
                } else if ("swapskill_calls".equals(channelId)) {
                    name = "Live Swap Calls";
                }
                NotificationChannel channel = new NotificationChannel(channelId, name, importance);
                channel.enableVibration(true);
                channel.enableLights(true);
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(channel);
            }
        }
    }
}
