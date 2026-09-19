package com.swapskill.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
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
        if (data == null || data.isEmpty()) {
            // Standard notification with empty data - let Capacitor process if active
            try {
                PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
            } catch (Exception ignored) {}
            return;
        }

        String type = data.get("type");
        String callId = data.get("callId");

        Log.i(TAG, "[FCM_MESSAGE] Received remote message. type=" + type + ", callId=" + callId);

        // 1. Handle Incoming Call (Data Message from FCM)
        if ("incoming_call".equals(type) || (callId != null && !callId.isEmpty() && !"call_cancelled".equals(type) && !"call_ended".equals(type))) {
            String sessionId = data.get("sessionId");
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

            Log.i(TAG, "[CALL_PUSH] INCOMING_CALL received: callId=" + callId + ", caller=" + callerName + ", foreground=" + MainActivity.isAppInForeground);

            // Notify Capacitor in case WebView/React is alive in foreground or background
            try {
                PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
            } catch (Exception ignored) {}

            // If the app is NOT in foreground (background, recent-apps swiped away, or process killed),
            // trigger the native incoming call manager for ringing, vibration, wake-lock & full-screen UI!
            if (!MainActivity.isAppInForeground) {
                IncomingCallManager.getInstance(this).showIncomingCall(
                        this,
                        callId,
                        sessionId,
                        callerName,
                        callerPhoto,
                        callType,
                        skillName
                );
            }
            return;
        }

        // 2. Handle Remote Call Cancellation / Hangup
        if ("call_cancelled".equals(type) || "call_ended".equals(type)) {
            Log.i(TAG, "[CALL_PUSH] Remote call cancelled/ended: callId=" + callId);
            IncomingCallManager.getInstance(this).stopIncomingCall(this, callId);
            try {
                PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
            } catch (Exception ignored) {}
            return;
        }

        // 3. Normal notifications (Chat message, Session alarm, Announcement)
        // First, forward to Capacitor plugin if active
        try {
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
        } catch (Exception e) {
            Log.d(TAG, "PushNotificationsPlugin could not receive message (normal if app is closed): " + e.getMessage());
        }

        // If the app is in background or killed state, and there's no system notification object,
        // present a native notification in the system tray so user gets alerted.
        if (!MainActivity.isAppInForeground && remoteMessage.getNotification() == null) {
            showStandardDataNotification(data);
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        Log.i(TAG, "New FCM Registration Token generated: " + (token.length() > 10 ? token.substring(0, 10) + "..." : token));
        
        // Cache token in SharedPreferences for immediate retrieval on cold start
        try {
            getSharedPreferences("swapskill_fcm_prefs", Context.MODE_PRIVATE)
                    .edit()
                    .putString("latest_fcm_token", token)
                    .apply();
        } catch (Exception ignored) {}

        try {
            PushNotificationsPlugin.onNewToken(token);
        } catch (Exception e) {
            Log.w(TAG, "Failed to pass new token to Capacitor: " + e.getMessage());
        }
    }

    private void showStandardDataNotification(Map<String, String> data) {
        String title = data.get("title");
        String body = data.get("body");
        if (title == null || title.trim().isEmpty()) {
            return;
        }

        String channelId = data.get("channelId");
        if (channelId == null || channelId.trim().isEmpty()) {
            channelId = "swapskill_general";
        }

        ensureChannelExists(channelId);

        String chatId = data.get("chatId");
        String sessionId = data.get("sessionId");

        Intent clickIntent = new Intent(this, MainActivity.class);
        clickIntent.setAction(Intent.ACTION_VIEW);
        if (chatId != null && !chatId.isEmpty()) {
            clickIntent.setData(Uri.parse("swapskill://chat/" + chatId));
        } else if (sessionId != null && !sessionId.isEmpty()) {
            clickIntent.setData(Uri.parse("swapskill://session/" + sessionId));
        } else {
            clickIntent.setData(Uri.parse("swapskill://home"));
        }
        clickIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        int notifId = (title + (body != null ? body : "")).hashCode();
        PendingIntent contentPendingIntent = PendingIntent.getActivity(this, notifId, clickIntent, pendingFlags);

        int smallIcon = (getApplicationInfo() != null && getApplicationInfo().icon != 0)
                ? getApplicationInfo().icon
                : android.R.drawable.stat_notify_chat;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(smallIcon)
                .setContentTitle(title)
                .setContentText(body != null ? body : "")
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(contentPendingIntent);

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.notify(notifId, builder.build());
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
                int importance = NotificationManager.IMPORTANCE_DEFAULT;
                if ("swapskill_messages".equals(channelId)) {
                    name = "Chat Messages";
                    importance = NotificationManager.IMPORTANCE_HIGH;
                } else if ("swapskill_session_alarms".equals(channelId)) {
                    name = "Session Reminders";
                    importance = NotificationManager.IMPORTANCE_HIGH;
                }
                NotificationChannel channel = new NotificationChannel(channelId, name, importance);
                nm.createNotificationChannel(channel);
            }
        }
    }
}
