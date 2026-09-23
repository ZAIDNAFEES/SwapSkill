package com.swapskill.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Custom FirebaseMessagingService for SwapSkill.
 * Intercepts high-priority FCM data messages across foreground, background, locked, and closed states.
 * Guarantees native incoming call handling and reliable normal notification routing.
 */
public class SwapSkillMessagingService extends FirebaseMessagingService {

    private static final String TAG = "SwapSkillFCM";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        boolean userUnlocked = SafeStorageUtils.isUserUnlocked(this);

        if (data == null || data.isEmpty()) {
            // Standard notification with empty data - let Capacitor process if user is unlocked
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

        // 1. Handle Incoming Call (Data Message from FCM)
        if ("incoming_call".equals(type) || (callId != null && !callId.isEmpty() && !"call_cancelled".equals(type) && !"call_ended".equals(type))) {
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

            Log.i(TAG, "[CALL_PUSH] INCOMING_CALL received: callId=" + callId + ", caller=" + callerName + ", foreground=" + MainActivity.isAppInForeground);

            // Notify Capacitor only if user is unlocked and WebView is active
            if (userUnlocked) {
                try {
                    PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
                } catch (Exception ignored) {}
            }

            // If the app is NOT in foreground (background, recent-apps swiped away, or process killed),
            // trigger the native incoming call manager for ringing, vibration, wake-lock & full-screen UI!
            if (!MainActivity.isAppInForeground) {
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

        // 2. Handle Remote Call Cancellation / Hangup
        if ("call_cancelled".equals(type) || "call_ended".equals(type)) {
            Log.i(TAG, "[CALL_PUSH] Remote call cancelled/ended: callId=" + callId);
            IncomingCallManager.getInstance(this).stopIncomingCall(this, callId);
            if (userUnlocked) {
                try {
                    PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
                } catch (Exception ignored) {}
            }
            return;
        }

        // 3. Normal notifications (Chat message, Session alarm, Announcement)
        // Forward to Capacitor plugin only if device is unlocked
        if (userUnlocked) {
            try {
                PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
            } catch (Exception e) {
                Log.d(TAG, "PushNotificationsPlugin could not receive message (normal if app is closed): " + e.getMessage());
            }
        }

        // Check if screen is locked or app is backgrounded/killed
        android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        boolean isLocked = km != null && km.isKeyguardLocked();

        // If app is not in foreground or device is locked, present native heads-up notification in system tray
        if (!MainActivity.isAppInForeground || isLocked) {
            // Briefly acquire wake lock to ensure CPU processes and rings alert on aggressive battery managers (Infinix/XOS)
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

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        Log.i(TAG, "[TOKEN_SYNC] New FCM Registration Token generated: " + (token.length() > 10 ? token.substring(0, 10) + "..." : token));
        
        // Cache token in device-protected SharedPreferences for immediate retrieval on cold start & Direct Boot
        try {
            android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(this, "swapskill_fcm_prefs");
            if (prefs != null) {
                prefs.edit()
                        .putString("latest_fcm_token", token)
                        .putLong("token_timestamp", System.currentTimeMillis())
                        .apply();
            }
        } catch (Exception ignored) {}

        // Forward to Capacitor plugin if user is unlocked
        if (SafeStorageUtils.isUserUnlocked(this)) {
            try {
                PushNotificationsPlugin.onNewToken(token);
            } catch (Exception e) {
                Log.w(TAG, "Failed to pass new token to Capacitor: " + e.getMessage());
            }
        }

        // Asynchronously sync new token to backend in background even if app is terminated
        new Thread(() -> {
            try {
                android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(this, "swapskill_fcm_prefs");
                if (prefs == null) return;
                String userId = prefs.getString("current_user_id", null);
                String customBackend = prefs.getString("backend_api_url", null);
                String idToken = prefs.getString("current_id_token", null);
                if (userId != null && !userId.trim().isEmpty()) {
                    java.util.List<String> endpoints = new java.util.ArrayList<>();
                    if (customBackend != null && !customBackend.trim().isEmpty()) {
                        endpoints.add(customBackend.replaceAll("/+$", "") + "/api/notifications/sync-token");
                    }
                    endpoints.add("https://swap-skill-gaa1.vercel.app/api/notifications/sync-token");
                    endpoints.add("https://swap-skill1.vercel.app/api/notifications/sync-token");
                    endpoints.add("https://swap-skill-cnge.vercel.app/api/notifications/sync-token");
                    endpoints.add("http://127.0.0.1:3000/api/notifications/sync-token");

                    String jsonPayload = "{\"userId\":\"" + userId + "\",\"token\":\"" + token + "\",\"platform\":\"android\"}";
                    for (String endpointUrl : endpoints) {
                        try {
                            java.net.URL url = new java.net.URL(endpointUrl);
                            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                            conn.setRequestMethod("POST");
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
                                Log.i(TAG, "[TOKEN_SYNC] Successfully synced refreshed token to " + endpointUrl);
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

    private void showStandardDataNotification(Map<String, String> data) {
        String title = data.get("title");
        if (title == null || title.trim().isEmpty()) {
            title = data.get("senderName");
        }
        if (title == null || title.trim().isEmpty()) {
            title = "SwapSkill";
        }

        String body = data.get("body");
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

        ensureChannelExists(channelId);

        String chatId = data.get("chatId");
        String sessionId = data.get("sessionId");
        String callId = data.get("callId");
        boolean isCall = "incoming_call".equals(data.get("type")) || (callId != null && !callId.isEmpty() && !"call_cancelled".equals(data.get("type")) && !"call_ended".equals(data.get("type")));

        Intent clickIntent = new Intent(this, MainActivity.class);
        clickIntent.setAction(Intent.ACTION_VIEW);
        if (chatId != null && !chatId.isEmpty()) {
            clickIntent.setData(Uri.parse("swapskill://chat/" + chatId));
        } else if (sessionId != null && !sessionId.isEmpty()) {
            clickIntent.setData(Uri.parse("swapskill://session/" + sessionId));
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
        } else if (chatId != null && !chatId.isEmpty()) {
            notifId = Math.abs(chatId.hashCode());
        } else if (sessionId != null && !sessionId.isEmpty()) {
            notifId = Math.abs(sessionId.hashCode());
        } else {
            notifId = Math.abs((title + body).hashCode());
        }

        PendingIntent contentPendingIntent = PendingIntent.getActivity(this, notifId, clickIntent, pendingFlags);

        int smallIcon = isCall
                ? android.R.drawable.stat_sys_phone_call
                : ((getApplicationInfo() != null && getApplicationInfo().icon != 0)
                        ? getApplicationInfo().icon
                        : android.R.drawable.stat_notify_chat);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(smallIcon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setAutoCancel(!isCall)
                .setOngoing(isCall)
                .setPriority(isCall ? NotificationCompat.PRIORITY_MAX : NotificationCompat.PRIORITY_HIGH)
                .setCategory(isCall ? NotificationCompat.CATEGORY_CALL : NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
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
                Log.i(TAG, "[CHAT_NOTIF] Posted native notification id=" + notifId + " for " + title);
            } catch (Exception e) {
                Log.w(TAG, "Failed to post standard notification: " + e.getMessage());
            }
        }
    }

    private void ensureChannelExists(String channelId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
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
