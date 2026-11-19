package com.swapskill.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import androidx.core.app.RemoteInput;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Handles incoming chat notification action intents (Inline Reply, Mute, Mark as Read).
 * Keeps MessagingStyle stacked bubbles open & interactive across consecutive inline replies.
 */
public class ChatActionReceiver extends BroadcastReceiver {

    public static final String ACTION_MARK_READ = "com.swapskill.app.ACTION_MARK_READ";
    public static final String ACTION_MUTE = "com.swapskill.app.ACTION_MUTE";
    public static final String ACTION_REPLY = "com.swapskill.app.ACTION_REPLY";
    public static final String KEY_TEXT_REPLY = "key_text_reply";
    private static final String TAG = "ChatActionReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String chatId = intent.getStringExtra("chatId");
        int notifId = intent.getIntExtra("notifId", 0);
        String senderId = intent.getStringExtra("senderId");
        String senderName = intent.getStringExtra("senderName");
        String senderPhoto = intent.getStringExtra("senderPhoto");
        String recipientId = intent.getStringExtra("recipientId");

        android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(context, "swapskill_fcm_prefs");
        String currentUserId = prefs != null ? prefs.getString("current_user_id", null) : null;
        String cachedDisplayName = prefs != null ? prefs.getString("current_display_name", null) : null;

        if (recipientId == null || recipientId.isEmpty()) {
            recipientId = currentUserId;
        }

        String backendUrl = intent.getStringExtra("backendUrl");
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        if (ACTION_MUTE.equals(action)) {
            Log.i(TAG, "[CHAT_ACTION] User muted chat from notification: chatId=" + chatId);
            if (chatId != null && !chatId.isEmpty()) {
                SwapSkillMessagingService.setChatMuted(context, chatId, true);
                SwapSkillMessagingService.clearChatMessageHistory(context, chatId);
                CallForegroundPlugin.notifyChatMutedNatively(chatId);
            }
            if (nm != null && notifId != 0) {
                nm.cancel(notifId);
            }
        } else if (ACTION_MARK_READ.equals(action)) {
            Log.i(TAG, "[CHAT_ACTION] User marked chat as read: chatId=" + chatId + " notifId=" + notifId);
            if (chatId != null && !chatId.isEmpty()) {
                SwapSkillMessagingService.clearChatMessageHistory(context, chatId);
            }
            if (nm != null && notifId != 0) {
                nm.cancel(notifId);
            }

            String readPayload = "{\"chatId\":\"" + escapeJson(chatId) + "\",\"userId\":\"" + escapeJson(recipientId != null ? recipientId : "") + "\"}";
            final PendingResult pendingResult = goAsync();
            sendAsyncApiRequest(context, "/api/chat/mark-read", readPayload, backendUrl, pendingResult);

        } else if (ACTION_REPLY.equals(action)) {
            Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
            CharSequence replyText = remoteInput != null ? remoteInput.getCharSequence(KEY_TEXT_REPLY) : null;

            if (replyText != null && replyText.toString().trim().length() > 0 && chatId != null && !chatId.isEmpty()) {
                String replyString = replyText.toString().trim();
                Log.i(TAG, "[CHAT_ACTION] User replied inline (staying in background): chatId=" + chatId + " reply=" + replyString);

                // Keep MessagingStyle notification open silently with stacked "You: <reply>" + active Reply/Mute buttons
                SwapSkillMessagingService.postChatMessagingNotification(
                        context,
                        chatId,
                        senderId,
                        senderName,
                        senderPhoto,
                        recipientId,
                        replyString,
                        backendUrl,
                        true,
                        "local_reply_" + System.currentTimeMillis()
                );

                // Deduce senderId (me) and recipientId (partner)
                String myUserId = currentUserId != null && !currentUserId.isEmpty() ? currentUserId : recipientId;
                if ((myUserId == null || myUserId.isEmpty()) && chatId.contains("_") && senderId != null) {
                    String[] parts = chatId.split("_");
                    if (parts.length == 2) {
                        myUserId = parts[0].equals(senderId) ? parts[1] : parts[0];
                    }
                }
                String targetRecipientId = senderId;
                if ((targetRecipientId == null || targetRecipientId.isEmpty()) && chatId.contains("_") && myUserId != null) {
                    String[] parts = chatId.split("_");
                    if (parts.length == 2) {
                        targetRecipientId = parts[0].equals(myUserId) ? parts[1] : parts[0];
                    }
                }

                // Queue optimistic reply so opening the chat later renders reply at 0ms
                SwapSkillMessagingService.queueLocalReplyPayload(context, chatId, myUserId, replyString);

                String myDisplayName = (cachedDisplayName != null && !cachedDisplayName.trim().isEmpty())
                        ? cachedDisplayName.trim()
                        : "SwapSkill User";

                // Send reply to Firestore via backend endpoint while keeping receiver alive with goAsync()
                String replyPayload = "{\"chatId\":\"" + escapeJson(chatId)
                        + "\",\"text\":\"" + escapeJson(replyString)
                        + "\",\"senderId\":\"" + escapeJson(myUserId != null ? myUserId : "")
                        + "\",\"recipientId\":\"" + escapeJson(targetRecipientId != null ? targetRecipientId : "")
                        + "\",\"senderName\":\"" + escapeJson(myDisplayName) + "\"}";
                final PendingResult pendingResult = goAsync();
                sendAsyncApiRequest(context, "/api/chat/send-reply", replyPayload, backendUrl, pendingResult);

                // Optimistically update React context if alive in memory (never opens MainActivity)
                try {
                    com.getcapacitor.JSObject replyObj = new com.getcapacitor.JSObject();
                    replyObj.put("chatId", chatId);
                    replyObj.put("text", replyString);
                    replyObj.put("senderId", myUserId != null ? myUserId : "");
                    replyObj.put("recipientId", targetRecipientId != null ? targetRecipientId : "");
                    replyObj.put("timestamp", System.currentTimeMillis());
                    CallForegroundPlugin.notifyMessageRepliedNatively(replyObj);
                } catch (Exception ignored) {}
            } else {
                Log.d(TAG, "[CHAT_ACTION] Ignoring empty inline reply without launching app.");
            }
        }
    }

    private void sendAsyncApiRequest(Context context, String endpoint, String jsonPayload, String backendUrl, PendingResult pendingResult) {
        new Thread(() -> {
            try {
                android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(context, "swapskill_fcm_prefs");
                String customBackend = prefs != null ? prefs.getString("backend_api_url", null) : null;
                String idToken = prefs != null ? prefs.getString("current_id_token", null) : null;

                java.util.List<String> endpoints = new java.util.ArrayList<>();
                if (backendUrl != null && !backendUrl.trim().isEmpty() && !backendUrl.contains("vercel.app")) {
                    endpoints.add(backendUrl.replaceAll("/+$", "") + endpoint);
                }
                if (customBackend != null && !customBackend.trim().isEmpty() && !customBackend.contains("vercel.app")) {
                    endpoints.add(customBackend.replaceAll("/+$", "") + endpoint);
                }
                endpoints.add("https://swapskill.ai.studio" + endpoint);
                endpoints.add("http://127.0.0.1:3000" + endpoint);

                for (String urlStr : endpoints) {
                    try {
                        URL url = new URL(urlStr);
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setRequestMethod("POST");
                        conn.setRequestProperty("Content-Type", "application/json");
                        if (idToken != null && !idToken.trim().isEmpty()) {
                            conn.setRequestProperty("Authorization", "Bearer " + idToken.trim());
                        }
                        conn.setConnectTimeout(3000);
                        conn.setReadTimeout(3500);
                        conn.setDoOutput(true);
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(jsonPayload.getBytes(StandardCharsets.UTF_8));
                        }
                        int responseCode = conn.getResponseCode();
                        conn.disconnect();
                        if (responseCode >= 200 && responseCode < 300) {
                            Log.i(TAG, "[API_SUCCESS] Chat action dispatched to " + urlStr + " (code=" + responseCode + ")");
                            break;
                        }
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                Log.w(TAG, "[API_ERROR] Chat action request failed: " + e.getMessage());
            } finally {
                if (pendingResult != null) {
                    try {
                        pendingResult.finish();
                    } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    private String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\b", "\\b")
                .replace("\f", "\\f")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t");
    }
}
