package com.swapskill.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.RemoteInput;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Handles incoming chat notification action intents (Mark as Read & Inline Reply).
 * Operates reliably even if the app process is closed or in background.
 */
public class ChatActionReceiver extends BroadcastReceiver {

    public static final String ACTION_MARK_READ = "com.swapskill.app.ACTION_MARK_READ";
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
        String recipientId = intent.getStringExtra("recipientId");

        android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(context, "swapskill_fcm_prefs");
        String currentUserId = prefs != null ? prefs.getString("current_user_id", null) : null;

        if (recipientId == null || recipientId.isEmpty()) {
            recipientId = currentUserId;
        }

        String backendUrl = intent.getStringExtra("backendUrl");

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

        if (ACTION_MARK_READ.equals(action)) {
            Log.i(TAG, "[CHAT_ACTION] User marked chat as read: chatId=" + chatId + " notifId=" + notifId);
            // Dismiss notification immediately from tray
            if (nm != null && notifId != 0) {
                nm.cancel(notifId);
            }

            // Call backend API to mark as read in Firestore
            String readPayload = "{\"chatId\":\"" + escapeJson(chatId) + "\",\"userId\":\"" + escapeJson(recipientId != null ? recipientId : "") + "\"}";
            sendAsyncApiRequest(context, "/api/chat/mark-read", readPayload, backendUrl);

        } else if (ACTION_REPLY.equals(action)) {
            Bundle remoteInput = RemoteInput.getResultsFromIntent(intent);
            CharSequence replyText = remoteInput != null ? remoteInput.getCharSequence(KEY_TEXT_REPLY) : null;

            if (replyText != null && replyText.length() > 0) {
                String replyString = replyText.toString().trim();
                Log.i(TAG, "[CHAT_ACTION] User replied inline: chatId=" + chatId + " reply=" + replyString);

                // Update notification in system tray to confirm reply has been sent
                if (nm != null && notifId != 0) {
                    NotificationCompat.Builder repliedBuilder = new NotificationCompat.Builder(context, "swapskill_messages")
                            .setSmallIcon(android.R.drawable.stat_notify_chat)
                            .setContentTitle("Replied to " + (senderName != null ? senderName : "message"))
                            .setContentText(replyString)
                            .setTimeoutAfter(3000)
                            .setAutoCancel(true);
                    nm.notify(notifId, repliedBuilder.build());
                }

                // Deducing senderId (the user replying) and recipientId (the other user)
                String myUserId = currentUserId != null && !currentUserId.isEmpty() ? currentUserId : recipientId;
                if ((myUserId == null || myUserId.isEmpty()) && chatId != null && chatId.contains("_") && senderId != null) {
                    String[] parts = chatId.split("_");
                    if (parts.length == 2) {
                        myUserId = parts[0].equals(senderId) ? parts[1] : parts[0];
                    }
                }
                String targetRecipientId = senderId;
                if ((targetRecipientId == null || targetRecipientId.isEmpty()) && chatId != null && chatId.contains("_") && myUserId != null) {
                    String[] parts = chatId.split("_");
                    if (parts.length == 2) {
                        targetRecipientId = parts[0].equals(myUserId) ? parts[1] : parts[0];
                    }
                }

                // Send reply to Firestore via backend endpoint
                String replyPayload = "{\"chatId\":\"" + escapeJson(chatId) + "\",\"text\":\"" + escapeJson(replyString) + "\",\"senderId\":\"" + escapeJson(myUserId != null ? myUserId : "") + "\",\"recipientId\":\"" + escapeJson(targetRecipientId != null ? targetRecipientId : "") + "\",\"senderName\":\"SwapSkill User\"}";
                sendAsyncApiRequest(context, "/api/chat/send-reply", replyPayload, backendUrl);
            } else {
                // If user tapped action without inline text, launch MainActivity directly into the chat screen
                Intent openIntent = new Intent(context, MainActivity.class);
                openIntent.setAction(Intent.ACTION_VIEW);
                openIntent.setData(android.net.Uri.parse("swapskill://chat/" + (chatId != null ? chatId : "")));
                openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                context.startActivity(openIntent);

                if (nm != null && notifId != 0) {
                    nm.cancel(notifId);
                }
            }
        }
    }

    private void sendAsyncApiRequest(Context context, String endpoint, String jsonPayload, String backendUrl) {
        new Thread(() -> {
            try {
                android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(context, "swapskill_fcm_prefs");
                String customBackend = prefs != null ? prefs.getString("backend_api_url", null) : null;
                String idToken = prefs != null ? prefs.getString("current_id_token", null) : null;

                java.util.List<String> endpoints = new java.util.ArrayList<>();
                if (backendUrl != null && !backendUrl.trim().isEmpty()) {
                    endpoints.add(backendUrl.replaceAll("/+$", "") + endpoint);
                }
                endpoints.add("https://swap-skill1.vercel.app" + endpoint);
                if (customBackend != null && !customBackend.trim().isEmpty()) {
                    endpoints.add(customBackend.replaceAll("/+$", "") + endpoint);
                }
                endpoints.add("https://swap-skill-gaa1.vercel.app" + endpoint);
                endpoints.add("https://swap-skill-cnge.vercel.app" + endpoint);
                endpoints.add("https://swapskill.ai.studio" + endpoint);

                for (String urlStr : endpoints) {
                    try {
                        URL url = new URL(urlStr);
                        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                        conn.setRequestMethod("POST");
                        conn.setRequestProperty("Content-Type", "application/json");
                        if (idToken != null && !idToken.trim().isEmpty()) {
                            conn.setRequestProperty("Authorization", "Bearer " + idToken.trim());
                        }
                        conn.setConnectTimeout(2500);
                        conn.setReadTimeout(3500);
                        conn.setDoOutput(true);
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(jsonPayload.getBytes(StandardCharsets.UTF_8));
                        }
                        int responseCode = conn.getResponseCode();
                        conn.disconnect();
                        if (responseCode >= 200 && responseCode < 300) {
                            Log.i(TAG, "[API_SUCCESS] Chat action successfully dispatched to " + urlStr + " (code=" + responseCode + ")");
                            break;
                        }
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                Log.w(TAG, "[API_ERROR] Chat action request failed: " + e.getMessage());
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
