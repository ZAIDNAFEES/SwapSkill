package com.swapskill.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;
import androidx.core.app.NotificationCompat;

/**
 * Singleton to manage incoming call ringing, vibration, full-screen notification,
 * and automatic ringing timeout across all Android lifecycle states.
 */
public class IncomingCallManager {

    private static final String TAG = "IncomingCallManager";
    public static final String CHANNEL_ID = "swapskill_calls";
    public static final String ACTION_CALL_CANCELLED = "com.swapskill.app.ACTION_CALL_CANCELLED";

    private static volatile IncomingCallManager instance;

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable timeoutRunnable;
    private String currentCallId;
    private int activeNotificationId = 0;

    private IncomingCallManager() {}

    public static IncomingCallManager getInstance(Context context) {
        if (instance == null) {
            synchronized (IncomingCallManager.class) {
                if (instance == null) {
                    instance = new IncomingCallManager();
                }
            }
        }
        return instance;
    }

    public synchronized void showIncomingCall(
            Context context,
            String callId,
            String sessionId,
            String callerName,
            String callerPhoto,
            String callType,
            String skillName
    ) {
        showIncomingCall(context, callId, sessionId, null, callerName, callerPhoto, callType, skillName, null);
    }

    public synchronized void showIncomingCall(
            Context context,
            String callId,
            String sessionId,
            String callerId,
            String callerName,
            String callerPhoto,
            String callType,
            String skillName,
            String conversationId
    ) {
        if (callId == null || callId.trim().isEmpty()) {
            return;
        }

        // If this exact call is already ringing, avoid duplicating
        if (callId.equals(currentCallId)) {
            Log.d(TAG, "Call " + callId + " is already ringing.");
            return;
        }

        // Stop any previous ringing call before starting new one
        stopIncomingCall(context, currentCallId);

        currentCallId = callId;
        activeNotificationId = Math.abs(callId.hashCode());
        Log.i(TAG, "[INCOMING_CALL] Starting incoming call ringing for callId=" + callId + " from " + callerName);

        // 1. Ensure high priority notification channel exists
        createCallsChannel(context);

        // 2. Wake device screen up if locked or dark
        try {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                if (wakeLock != null && wakeLock.isHeld()) {
                    try { wakeLock.release(); } catch (Exception ignored) {}
                }
                wakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK |
                        PowerManager.ACQUIRE_CAUSES_WAKEUP |
                        PowerManager.ON_AFTER_RELEASE,
                        "SwapSkill:IncomingCallWakeLock"
                );
                wakeLock.acquire(30000); // Max 30 seconds
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to acquire wake lock: " + e.getMessage());
        }

        // 3. Start looping ringtone
        try {
            startRingtone(context);
        } catch (Exception e) {
            Log.w(TAG, "Non-fatal error starting ringtone: " + e.getMessage());
        }

        // 4. Start repeating vibration
        try {
            startVibration(context);
        } catch (Exception e) {
            Log.w(TAG, "Non-fatal error starting vibration: " + e.getMessage());
        }

        // 5. Build Full Screen Intent to wake device and show IncomingCallActivity over lock screen
        Intent fullScreenIntent = new Intent(context, IncomingCallActivity.class);
        fullScreenIntent.putExtra("callId", callId);
        fullScreenIntent.putExtra("sessionId", sessionId);
        fullScreenIntent.putExtra("callerId", callerId);
        fullScreenIntent.putExtra("callerName", callerName);
        fullScreenIntent.putExtra("callerPhoto", callerPhoto);
        fullScreenIntent.putExtra("callType", callType);
        fullScreenIntent.putExtra("skillName", skillName);
        fullScreenIntent.putExtra("conversationId", conversationId);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                context,
                activeNotificationId,
                fullScreenIntent,
                pendingFlags
        );

        // 6. Build Immediate Native Answer Action Intent (routes to CallActionReceiver without waiting for React)
        Intent answerIntent = new Intent(context, CallActionReceiver.class);
        answerIntent.setAction(CallActionReceiver.ACTION_ACCEPT);
        answerIntent.putExtra("callId", callId);
        answerIntent.putExtra("sessionId", sessionId);
        answerIntent.putExtra("callerId", callerId);
        answerIntent.putExtra("callerName", callerName);
        answerIntent.putExtra("callerPhoto", callerPhoto);
        answerIntent.putExtra("callType", callType);
        answerIntent.putExtra("skillName", skillName);
        answerIntent.putExtra("conversationId", conversationId);

        PendingIntent answerPendingIntent = PendingIntent.getBroadcast(
                context,
                activeNotificationId + 1,
                answerIntent,
                pendingFlags
        );

        // 7. Build Decline Action Intent
        Intent declineIntent = new Intent(context, CallActionReceiver.class);
        declineIntent.setAction(CallActionReceiver.ACTION_DECLINE);
        declineIntent.putExtra("callId", callId);
        declineIntent.putExtra("sessionId", sessionId);

        PendingIntent declinePendingIntent = PendingIntent.getBroadcast(
                context,
                activeNotificationId + 2,
                declineIntent,
                pendingFlags
        );

        // 8. Assemble Notification with Heads-up Priority
        String typeLabel = "audio".equalsIgnoreCase(callType) ? "Voice" : "Video";
        String contentText = (skillName != null && !skillName.trim().isEmpty())
                ? "Live " + typeLabel + " Swap for " + skillName
                : "Incoming " + typeLabel + " Call";

        int smallIcon = android.R.drawable.stat_sys_phone_call;

        // Check Android 14+ (UPSIDE_DOWN_CAKE) Full-Screen Intent Permission
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        boolean canUseFullScreen = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            if (nm != null) {
                try {
                    canUseFullScreen = nm.canUseFullScreenIntent();
                } catch (Exception e) {
                    Log.w(TAG, "Error checking canUseFullScreenIntent: " + e.getMessage());
                }
            }
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(smallIcon)
                .setContentTitle(callerName != null && !callerName.trim().isEmpty() ? callerName : "Skill Swap Partner")
                .setContentText(contentText)
                .setStyle(new NotificationCompat.BigTextStyle()
                        .setBigContentTitle(callerName != null && !callerName.trim().isEmpty() ? callerName : "Skill Swap Partner")
                        .bigText(contentText))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS)
                .setVibrate(new long[]{0, 1000, 1000, 1000, 1000})
                .setLights(0xFF10B981, 1000, 1000)
                .setContentIntent(fullScreenPendingIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .addAction(android.R.drawable.ic_menu_call, "Answer", answerPendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePendingIntent);

        if (nm != null) {
            try {
                nm.notify(activeNotificationId, builder.build());
                Log.i(TAG, "[INCOMING_CALL] Successfully posted incoming call notification id=" + activeNotificationId);
            } catch (SecurityException se) {
                Log.e(TAG, "Notification permission missing: " + se.getMessage());
            } catch (Exception e) {
                Log.e(TAG, "Failed to post incoming call notification: " + e.getMessage());
            }
        }

        // On locked device, also attempt direct activity launch over keyguard if full screen intent is allowed
        if (canUseFullScreen) {
            android.app.KeyguardManager km = (android.app.KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null && km.isKeyguardLocked()) {
                try {
                    context.startActivity(fullScreenIntent);
                } catch (Exception e) {
                    Log.d(TAG, "Direct launch over keyguard fallback non-fatal: " + e.getMessage());
                }
            }
        }

        // 9. Auto-timeout after 35 seconds (safety against dropped signals)
        timeoutRunnable = () -> {
            Log.w(TAG, "[INCOMING_CALL] Ringing timed out after 35s for callId=" + callId);
            stopIncomingCall(context, callId);
        };
        mainHandler.postDelayed(timeoutRunnable, 35000);
    }

    /**
     * Immediately accepts the call from the native layer without waiting for React/WebView to initialize.
     * Starts CallForegroundService immediately, persists metadata to SharedPreferences,
     * updates the backend via async HTTP, and boots MainActivity into the pre-accepted call.
     */
    public synchronized void acceptCall(
            Context context,
            String callId,
            String sessionId,
            String callerId,
            String callerName,
            String callerPhoto,
            String callType,
            String skillName,
            String conversationId
    ) {
        if (callId == null || callId.trim().isEmpty()) {
            return;
        }

        final String finalCallId = callId.trim();
        final String finalSessionId = sessionId != null ? sessionId : "";
        final String safeName = (callerName != null && !callerName.trim().isEmpty()) ? callerName : "Skill Swap Partner";
        final String safeType = (callType != null && !callType.trim().isEmpty()) ? callType : "video";
        final String safeCallerId = callerId != null ? callerId : "";
        final String safePhoto = callerPhoto != null ? callerPhoto : "";
        final String safeSkill = skillName != null ? skillName : "";
        final String safeConvId = conversationId != null ? conversationId : "";

        Log.i(TAG, "[INCOMING_CALL] Immediate native call acceptance: callId=" + finalCallId + " partner=" + safeName);

        // 1. Immediately stop ringing, vibration, and dismiss notification
        stopIncomingCall(context, finalCallId);

        // 2. Start CallForegroundService immediately so process is protected and media service is active
        CallForegroundService.startService(context, safeName, safeType, finalSessionId, finalCallId);

        // 3. Persist accepted call to SharedPreferences so React can consume it without blocking on Firestore
        try {
            android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(context, "swapskill_call_prefs");
            if (prefs != null) {
                prefs.edit()
                        .putString("pending_accepted_call_id", finalCallId)
                        .putString("pending_accepted_session_id", finalSessionId)
                        .putString("pending_accepted_caller_id", safeCallerId)
                        .putString("pending_accepted_caller_name", safeName)
                        .putString("pending_accepted_caller_photo", safePhoto)
                        .putString("pending_accepted_call_type", safeType)
                        .putString("pending_accepted_skill_name", safeSkill)
                        .putString("pending_accepted_conversation_id", safeConvId)
                        .putLong("pending_accepted_timestamp", System.currentTimeMillis())
                        .putBoolean("pending_accepted_consumed", false)
                        .apply();
                Log.i(TAG, "[INCOMING_CALL] Saved pre-accepted call state to device-protected SharedPreferences");
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to persist accepted call prefs: " + e.getMessage());
        }

        // 3b. If React bridge is already active in memory and user is unlocked, immediately dispatch callAcceptedNatively
        if (SafeStorageUtils.isUserUnlocked(context)) {
            try {
                com.getcapacitor.JSObject jsObj = new com.getcapacitor.JSObject();
                jsObj.put("callId", finalCallId);
                jsObj.put("sessionId", finalSessionId);
                jsObj.put("callerId", safeCallerId);
                jsObj.put("callerName", safeName);
                jsObj.put("callerPhoto", safePhoto);
                jsObj.put("callType", safeType);
                jsObj.put("skillName", safeSkill);
                jsObj.put("conversationId", safeConvId);
                jsObj.put("alreadyAccepted", true);
                CallForegroundPlugin.notifyCallAcceptedNatively(jsObj);
            } catch (Exception e) {
                Log.d(TAG, "CallForegroundPlugin notifyCallAcceptedNatively non-fatal: " + e.getMessage());
            }
        }

        // 4. Asynchronously notify backend /api/calls/accept in background thread
        new Thread(() -> {
            android.content.SharedPreferences fcmPrefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(context, "swapskill_fcm_prefs");
            String customBackend = fcmPrefs != null ? fcmPrefs.getString("backend_api_url", null) : null;
            String idToken = fcmPrefs != null ? fcmPrefs.getString("current_id_token", null) : null;
            java.util.List<String> endpoints = new java.util.ArrayList<>();
            if (customBackend != null && !customBackend.trim().isEmpty()) {
                endpoints.add(customBackend.replaceAll("/+$", "") + "/api/calls/accept");
            }
            endpoints.add("https://swap-skill-gaa1.vercel.app/api/calls/accept");
            endpoints.add("https://swap-skill1.vercel.app/api/calls/accept");
            endpoints.add("https://swap-skill-cnge.vercel.app/api/calls/accept");
            endpoints.add("http://127.0.0.1:3000/api/calls/accept");

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

                    org.json.JSONObject payload = new org.json.JSONObject();
                    payload.put("callId", finalCallId);
                    payload.put("sessionId", finalSessionId);
                    if (idToken != null && !idToken.trim().isEmpty()) {
                        payload.put("idToken", idToken.trim());
                    }
                    String jsonPayload = payload.toString();
                    try (java.io.OutputStream os = conn.getOutputStream()) {
                        os.write(jsonPayload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    }
                    int responseCode = conn.getResponseCode();
                    Log.d(TAG, "Accept endpoint (" + endpointUrl + ") response code: " + responseCode);
                    conn.disconnect();
                    if (responseCode >= 200 && responseCode < 300) {
                        break;
                    }
                } catch (Exception e) {
                    Log.d(TAG, "Accept endpoint (" + endpointUrl + ") non-fatal: " + e.getMessage());
                }
            }
        }).start();

        // 5. Launch MainActivity with deep link and extras
        try {
            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.setAction(Intent.ACTION_VIEW);
            Uri callUri = Uri.parse("swapskill://call/" + Uri.encode(finalCallId) +
                    "?sessionId=" + Uri.encode(finalSessionId) +
                    "&autoAccept=true" +
                    "&alreadyAccepted=true" +
                    "&callerId=" + Uri.encode(safeCallerId) +
                    "&callerName=" + Uri.encode(safeName) +
                    "&callerPhoto=" + Uri.encode(safePhoto) +
                    "&callType=" + Uri.encode(safeType) +
                    "&skillName=" + Uri.encode(safeSkill) +
                    "&conversationId=" + Uri.encode(safeConvId));
            launchIntent.setData(callUri);
            launchIntent.putExtra("callId", finalCallId);
            launchIntent.putExtra("sessionId", finalSessionId);
            launchIntent.putExtra("autoAccept", true);
            launchIntent.putExtra("alreadyAccepted", true);
            launchIntent.putExtra("callerId", safeCallerId);
            launchIntent.putExtra("callerName", safeName);
            launchIntent.putExtra("callerPhoto", safePhoto);
            launchIntent.putExtra("callType", safeType);
            launchIntent.putExtra("skillName", safeSkill);
            launchIntent.putExtra("conversationId", safeConvId);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            context.startActivity(launchIntent);
            Log.i(TAG, "[INCOMING_CALL] Successfully launched MainActivity with alreadyAccepted=true");
        } catch (Exception e) {
            Log.e(TAG, "Failed to launch MainActivity after accept: " + e.getMessage(), e);
        }
    }

    /**
     * Immediately rejects the call from the native layer.
     */
    public synchronized void rejectCall(Context context, String callId, String sessionId, String reason) {
        if (callId == null || callId.trim().isEmpty()) {
            return;
        }

        final String finalCallId = callId.trim();
        final String finalReason = (reason != null && !reason.trim().isEmpty()) ? reason : "Declined by user";

        Log.i(TAG, "[INCOMING_CALL] Immediate native call rejection: callId=" + finalCallId + " reason=" + finalReason);
        stopIncomingCall(context, finalCallId);

        new Thread(() -> {
            android.content.SharedPreferences fcmPrefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(context, "swapskill_fcm_prefs");
            String customBackend = fcmPrefs != null ? fcmPrefs.getString("backend_api_url", null) : null;
            String idToken = fcmPrefs != null ? fcmPrefs.getString("current_id_token", null) : null;
            java.util.List<String> endpoints = new java.util.ArrayList<>();
            if (customBackend != null && !customBackend.trim().isEmpty()) {
                endpoints.add(customBackend.replaceAll("/+$", "") + "/api/calls/reject");
            }
            endpoints.add("https://swap-skill-gaa1.vercel.app/api/calls/reject");
            endpoints.add("https://swap-skill1.vercel.app/api/calls/reject");
            endpoints.add("https://swap-skill-cnge.vercel.app/api/calls/reject");
            endpoints.add("http://127.0.0.1:3000/api/calls/reject");

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

                    org.json.JSONObject payload = new org.json.JSONObject();
                    payload.put("callId", finalCallId);
                    payload.put("sessionId", sessionId != null ? sessionId : "");
                    payload.put("reason", finalReason);
                    if (idToken != null && !idToken.trim().isEmpty()) {
                        payload.put("idToken", idToken.trim());
                    }
                    String jsonPayload = payload.toString();
                    try (java.io.OutputStream os = conn.getOutputStream()) {
                        os.write(jsonPayload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    }
                    int responseCode = conn.getResponseCode();
                    Log.d(TAG, "Reject endpoint (" + endpointUrl + ") response code: " + responseCode);
                    conn.disconnect();
                    if (responseCode >= 200 && responseCode < 300) {
                        break;
                    }
                } catch (Exception e) {
                    Log.d(TAG, "Reject endpoint (" + endpointUrl + ") non-fatal: " + e.getMessage());
                }
            }
        }).start();
    }

    public synchronized void stopIncomingCall(Context context, String callId) {
        // Unconditionally silence ringtone and vibration immediately
        stopRingtone();
        stopVibration();

        if (callId != null && currentCallId != null && !callId.equals(currentCallId)) {
            // Not the current active call for notification/wakeLock dismissal
            return;
        }

        Log.i(TAG, "[INCOMING_CALL] Stopping incoming call ringing for callId=" + (callId != null ? callId : currentCallId));

        if (timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
            timeoutRunnable = null;
        }

        // Release WakeLock
        if (wakeLock != null) {
            try {
                if (wakeLock.isHeld()) {
                    wakeLock.release();
                }
            } catch (Exception ignored) {}
            wakeLock = null;
        }

        // Dismiss notification
        if (activeNotificationId != 0 && context != null) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                try {
                    nm.cancel(activeNotificationId);
                } catch (Exception ignored) {}
            }
            activeNotificationId = 0;
        }

        // Broadcast to finish IncomingCallActivity if displayed
        if (context != null) {
            Intent cancelBroadcast = new Intent(ACTION_CALL_CANCELLED);
            cancelBroadcast.setPackage(context.getPackageName());
            if (callId != null) {
                cancelBroadcast.putExtra("callId", callId);
            }
            try {
                context.sendBroadcast(cancelBroadcast);
            } catch (Exception ignored) {}
        }

        currentCallId = null;
    }

    private void startRingtone(Context context) {
        try {
            stopRingtone();
            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setDataSource(context, ringtoneUri);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                mediaPlayer.setAudioAttributes(attrs);
            } else {
                mediaPlayer.setAudioStreamType(AudioManager.STREAM_RING);
            }
            mediaPlayer.setLooping(true);
            mediaPlayer.prepare();
            mediaPlayer.start();
        } catch (Exception e) {
            Log.w(TAG, "Could not play looping ringtone via MediaPlayer: " + e.getMessage());
        }
    }

    private void stopRingtone() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.reset();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }
    }

    private void startVibration(Context context) {
        try {
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = new long[]{0, 1000, 1000, 1000, 1000};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Vibration failed: " + e.getMessage());
        }
    }

    private void stopVibration() {
        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception ignored) {}
            vibrator = null;
        }
    }

    private void createCallsChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel existing = nm.getNotificationChannel(CHANNEL_ID);
                if (existing != null && existing.getImportance() < NotificationManager.IMPORTANCE_HIGH) {
                    try {
                        nm.deleteNotificationChannel(CHANNEL_ID);
                    } catch (Exception ignored) {}
                }
                if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                    NotificationChannel channel = new NotificationChannel(
                            CHANNEL_ID,
                            "Live Swap Calls",
                            NotificationManager.IMPORTANCE_HIGH
                    );
                channel.setDescription("Incoming audio and video call alerts for SwapSkill sessions");
                channel.enableVibration(true);
                channel.setVibrationPattern(new long[]{0, 1000, 1000, 1000, 1000});
                channel.enableLights(true);
                channel.setLightColor(0xFF10B981);
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                channel.setBypassDnd(true);

                Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (soundUri == null) {
                    soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                }
                if (soundUri != null) {
                    AudioAttributes audioAttributes = new AudioAttributes.Builder()
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING)
                            .build();
                    channel.setSound(soundUri, audioAttributes);
                }
                nm.createNotificationChannel(channel);
            }
        }
    }
}
