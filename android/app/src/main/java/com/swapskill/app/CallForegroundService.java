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
    public static final String CHANNEL_ID = "swapskill_calls";
    public static final int NOTIFICATION_ID = 88201;

    public static volatile boolean isCallActive = false;

    private PowerManager.WakeLock wakeLock;

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
            stopForegroundService();
            CallForegroundPlugin.notifyCallEndedByNotification();
            return START_NOT_STICKY;
        }

        if (ACTION_START_CALL.equals(action)) {
            isCallActive = true;
            String partnerName = intent.getStringExtra("partnerName");
            if (partnerName == null || partnerName.trim().isEmpty()) {
                partnerName = "Skill Swap Partner";
            }
            String callType = intent.getStringExtra("callType");
            String typeStr = "audio".equalsIgnoreCase(callType) ? "Voice Call" : "Live Video Call";
            String sessionId = intent.getStringExtra("sessionId");
            String callId = intent.getStringExtra("callId");

            android.util.Log.i("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_START: Starting active call service for " + partnerName + " (" + typeStr + ")");

            // Acquire partial wake lock to prevent CPU sleep during active call
            acquireWakeLock();

            // Build foreground notification
            Notification notification = buildForegroundNotification(partnerName, typeStr, sessionId, callId);

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    // On Android 14+ (API 34+), foreground services started from background notification
                    // actions may not have immediate camera/microphone permissions until the activity is in foreground.
                    // PHONE_CALL foregroundServiceType is explicitly allowed from background notification actions.
                    int serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL;
                    if (MainActivity.isAppInForeground) {
                        serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                        if (!"audio".equalsIgnoreCase(callType)) {
                            serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
                        }
                    }
                    android.util.Log.d("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_TYPE: " + serviceType);
                    startForeground(NOTIFICATION_ID, notification, serviceType);
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    int serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                    if (!"audio".equalsIgnoreCase(callType)) {
                        serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
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

            return START_STICKY;
        }

        return START_NOT_STICKY;
    }

    private Notification buildForegroundNotification(String partnerName, String typeStr, String sessionId, String callId) {
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

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setContentTitle("SwapSkill: In Call with " + partnerName)
                .setContentText("Active " + typeStr + " · Audio & Mic streaming")
                .setSubText("Live Swap")
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
