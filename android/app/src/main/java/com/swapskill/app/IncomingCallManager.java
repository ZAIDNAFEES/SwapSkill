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
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK |
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
        startRingtone(context);

        // 4. Start repeating vibration
        startVibration(context);

        // 5. Build Full Screen Intent to wake device and show IncomingCallActivity over lock screen
        Intent fullScreenIntent = new Intent(context, IncomingCallActivity.class);
        fullScreenIntent.putExtra("callId", callId);
        fullScreenIntent.putExtra("sessionId", sessionId);
        fullScreenIntent.putExtra("callerName", callerName);
        fullScreenIntent.putExtra("callerPhoto", callerPhoto);
        fullScreenIntent.putExtra("callType", callType);
        fullScreenIntent.putExtra("skillName", skillName);
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

        // 6. Build Answer Action Intent
        Intent answerIntent = new Intent(context, MainActivity.class);
        answerIntent.setAction(Intent.ACTION_VIEW);
        answerIntent.setData(Uri.parse("swapskill://call/" + callId + "?sessionId=" + (sessionId != null ? sessionId : "") + "&autoAccept=true"));
        answerIntent.putExtra("callId", callId);
        answerIntent.putExtra("sessionId", sessionId);
        answerIntent.putExtra("autoAccept", true);
        answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent answerPendingIntent = PendingIntent.getActivity(
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

        int smallIcon = (context.getApplicationInfo() != null && context.getApplicationInfo().icon != 0)
                ? context.getApplicationInfo().icon
                : android.R.drawable.stat_sys_phone_call;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(smallIcon)
                .setContentTitle(callerName != null && !callerName.trim().isEmpty() ? callerName : "Skill Swap Partner")
                .setContentText(contentText)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(fullScreenPendingIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true)
                .addAction(android.R.drawable.ic_menu_call, "Answer", answerPendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePendingIntent);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try {
                nm.notify(activeNotificationId, builder.build());
            } catch (SecurityException se) {
                Log.e(TAG, "Notification permission missing: " + se.getMessage());
            } catch (Exception e) {
                Log.e(TAG, "Failed to post incoming call notification: " + e.getMessage());
            }
        }

        // 9. Auto-timeout after 35 seconds (safety against dropped signals)
        timeoutRunnable = () -> {
            Log.w(TAG, "[INCOMING_CALL] Ringing timed out after 35s for callId=" + callId);
            stopIncomingCall(context, callId);
        };
        mainHandler.postDelayed(timeoutRunnable, 35000);
    }

    public synchronized void stopIncomingCall(Context context, String callId) {
        if (callId != null && currentCallId != null && !callId.equals(currentCallId)) {
            // Not the current active call
            return;
        }

        Log.i(TAG, "[INCOMING_CALL] Stopping incoming call ringing for callId=" + (callId != null ? callId : currentCallId));

        if (timeoutRunnable != null) {
            mainHandler.removeCallbacks(timeoutRunnable);
            timeoutRunnable = null;
        }

        stopRingtone();
        stopVibration();

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
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Live Swap Calls",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Incoming audio and video call alerts for SwapSkill sessions");
                channel.enableVibration(true);
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

                Uri soundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
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
