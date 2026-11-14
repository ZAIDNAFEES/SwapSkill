import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
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
    public static final String CHANNEL_ID = "swapskill_ongoing_calls";
    public static final int NOTIFICATION_ID = 88201;

    public static volatile boolean isCallActive = false;
    public static volatile boolean isScreenSharingActive = false;
    public static volatile CallForegroundService instance = null;
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
        setScreenShareState(context, isSharing, activeCallId);
    }

    public static void setScreenShareState(Context context, boolean isSharing, @Nullable String callId) {
        if (context == null) return;

        // Strict active-call validation: if no call is active or service instance is stopped, NEVER dispatch screen-share intents
        // to prevent recreating notification 88201 or throwing ForegroundServiceDidNotStartInTimeException after call has ended!
        if (!isCallActive || instance == null) {
            android.util.Log.w("CallForegroundService", "[CALL_LIFECYCLE] setScreenShareState rejected at API boundary (no active call): isSharing=" + isSharing + ", targetCallId=" + callId + ", isCallActive=" + isCallActive + ", instance=" + instance);
            return;
        }

        // Strict callId matching: if intent is for an older/different call, reject purely without touching current call
        if (activeCallId != null && !activeCallId.trim().isEmpty()) {
            if (callId == null || callId.trim().isEmpty() || !activeCallId.trim().equalsIgnoreCase(callId.trim())) {
                android.util.Log.w("CallForegroundService", "[CALL_LIFECYCLE] setScreenShareState rejected at API boundary (callId mismatch): target=" + callId + ", active=" + activeCallId);
                return;
            }
        }

        try {
            Intent intent = new Intent(context, CallForegroundService.class);
            intent.setAction(isSharing ? ACTION_START_SCREEN_SHARE : ACTION_STOP_SCREEN_SHARE);
            if (callId != null && !callId.trim().isEmpty()) {
                intent.putExtra("callId", callId.trim());
            } else if (activeCallId != null && !activeCallId.trim().isEmpty()) {
                intent.putExtra("callId", activeCallId.trim());
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            android.util.Log.e("CallForegroundService", "[CALL_LIFECYCLE] Failed to update screen share state: " + e.getMessage(), e);
        }
    }

    public static synchronized void terminateNativeCall(Context context, @Nullable String callId, String reason) {
        android.util.Log.i("CallForegroundService", "[CALL_LIFECYCLE] Centralized terminateNativeCall invoked: reason=" + reason + ", targetCallId=" + callId + ", activeCallId=" + activeCallId);

        // Strict callId matching: if both target callId and activeCallId are non-empty,
        // do not kill a newer active call when a stale event for an older call arrives.
        if (callId != null && !callId.trim().isEmpty() && activeCallId != null && !activeCallId.trim().isEmpty()) {
            if (!activeCallId.trim().equals(callId.trim())) {
                android.util.Log.w("CallForegroundService", "[CALL_LIFECYCLE] terminateNativeCall ignored: target callId=" + callId + " does not match activeCallId=" + activeCallId);
                return;
            }
        }

        final String previousActiveCallId = activeCallId;
        final String resolvedCallId = (callId != null && !callId.trim().isEmpty()) ? callId : previousActiveCallId;

        // Clear native active call state FIRST (before stopping foreground service or screen capture)
        // so stale/asynchronous MediaProjection callbacks cannot call setScreenShareState() -> startForegroundService().
        isCallActive = false;
        isScreenSharingActive = false;
        activeCallId = "";
        activeSessionId = "";
        activePartnerName = "Skill Swap Partner";

        // 1. Immediately dismiss matching incoming ringing, vibration, and alert notifications
        if (context != null) {
            try {
                IncomingCallManager.getInstance(context).stopIncomingCall(context, resolvedCallId);
            } catch (Exception ignored) {}
        }

        // 2. Stop running foreground service instance
        if (instance != null) {
            try {
                instance.releaseWakeLock();
            } catch (Exception ignored) {}

            try {
                instance.stopForeground(true);
            } catch (Exception ignored) {}

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    instance.stopForeground(STOP_FOREGROUND_REMOVE);
                }
            } catch (Exception ignored) {}

            try {
                instance.stopSelf();
            } catch (Exception ignored) {}

            instance = null;
        }

        // 3. Stop service intent via Context
        if (context != null) {
            try {
                Intent intent = new Intent(context, CallForegroundService.class);
                context.stopService(intent);
            } catch (Exception ignored) {}
        }

        // 4. Force cancel notification ID 88201 and related notification IDs
        if (context != null) {
            try {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.cancel(NOTIFICATION_ID);
                    nm.cancel(1001);
                    if (callId != null && !callId.trim().isEmpty()) {
                        nm.cancel(Math.abs(callId.hashCode()));
                    }
                    if (previousActiveCallId != null && !previousActiveCallId.trim().isEmpty()) {
                        nm.cancel(Math.abs(previousActiveCallId.hashCode()));
                    }
                }
            } catch (Exception ignored) {}
        }

        // 5. Stop screen capture WITHOUT dispatching setScreenShareState(false) -> startForegroundService()
        if (context != null) {
            try {
                AndroidScreenShareManager.getInstance().stopCapture(context, false);
            } catch (Exception ignored) {}
        }

        // 6. Reset audio routing back to normal
        if (context != null) {
            try {
                AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
                if (am != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        am.clearCommunicationDevice();
                    }
                    am.setSpeakerphoneOn(false);
                    am.setMode(AudioManager.MODE_NORMAL);
                }
            } catch (Exception ignored) {}
        }

        // 7. Reset PiP state
        try {
            if (context instanceof MainActivity) {
                final MainActivity mainActivity = (MainActivity) context;
                mainActivity.runOnUiThread(() -> mainActivity.updatePipState(false));
            } else if (CallForegroundPlugin.instance != null && CallForegroundPlugin.instance.getActivity() instanceof MainActivity) {
                final MainActivity mainActivity = (MainActivity) CallForegroundPlugin.instance.getActivity();
                mainActivity.runOnUiThread(() -> mainActivity.updatePipState(false));
            }
        } catch (Exception ignored) {}
    }

    public static void stopService(Context context) {
        terminateNativeCall(context, null, "CallForegroundService.stopService");
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        if (ACTION_STOP_CALL.equals(action)) {
            String callId = intent.getStringExtra("callId");
            boolean fromNotification = intent.getBooleanExtra("fromNotificationButton", false);
            terminateNativeCall(this, callId, fromNotification ? "ACTION_STOP_CALL_NOTIFICATION" : "ACTION_STOP_CALL");
            if (fromNotification) {
                CallForegroundPlugin.notifyCallEndedByNotification();
            }
            return START_NOT_STICKY;
        }

        if (ACTION_START_SCREEN_SHARE.equals(action) || ACTION_STOP_SCREEN_SHARE.equals(action)) {
            String targetCallId = intent.getStringExtra("callId");

            // 1. Strict active-call validation: If no call is currently active or service is stopping,
            // fulfill foreground contract briefly if Android started via startForegroundService() and immediately remove + stopSelf()
            // so ForegroundServiceDidNotStartInTimeException can never be thrown and no orphaned notification appears.
            if (!isCallActive || instance == null) {
                android.util.Log.w("CallForegroundService", "[CALL_LIFECYCLE] Stale screen-share intent rejected (no active call): action=" + action + ", targetCallId=" + targetCallId + ", isCallActive=" + isCallActive + ", instance=" + instance);
                try {
                    Notification cleanupNotification = buildForegroundNotification("Skill Swap Partner", "Call Ended", "", "", currentCallType);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        startForeground(NOTIFICATION_ID, cleanupNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(NOTIFICATION_ID, cleanupNotification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
                    } else {
                        startForeground(NOTIFICATION_ID, cleanupNotification);
                    }
                } catch (Throwable ignored) {}
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        stopForeground(STOP_FOREGROUND_REMOVE);
                    } else {
                        stopForeground(true);
                    }
                    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm != null) {
                        nm.cancel(NOTIFICATION_ID);
                    }
                } catch (Exception ignored) {}
                instance = null;
                stopSelf();
                return START_NOT_STICKY;
            }

            // 2. Strict callId validation: If a call IS active, but intent is from a previous/different call,
            // reject purely without touching the new call!
            // - DO NOT cancel notification 88201
            // - DO NOT call stopForeground()
            // - DO NOT call stopSelf()
            // - DO NOT touch the new call's isScreenSharingActive state!
            boolean hasActiveCallId = activeCallId != null && !activeCallId.trim().isEmpty();
            boolean hasTargetCallId = targetCallId != null && !targetCallId.trim().isEmpty();
            boolean isCallIdMatch = hasActiveCallId && hasTargetCallId && activeCallId.trim().equalsIgnoreCase(targetCallId.trim());

            if (!isCallIdMatch) {
                android.util.Log.w("CallForegroundService", "[CALL_LIFECYCLE] Stale screen-share intent rejected during active call (callId mismatch): target=" + targetCallId + ", active=" + activeCallId + ", action=" + action + " (active call unharmed)");
                return START_NOT_STICKY;
            }

            boolean isSharing = ACTION_START_SCREEN_SHARE.equals(action);
            isScreenSharingActive = isSharing;
            android.util.Log.i("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_SCREEN_SHARE: state updated to isSharing=" + isSharing + " for callId=" + activeCallId);

            String statusText = isSharing ? "Screen Sharing" : ("audio".equalsIgnoreCase(currentCallType) ? "Voice Call" : "Live Video Call");
            Notification notification = buildForegroundNotification(activePartnerName, statusText, activeSessionId, activeCallId, currentCallType);
            applyForegroundServiceTypes(notification);
            return START_NOT_STICKY;
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

            return START_NOT_STICKY;
        }

        return START_NOT_STICKY;
    }

    private void applyForegroundServiceTypes(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                int serviceType = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                if (!"audio".equalsIgnoreCase(currentCallType)) {
                    serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
                }
                if (isScreenSharingActive) {
                    serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    serviceType |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
                }
                android.util.Log.d("CallForegroundService", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_TYPE: " + serviceType);
                startForeground(NOTIFICATION_ID, notification, serviceType);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Throwable t) {
            android.util.Log.w("CallForegroundService", "[CALL_LIFECYCLE] Typed startForeground failed, applying safe fallback: " + t.getMessage());
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
            } catch (Throwable fallbackErr) {
                android.util.Log.e("CallForegroundService", "[CALL_LIFECYCLE] Secondary fallback startForeground: " + fallbackErr.getMessage());
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
                    } else {
                        startForeground(NOTIFICATION_ID, notification);
                    }
                } catch (Throwable ignored) {}
            }
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
        stopIntent.putExtra("fromNotificationButton", true);
        if (callId != null && !callId.isEmpty()) {
            stopIntent.putExtra("callId", callId);
        } else if (activeCallId != null && !activeCallId.isEmpty()) {
            stopIntent.putExtra("callId", activeCallId);
        }
        PendingIntent stopPendingIntent = PendingIntent.getService(this, 1, stopIntent, pendingFlags);

        String effectiveCallType = callType != null ? callType : this.currentCallType;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setContentTitle("SwapSkill: In Call with " + partnerName)
                .setContentText("Active " + typeStr + " · Audio & Mic streaming")
                .setSubText("audio".equalsIgnoreCase(effectiveCallType) ? "Voice Call" : "Video Call")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setOngoing(true)
                .setSilent(true)
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
                        "Ongoing Live Swap Calls",
                        NotificationManager.IMPORTANCE_LOW
                );
                channel.setDescription("Ongoing audio and video call status for SwapSkill sessions");
                channel.enableVibration(false);
                channel.setSound(null, null);
                channel.setShowBadge(false);
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

    public void stopForegroundService() {
        terminateNativeCall(this, activeCallId, "stopForegroundService");
    }

    @Override
    public void onDestroy() {
        terminateNativeCall(this, activeCallId, "onDestroy");
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
