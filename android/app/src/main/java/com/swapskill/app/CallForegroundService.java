package com.swapskill.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Native Android Foreground Service for SwapSkill Live Swap Calls.
 * Keeps WebRTC media audio, microphone, and network sockets alive across
 * Home, app switching, and screen lock.
 */
public class CallForegroundService extends Service {

    public static final String ACTION_START_CALL = "com.swapskill.app.ACTION_START_CALL";
    public static final String ACTION_STOP_CALL = "com.swapskill.app.ACTION_STOP_CALL";
    public static final String ACTION_START_SCREEN_SHARE = "com.swapskill.app.ACTION_START_SCREEN_SHARE";
    public static final String ACTION_STOP_SCREEN_SHARE = "com.swapskill.app.ACTION_STOP_SCREEN_SHARE";
    public static final String CHANNEL_ID = "swapskill_calls";
    public static final int NOTIFICATION_ID = 88201;

    public static volatile boolean isCallActive = false;
    public static volatile boolean isScreenSharingActive = false;
    private static volatile String activePartnerName = "Skill Swap Partner";
    private static volatile String activeSessionId = "";
    private static volatile String activeCallId = "";

    private PowerManager.WakeLock wakeLock;
    private String currentCallType = "video";

    public static void startService(Context context, String partnerName, String callType, String sessionId, String callId) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, CallForegroundService.class);
            intent.setAction(ACTION_START_CALL);
            intent.putExtra("partnerName", partnerName);
            intent.putExtra("callType", callType);
            intent.putExtra("sessionId", sessionId);
            intent.putExtra("callId", callId);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            android.util.Log.e("CallForegroundService", "[CALL_LIFECYCLE] Failed to start service: " + e.getMessage(), e);
        }
    }

    public static void setScreenShareState(Context context, boolean isSharing) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, CallForegroundService.class);
            intent.setAction(isSharing ? ACTION_START_SCREEN_SHARE : ACTION_STOP_SCREEN_SHARE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            android.util.Log.e("CallForegroundService", "[CALL_LIFECYCLE] Failed to update screen share state: " + e.getMessage(), e);
        }
    }

    public static void stopService(Context context) {
        if (context == null) return;
        try {
            Intent intent = new Intent(context, CallForegroundService.class);
            intent.setAction(ACTION_STOP_CALL);
            context.startService(intent);
        } catch (Exception e) {
            android.util.Log.e("CallForegroundService", "[CALL_LIFECYCLE] Failed to stop service: " + e.getMessage(), e);
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_STOP_CALL.equals(action)) {
            isScreenSharingActive = false;
            stopForegroundService();
            CallForegroundPlugin.notifyCallEndedByNotification();
            return START_NOT_STICKY;
        }

        if (ACTION_START_SCREEN_SHARE.equals(action)) {
            isScreenSharingActive = true;
            android.util.Log.i("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_SCREEN_SHARE: Screen sharing activated");
            Notification notification = buildForegroundNotification(activePartnerName, "Screen Sharing", activeSessionId, activeCallId, currentCallType);
            applyForegroundServiceTypes(notification);
            return START_STICKY;
        }

        if (ACTION_STOP_SCREEN_SHARE.equals(action)) {
            isScreenSharingActive = false;
            android.util.Log.i("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_SCREEN_SHARE: Screen sharing stopped");
            String typeStr = "audio".equalsIgnoreCase(currentCallType) ? "Voice Call" : "Live Video Call";
            Notification notification = buildForegroundNotification(activePartnerName, typeStr, activeSessionId, activeCallId, currentCallType);
            applyForegroundServiceTypes(notification);
            return START_STICKY;
        }

        if (ACTION_START_CALL.equals(action)) {
            isCallActive = true;
            String partnerName = intent.getStringExtra("partnerName");
            if (partnerName == null || partnerName.trim().isEmpty()) {
                partnerName = "Skill Swap Partner";
            }
            activePartnerName = partnerName;
            String callType = intent.getStringExtra("callType");
            if (callType == null || callType.trim().isEmpty()) {
                callType = "video";
            }
            this.currentCallType = callType;
            String typeStr = "audio".equalsIgnoreCase(callType) ? "Voice Call" : "Live Video Call";
            String sessionId = intent.getStringExtra("sessionId");
            String callId = intent.getStringExtra("callId");
            if (sessionId != null) activeSessionId = sessionId;
            if (callId != null) activeCallId = callId;

            android.util.Log.i("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_START: Starting active call service for " + partnerName + " (" + typeStr + ")");

            // Acquire partial wake lock to prevent CPU sleep during active call
            acquireWakeLock();

            // Build foreground notification
            Notification notification = buildForegroundNotification(partnerName, typeStr, sessionId, callId, callType);
            applyForegroundServiceTypes(notification);

            return START_STICKY;
        }

        return START_NOT_STICKY;
    }

    private void applyForegroundServiceTypes(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                int serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL;
                if (MainActivity.isAppInForeground) {
                    serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                    if (!"audio".equalsIgnoreCase(currentCallType)) {
                        serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
                    }
                }
                if (isScreenSharingActive) {
                    serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
                }
                android.util.Log.d("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_TYPE: " + serviceType);
                startForeground(NOTIFICATION_ID, notification, serviceType);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                int serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                if (!"audio".equalsIgnoreCase(currentCallType)) {
                    serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
                }
                if (isScreenSharingActive) {
                    serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
                }
                android.util.Log.d("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_TYPE: " + serviceType);
                startForeground(NOTIFICATION_ID, notification, serviceType);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (SecurityException se) {
            android.util.Log.e("CallForegroundService", "[CALL_LIFECYCLE] SecurityException starting typed foreground service: " + se.getMessage(), se);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                try {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
                } catch (Exception fallbackErr) {
                    android.util.Log.e("CallForegroundService", "[CALL_LIFECYCLE] Fallback phoneCall type failed: " + fallbackErr.getMessage());
                }
            } else {
                try {
                    startForeground(NOTIFICATION_ID, notification);
                } catch (Exception ignored) {}
            }
        } catch (Exception e) {
            android.util.Log.e("CallForegroundService", "[CALL_LIFECYCLE] Exception starting foreground service: " + e.getMessage(), e);
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {}
        }
    }

    private Notification buildForegroundNotification(String partnerName, String typeStr, String sessionId, String callId, String callType) {
        // Pending intent to return to MainActivity / active call screen
        Intent returnIntent = new Intent(this, MainActivity.class);
        returnIntent.setAction(Intent.ACTION_VIEW);
        returnIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (sessionId != null && !sessionId.isEmpty()) {
            returnIntent.putExtra("sessionId", sessionId);
        }
        if (callId != null && !callId.isEmpty()) {
            returnIntent.putExtra("callId", callId);
        }

        int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentPendingIntent = PendingIntent.getActivity(this, 0, returnIntent, pendingFlags);

        // Pending intent to end call
        Intent stopIntent = new Intent(this, CallForegroundService.class);
        stopIntent.setAction(ACTION_STOP_CALL);
        PendingIntent stopPendingIntent = PendingIntent.getService(this, 1, stopIntent, pendingFlags);

        String effectiveCallType = callType != null ? callType : this.currentCallType;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setContentTitle("SwapSkill: In Call with " + partnerName)
                .setContentText("Active " + typeStr + " · Audio & Mic streaming")
                .setSubText("audio".equalsIgnoreCase(effectiveCallType) ? "Voice Call" : "Video Call")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setOngoing(true)
                .setContentIntent(contentPendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End Call", stopPendingIntent);

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Active Live Swap Calls",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Ongoing audio and video call status for SwapSkill sessions");
                channel.enableVibration(false);
                channel.setShowBadge(true);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SwapSkill:CallForegroundWakeLock");
                    wakeLock.acquire(120 * 60 * 1000L); // Max 2 hours safety limit
                    android.util.Log.i("CallForegroundService", "[CALL_LIFECYCLE] WAKELOCK_ACQUIRED: Held PARTIAL_WAKE_LOCK for WebRTC background calling");
                }
            } catch (Exception e) {
                android.util.Log.w("CallForegroundService", "[CALL_LIFECYCLE] Failed to acquire wake lock: " + e.getMessage());
            }
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
                android.util.Log.i("CallForegroundService", "[CALL_LIFECYCLE] WAKELOCK_RELEASED: Released wake lock");
            } catch (Exception ignored) {}
            wakeLock = null;
        }
    }

    private void stopForegroundService() {
        android.util.Log.i("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_STOP");
        isCallActive = false;
        releaseWakeLock();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NOTIFICATION_ID);
            }
        } catch (Exception ignored) {}
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopForegroundService();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
