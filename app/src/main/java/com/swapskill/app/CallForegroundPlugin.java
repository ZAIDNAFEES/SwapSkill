package com.swapskill.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.media.projection.MediaProjectionManager;
import android.media.AudioManager;
import android.media.AudioDeviceInfo;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.URL;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor Plugin interface for Android CallForegroundService,
 * Picture-in-Picture (PiP), and screen lock telemetry.
 */
@CapacitorPlugin(name = "CallForegroundPlugin")
public class CallForegroundPlugin extends Plugin {

    public static CallForegroundPlugin instance;
    public static volatile JSObject pendingAcceptedCallCache = null;
    public static volatile String pendingChatIdCache = null;
    private BroadcastReceiver screenStateReceiver;

    @Override
    public void load() {
        super.load();
        instance = this;
        registerScreenStateReceiver();
        if (pendingAcceptedCallCache != null) {
            final JSObject cached = pendingAcceptedCallCache;
            String cachedCallId = cached.getString("callId", "");
            if (cachedCallId != null && !cachedCallId.isEmpty() && IncomingCallManager.getInstance(getContext()).isCallTerminated(cachedCallId)) {
                pendingAcceptedCallCache = null;
            } else {
                android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] Delivering cached accepted call on plugin load");
                notifyListeners("callAcceptedNatively", cached);
            }
        }
        if (pendingChatIdCache != null && !pendingChatIdCache.isEmpty()) {
            final String cachedChatId = pendingChatIdCache;
            JSObject chatObj = new JSObject();
            chatObj.put("chatId", cachedChatId);
            notifyListeners("chatNotificationOpened", chatObj);
        }
    }

    private void registerScreenStateReceiver() {
        if (screenStateReceiver != null) return;
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_SCREEN_OFF);
            filter.addAction(Intent.ACTION_SCREEN_ON);
            filter.addAction(Intent.ACTION_USER_PRESENT);

            screenStateReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (intent == null || intent.getAction() == null) return;
                    String action = intent.getAction();
                    if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                        android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] SCREEN_LOCK (Device screen turned off)");
                        JSObject ret = new JSObject();
                        ret.put("screenLocked", true);
                        notifyListeners("screenLockStateChanged", ret);
                    } else if (Intent.ACTION_SCREEN_ON.equals(action) || Intent.ACTION_USER_PRESENT.equals(action)) {
                        android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] SCREEN_UNLOCK (Device screen on / unlocked)");
                        JSObject ret = new JSObject();
                        ret.put("screenLocked", false);
                        notifyListeners("screenLockStateChanged", ret);
                    }
                }
            };

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                getContext().registerReceiver(screenStateReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                getContext().registerReceiver(screenStateReceiver, filter);
            }
        } catch (Exception e) {
            android.util.Log.w("CallForegroundPlugin", "Failed to register screen state receiver: " + e.getMessage());
        }
    }

    public static void notifyCallEndedByNotification() {
        if (instance != null) {
            JSObject ret = new JSObject();
            ret.put("source", "notification");
            instance.notifyListeners("callEndedByNotification", ret);
        }
    }

    public static void notifyCallAcceptedNatively(JSObject callData) {
        if (callData != null) {
            pendingAcceptedCallCache = callData;
        }
        if (instance != null) {
            android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] Emitting callAcceptedNatively event to JS bridge");
            instance.notifyListeners("callAcceptedNatively", callData);
        } else {
            android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] Instance not yet bound, cached pendingAcceptedCallCache for bridge startup");
        }
    }

    public static void notifyMessageRepliedNatively(JSObject replyData) {
        if (instance != null && replyData != null) {
            android.util.Log.i("CallForegroundPlugin", "[CHAT_ACTION] Emitting messageRepliedNatively event to JS bridge");
            instance.notifyListeners("messageRepliedNatively", replyData);
        }
    }

    public static void notifyChatOpenedNatively(String chatId) {
        if (chatId == null || chatId.trim().isEmpty()) return;
        String cleanId = chatId.trim();
        pendingChatIdCache = cleanId;
        if (instance != null) {
            JSObject ret = new JSObject();
            ret.put("chatId", cleanId);
            instance.notifyListeners("chatNotificationOpened", ret);
        }
    }

    public static void notifyChatMutedNatively(String chatId) {
        if (chatId == null || chatId.trim().isEmpty()) return;
        if (instance != null) {
            JSObject ret = new JSObject();
            ret.put("chatId", chatId.trim());
            instance.notifyListeners("chatMutedNatively", ret);
        }
    }

    @PluginMethod
    public void getFcmToken(PluginCall call) {
        try {
            final android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(getContext(), "swapskill_fcm_prefs");
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    if (!task.isSuccessful()) {
                        android.util.Log.w("CallForegroundPlugin", "[TOKEN_SYNC] FirebaseMessaging.getToken failed", task.getException());
                        String cachedToken = prefs != null ? prefs.getString("latest_fcm_token", null) : null;
                        JSObject ret = new JSObject();
                        ret.put("token", cachedToken != null ? cachedToken : "");
                        call.resolve(ret);
                        return;
                    }

                    String token = task.getResult();
                    android.util.Log.i("CallForegroundPlugin", "[TOKEN_SYNC] FirebaseMessaging.getToken success");

                    if (token != null && !token.isEmpty() && prefs != null) {
                        prefs.edit()
                                .putString("latest_fcm_token", token)
                                .putLong("token_timestamp", System.currentTimeMillis())
                                .apply();
                    }

                    JSObject ret = new JSObject();
                    ret.put("token", token != null ? token : "");
                    call.resolve(ret);
                });
        } catch (Exception e) {
            android.util.Log.e("CallForegroundPlugin", "[TOKEN_SYNC] Error in getFcmToken: " + e.getMessage(), e);
            android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(getContext(), "swapskill_fcm_prefs");
            String cachedToken = prefs != null ? prefs.getString("latest_fcm_token", null) : null;
            JSObject ret = new JSObject();
            ret.put("token", cachedToken != null ? cachedToken : "");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void setPushUserId(PluginCall call) {
        String userId = call.getString("userId", "");
        String backendUrl = call.getString("backendUrl", "");
        String idToken = call.getString("idToken", "");
        String displayName = call.getString("displayName", "");
        try {
            android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(getContext(), "swapskill_fcm_prefs");
            if (prefs != null) {
                android.content.SharedPreferences.Editor editor = prefs.edit();
                if (userId != null && !userId.isEmpty()) {
                    editor.putString("current_user_id", userId);
                }
                if (backendUrl != null && !backendUrl.isEmpty() && SwapSkillMessagingService.isAllowedBackendOrigin(backendUrl)) {
                    editor.putString("backend_api_url", backendUrl.trim());
                }
                if (idToken != null && !idToken.isEmpty()) {
                    editor.putString("current_id_token", idToken);
                }
                if (displayName != null && !displayName.isEmpty()) {
                    editor.putString("current_display_name", displayName);
                }
                editor.apply();
                android.util.Log.i("CallForegroundPlugin", "[TOKEN_SYNC] Cached push configuration hasIdToken=" + (idToken != null && !idToken.isEmpty()));
            }
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("saved", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkCallPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            boolean notifsGranted = androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
            ret.put("notificationsGranted", notifsGranted);

            boolean fullScreenGranted = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                android.app.NotificationManager nm = (android.app.NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    fullScreenGranted = nm.canUseFullScreenIntent();
                }
            }
            ret.put("fullScreenIntentGranted", fullScreenGranted);

            boolean batteryOptimizedIgnored = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    batteryOptimizedIgnored = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
                }
            }
            ret.put("ignoringBatteryOptimizations", batteryOptimizedIgnored);
            call.resolve(ret);
        } catch (Exception e) {
            ret.put("notificationsGranted", true);
            ret.put("fullScreenIntentGranted", true);
            ret.put("ignoringBatteryOptimizations", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                String packageName = getContext().getPackageName();
                android.os.PowerManager pm = (android.os.PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                    Intent intent = new Intent();
                    intent.setAction(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(android.net.Uri.parse("package:" + packageName));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                    JSObject ret = new JSObject();
                    ret.put("requested", true);
                    call.resolve(ret);
                    return;
                }
            }
            JSObject ret = new JSObject();
            ret.put("requested", false);
            call.resolve(ret);
        } catch (Exception e) {
            android.util.Log.w("CallForegroundPlugin", "Could not request ignore battery optimizations: " + e.getMessage());
            JSObject ret = new JSObject();
            ret.put("requested", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                Intent intent = new Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                intent.setData(android.net.Uri.parse("package:" + getContext().getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("opened", true);
                call.resolve(ret);
                return;
            }
            JSObject ret = new JSObject();
            ret.put("opened", false);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("opened", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    public void notifyPipModeChanged(boolean inPip) {
        JSObject ret = new JSObject();
        ret.put("inPip", inPip);
        notifyListeners("pipModeChanged", ret);
    }

    @PluginMethod
    public void startCallForeground(PluginCall call) {
        try {
            String partnerName = call.getString("partnerName", "Partner");
            String callType = call.getString("callType", "video");
            String sessionId = call.getString("sessionId", "");
            String callId = call.getString("callId", "");

            android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_START requested from Web layer for " + partnerName);

            Intent intent = new Intent(getContext(), CallForegroundService.class);
            intent.setAction(CallForegroundService.ACTION_START_CALL);
            intent.putExtra("partnerName", partnerName);
            intent.putExtra("callType", callType);
            intent.putExtra("sessionId", sessionId);
            intent.putExtra("callId", callId);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }

            // Enable auto-enter Picture-in-Picture on Android 12+ while call is active
            Activity activity = getActivity();
            if (activity instanceof MainActivity) {
                final MainActivity mainActivity = (MainActivity) activity;
                activity.runOnUiThread(() -> mainActivity.updatePipState(true));
            }

            JSObject ret = new JSObject();
            ret.put("started", true);
            call.resolve(ret);
        } catch (Exception e) {
            android.util.Log.e("CallForegroundPlugin", "[CALL_LIFECYCLE] Failed to start call foreground service: " + e.getMessage(), e);
            call.reject("Failed to start call foreground service: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopCallForeground(PluginCall call) {
        try {
            String callId = call != null ? call.getString("callId", null) : null;
            android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_STOP requested from Web layer for callId=" + callId);
            
            // Invoke the single centralized, idempotent termination method
            Context ctx = getContext();
            CallForegroundService.terminateNativeCall(ctx, callId, "plugin_stopCallForeground");

            JSObject ret = new JSObject();
            ret.put("stopped", true);
            if (call != null) {
                call.resolve(ret);
            }
        } catch (Exception e) {
            android.util.Log.e("CallForegroundPlugin", "[CALL_LIFECYCLE] Failed to stop call foreground service: " + e.getMessage(), e);
            if (call != null) {
                call.reject("Failed to stop call foreground service: " + e.getMessage(), e);
            }
        }
    }

    @PluginMethod
    public void setAudioRoute(PluginCall call) {
        try {
            String route = call.getString("route", "speaker");
            Context ctx = getContext();
            if (ctx == null) {
                call.reject("Context not available");
                return;
            }
            AudioManager audioManager = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager == null) {
                call.reject("AudioManager not available");
                return;
            }

            boolean isSpeaker = "speaker".equalsIgnoreCase(route);
            // Put audio manager into VoIP communication mode so WebRTC and Android audio output to selected receiver
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);

            boolean deviceSwitched = false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) { // Android 12+ (API 31+)
                List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                AudioDeviceInfo targetDevice = null;
                int targetType = isSpeaker ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;

                for (AudioDeviceInfo dev : devices) {
                    if (dev.getType() == targetType) {
                        targetDevice = dev;
                        break;
                    }
                }

                if (targetDevice != null) {
                    deviceSwitched = audioManager.setCommunicationDevice(targetDevice);
                    android.util.Log.i("CallForegroundPlugin", "[AUDIO_ROUTE] setCommunicationDevice to " + (isSpeaker ? "SPEAKER" : "EARPIECE") + " succeeded=" + deviceSwitched);
                } else {
                    android.util.Log.w("CallForegroundPlugin", "[AUDIO_ROUTE] target device type " + targetType + " not found, falling back to setSpeakerphoneOn");
                    audioManager.setSpeakerphoneOn(isSpeaker);
                    deviceSwitched = true;
                }
            } else {
                // Android 11 and earlier
                audioManager.setSpeakerphoneOn(isSpeaker);
                deviceSwitched = true;
                android.util.Log.i("CallForegroundPlugin", "[AUDIO_ROUTE] Legacy setSpeakerphoneOn(" + isSpeaker + ")");
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("route", route);
            ret.put("isSpeaker", isSpeaker);
            ret.put("deviceSwitched", deviceSwitched);
            call.resolve(ret);
        } catch (Exception e) {
            android.util.Log.e("CallForegroundPlugin", "[AUDIO_ROUTE] Failed to set audio route: " + e.getMessage(), e);
            call.reject("Failed to set audio route: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void startNativeScreenShare(PluginCall call) {
        try {
            Activity activity = getActivity();
            if (activity == null) {
                call.reject("Activity not available");
                return;
            }
            MediaProjectionManager mgr = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (mgr == null) {
                call.reject("MediaProjectionManager not available on this device");
                return;
            }
            Intent captureIntent = mgr.createScreenCaptureIntent();
            startActivityForResult(call, captureIntent, "handleScreenCaptureResult");
        } catch (Exception e) {
            android.util.Log.e("CallForegroundPlugin", "startNativeScreenShare error: " + e.getMessage(), e);
            call.reject("Could not request screen share: " + e.getMessage(), e);
        }
    }

    @ActivityCallback
    private void handleScreenCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
                boolean success = AndroidScreenShareManager.getInstance().startCapture(
                        getContext(),
                        result.getResultCode(),
                        result.getData()
                );
                if (success) {
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("streamUrl", AndroidScreenShareManager.getInstance().getStreamUrl());
                    ret.put("width", AndroidScreenShareManager.getInstance().getCaptureWidth());
                    ret.put("height", AndroidScreenShareManager.getInstance().getCaptureHeight());
                    call.resolve(ret);
                    return;
                } else {
                    call.reject("Failed to initialize system screen capture stream");
                    return;
                }
            }
            call.reject("Screen capture permission was cancelled by user");
        } catch (Exception e) {
            android.util.Log.e("CallForegroundPlugin", "handleScreenCaptureResult error: " + e.getMessage(), e);
            call.reject("Error setting up screen capture: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopNativeScreenShare(PluginCall call) {
        try {
            AndroidScreenShareManager.getInstance().stopCapture(getContext());
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Error stopping screen share: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void setScreenShareState(PluginCall call) {
        try {
            boolean isSharing = Boolean.TRUE.equals(call.getBoolean("isSharing", false));
            String callId = call.getString("callId", null);
            android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] setScreenShareState: isSharing=" + isSharing + ", callId=" + callId);
            CallForegroundService.setScreenShareState(getContext(), isSharing, callId);
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("isSharing", isSharing);
            call.resolve(ret);
        } catch (Exception e) {
            android.util.Log.e("CallForegroundPlugin", "setScreenShareState failed: " + e.getMessage(), e);
            call.reject("Failed to update screen share state: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void isScreenShareActive(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isSharing", CallForegroundService.isScreenSharingActive || AndroidScreenShareManager.getInstance().isSharing());
        call.resolve(ret);
    }

    @PluginMethod
    public void isPipSupported(PluginCall call) {
        boolean supported = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            supported = getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
        }
        JSObject ret = new JSObject();
        ret.put("supported", supported);
        call.resolve(ret);
    }

    @PluginMethod
    public void enterPip(PluginCall call) {
        Activity activity = getActivity();
        if (activity instanceof MainActivity) {
            final MainActivity mainActivity = (MainActivity) activity;
            activity.runOnUiThread(() -> {
                boolean success = mainActivity.enterPipMode();
                JSObject ret = new JSObject();
                ret.put("success", success);
                call.resolve(ret);
            });
        } else {
            call.reject("MainActivity not available for PiP");
        }
    }

    @PluginMethod
    public void getPendingAcceptedCall(PluginCall call) {
        try {
            if (pendingAcceptedCallCache != null) {
                JSObject ret = pendingAcceptedCallCache;
                pendingAcceptedCallCache = null;
                String cachedCallId = ret.getString("callId", "");
                if (cachedCallId != null && !cachedCallId.isEmpty() && IncomingCallManager.getInstance(getContext()).isCallTerminated(cachedCallId)) {
                    JSObject emptyRet = new JSObject();
                    emptyRet.put("hasPendingCall", false);
                    call.resolve(emptyRet);
                    return;
                }
                android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] Resolving getPendingAcceptedCall from memory cache");
                call.resolve(ret);
                return;
            }

            android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(getContext(), "swapskill_call_prefs");
            if (prefs == null) {
                JSObject ret = new JSObject();
                ret.put("hasPendingCall", false);
                call.resolve(ret);
                return;
            }
            String callId = prefs.getString("pending_accepted_call_id", null);
            boolean consumed = prefs.getBoolean("pending_accepted_consumed", true);
            long timestamp = prefs.getLong("pending_accepted_timestamp", 0);

            if (callId != null && !callId.isEmpty() && IncomingCallManager.getInstance(getContext()).isCallTerminated(callId)) {
                prefs.edit()
                        .putBoolean("pending_accepted_consumed", true)
                        .remove("pending_accepted_call_id")
                        .apply();
                JSObject ret = new JSObject();
                ret.put("hasPendingCall", false);
                call.resolve(ret);
                return;
            }

            // Valid if not consumed and within last 60 seconds
            if (callId != null && !callId.isEmpty() && !consumed && (System.currentTimeMillis() - timestamp < 60000)) {
                JSObject ret = new JSObject();
                ret.put("hasPendingCall", true);
                ret.put("callId", callId);
                ret.put("sessionId", prefs.getString("pending_accepted_session_id", ""));
                ret.put("callerId", prefs.getString("pending_accepted_caller_id", ""));
                ret.put("callerName", prefs.getString("pending_accepted_caller_name", ""));
                ret.put("callerPhoto", prefs.getString("pending_accepted_caller_photo", ""));
                ret.put("callType", prefs.getString("pending_accepted_call_type", "video"));
                ret.put("skillName", prefs.getString("pending_accepted_skill_name", ""));
                ret.put("conversationId", prefs.getString("pending_accepted_conversation_id", ""));
                ret.put("alreadyAccepted", true);

                // Mark consumed and remove call ID to prevent replay
                prefs.edit()
                        .putBoolean("pending_accepted_consumed", true)
                        .remove("pending_accepted_call_id")
                        .apply();
                call.resolve(ret);
                return;
            }

            JSObject ret = new JSObject();
            ret.put("hasPendingCall", false);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("hasPendingCall", false);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void clearPendingAcceptedCall(PluginCall call) {
        try {
            android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(getContext(), "swapskill_call_prefs");
            if (prefs != null) {
                prefs.edit()
                        .putBoolean("pending_accepted_consumed", true)
                        .remove("pending_accepted_call_id")
                        .apply();
            }
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("cleared", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void consumePendingChatPushes(PluginCall call) {
        com.getcapacitor.JSArray pushes = new com.getcapacitor.JSArray();
        synchronized (SwapSkillMessagingService.CHAT_PUSH_QUEUE_LOCK) {
            try {
                android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(getContext(), "swapskill_fcm_prefs");
                if (prefs != null) {
                    String raw = prefs.getString("pending_chat_pushes_json", null);
                    if (raw != null && !raw.isEmpty()) {
                        pushes = new com.getcapacitor.JSArray(raw);
                        prefs.edit().remove("pending_chat_pushes_json").apply();
                    }
                }
            } catch (Exception e) {
                android.util.Log.w("CallForegroundPlugin", "Failed to consume pending chat pushes: " + e.getMessage());
            }
        }
        JSObject ret = new JSObject();
        ret.put("pushes", pushes);
        call.resolve(ret);
    }

    @PluginMethod
    public void getPendingChatOpen(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            if (pendingChatIdCache != null && !pendingChatIdCache.isEmpty()) {
                String chatId = pendingChatIdCache;
                pendingChatIdCache = null;
                ret.put("hasPendingChat", true);
                ret.put("chatId", chatId);
                call.resolve(ret);
                return;
            }
            android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(getContext(), "swapskill_fcm_prefs");
            if (prefs != null) {
                String chatId = prefs.getString("pending_chat_open_id", null);
                long ts = prefs.getLong("pending_chat_open_ts", 0);
                prefs.edit().remove("pending_chat_open_id").remove("pending_chat_open_ts").apply();
                if (chatId != null && !chatId.isEmpty() && (System.currentTimeMillis() - ts < 60000)) {
                    ret.put("hasPendingChat", true);
                    ret.put("chatId", chatId);
                    call.resolve(ret);
                    return;
                }
            }
        } catch (Exception ignored) {}
        ret.put("hasPendingChat", false);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearChatNotifHistory(PluginCall call) {
        String chatId = call.getString("chatId", "");
        if (chatId != null && !chatId.trim().isEmpty()) {
            SwapSkillMessagingService.clearChatMessageHistory(getContext(), chatId.trim());
        }
        JSObject ret = new JSObject();
        ret.put("cleared", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void syncMutedChats(PluginCall call) {
        try {
            com.getcapacitor.JSArray arr = call.getArray("mutedChatIds");
            java.util.List<String> list = new java.util.ArrayList<>();
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    String id = arr.optString(i, "");
                    if (!id.isEmpty()) list.add(id);
                }
            }
            SwapSkillMessagingService.syncMutedChatsList(getContext(), list);
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("synced", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void showChatMessagingNotification(PluginCall call) {
        try {
            String chatId = call.getString("chatId", "");
            if (chatId == null || chatId.trim().isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("shown", false);
                call.resolve(ret);
                return;
            }
            String cleanChatId = chatId.trim();
            android.app.KeyguardManager km = (android.app.KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
            boolean isLocked = km != null && km.isKeyguardLocked();
            if (MainActivity.isAppInForeground && !isLocked) {
                JSObject ret = new JSObject();
                ret.put("shown", false);
                call.resolve(ret);
                return;
            }
            if (SwapSkillMessagingService.isChatMuted(getContext(), cleanChatId)) {
                JSObject ret = new JSObject();
                ret.put("shown", false);
                call.resolve(ret);
                return;
            }
            android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(getContext(), "swapskill_fcm_prefs");
            String backendUrl = prefs != null ? prefs.getString("backend_api_url", null) : null;
            String myUserId = prefs != null ? prefs.getString("current_user_id", null) : null;

            SwapSkillMessagingService.postChatMessagingNotification(
                    getContext(),
                    cleanChatId,
                    call.getString("senderId", ""),
                    call.getString("senderName", "New Message"),
                    call.getString("senderPhoto", ""),
                    myUserId,
                    call.getString("messageText", "Sent you a message"),
                    backendUrl,
                    false,
                    call.getString("messageId", "")
            );
            JSObject ret = new JSObject();
            ret.put("shown", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("shown", false);
            call.resolve(ret);
        }
    }

    private static final ExecutorService DOWNLOAD_EXECUTOR = Executors.newSingleThreadExecutor();
    private static final int MAX_BASE64_BYTES = 25 * 1024 * 1024;

    static boolean isSafeDownloadRemoteUrl(String rawUrl) {
        if (rawUrl == null) return false;
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty() || trimmed.length() > 4096) return false;
        try {
            URL parsed = new URL(trimmed);
            String protocol = parsed.getProtocol();
            if (!"https".equalsIgnoreCase(protocol)) return false;
            if (parsed.getUserInfo() != null && !parsed.getUserInfo().isEmpty()) return false;
            String host = parsed.getHost();
            if (host == null || host.trim().isEmpty()) return false;
            String lowerHost = host.toLowerCase(Locale.ROOT);
            if ("localhost".equals(lowerHost)
                    || lowerHost.endsWith(".local")
                    || lowerHost.endsWith(".internal")
                    || "127.0.0.1".equals(lowerHost)
                    || "0.0.0.0".equals(lowerHost)
                    || "::1".equals(lowerHost)
                    || lowerHost.startsWith("10.")
                    || lowerHost.startsWith("192.168.")
                    || lowerHost.startsWith("169.254.")) {
                return false;
            }
            if (lowerHost.matches("^172\\.(1[6-9]|2[0-9]|3[0-1])\\..*")) {
                return false;
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    static String sanitizeDownloadFileName(String rawName, String mimeType) {
        String cleaned = rawName == null ? "" : rawName.replaceAll("[\\r\\n\"\\\\/:*?<>|]+", "_")
                .replaceAll("\\s+", " ")
                .trim();
        while (cleaned.startsWith(".")) {
            cleaned = cleaned.substring(1).trim();
        }
        cleaned = cleaned.replace("..", "_");
        if (cleaned.isEmpty()) {
            cleaned = "attachment";
        }
        if (cleaned.length() > 120) {
            cleaned = cleaned.substring(0, 120);
        }
        if (!cleaned.matches(".*\\.[a-zA-Z0-9]{1,8}$") && mimeType != null && !mimeType.trim().isEmpty()) {
            String cleanMime = mimeType.toLowerCase(Locale.ROOT).split(";")[0].trim();
            String ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(cleanMime);
            if (ext == null || ext.isEmpty()) {
                if ("application/vnd.openxmlformats-officedocument.wordprocessingml.document".equals(cleanMime)) ext = "docx";
                else if ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".equals(cleanMime)) ext = "xlsx";
                else if ("application/vnd.openxmlformats-officedocument.presentationml.presentation".equals(cleanMime)) ext = "pptx";
                else if ("application/pdf".equals(cleanMime)) ext = "pdf";
                else if ("text/markdown".equals(cleanMime)) ext = "md";
            }
            if (ext != null && !ext.isEmpty()) {
                cleaned = cleaned + "." + ext;
            }
        }
        return cleaned;
    }

    static String sanitizeSafeMimeType(String rawMime) {
        if (rawMime == null || rawMime.trim().isEmpty()) {
            return "application/octet-stream";
        }
        String lower = rawMime.toLowerCase(Locale.ROOT).split(";")[0].trim();
        if (lower.contains("html") || lower.contains("javascript") || lower.contains("svg")) {
            return "application/octet-stream";
        }
        return lower;
    }

    static long downloadViaSystemManager(Context ctx, String remoteUrl, String mimeType, String rawFileName) {
        if (ctx == null || !isSafeDownloadRemoteUrl(remoteUrl)) {
            return -1L;
        }
        String safeMime = sanitizeSafeMimeType(mimeType);
        String safeName = sanitizeDownloadFileName(rawFileName, safeMime);
        DownloadManager dm = (DownloadManager) ctx.getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) {
            return -1L;
        }
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(remoteUrl.trim()));
        req.setTitle(safeName);
        req.setDescription("Downloading from SwapSkill");
        req.setMimeType(safeMime);
        req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        req.setAllowedOverMetered(true);
        req.setAllowedOverRoaming(true);
        try {
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeName);
        } catch (Exception e) {
            try {
                req.setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, safeName);
            } catch (Exception ignored) {}
        }
        return dm.enqueue(req);
    }

    @PluginMethod
    public void downloadFile(PluginCall call) {
        final Context ctx = getContext();
        if (ctx == null) {
            call.reject("Context not available");
            return;
        }
        final String url = call.getString("url", "");
        final String base64Data = call.getString("base64Data", "");
        final String mimeType = sanitizeSafeMimeType(call.getString("mimeType", "application/octet-stream"));
        final String safeFileName = sanitizeDownloadFileName(call.getString("fileName", "attachment"), mimeType);

        if (base64Data != null && !base64Data.trim().isEmpty()) {
            DOWNLOAD_EXECUTOR.execute(() -> {
                try {
                    String payload = base64Data.trim();
                    int commaIdx = payload.indexOf(',');
                    if (payload.startsWith("data:") && commaIdx != -1) {
                        payload = payload.substring(commaIdx + 1);
                    }
                    byte[] bytes = Base64.decode(payload, Base64.DEFAULT);
                    if (bytes.length > MAX_BASE64_BYTES) {
                        call.reject("File exceeds 25MB native save limit");
                        return;
                    }

                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        ContentResolver resolver = ctx.getContentResolver();
                        ContentValues values = new ContentValues();
                        values.put(MediaStore.Downloads.DISPLAY_NAME, safeFileName);
                        values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                        values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                        values.put(MediaStore.Downloads.IS_PENDING, 1);

                        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                        if (uri == null) {
                            call.reject("Failed to create download entry");
                            return;
                        }
                        try (OutputStream os = resolver.openOutputStream(uri)) {
                            if (os == null) {
                                resolver.delete(uri, null, null);
                                call.reject("Failed to open download output stream");
                                return;
                            }
                            os.write(bytes);
                            os.flush();
                        }
                        values.clear();
                        values.put(MediaStore.Downloads.IS_PENDING, 0);
                        resolver.update(uri, values, null, null);
                    } else {
                        File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        if (downloadsDir == null || (!downloadsDir.exists() && !downloadsDir.mkdirs()) || !downloadsDir.canWrite()) {
                            downloadsDir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                        }
                        if (downloadsDir == null) {
                            call.reject("Downloads directory unavailable");
                            return;
                        }
                        if (!downloadsDir.exists()) {
                            downloadsDir.mkdirs();
                        }
                        File outFile = new File(downloadsDir, safeFileName);
                        int counter = 1;
                        while (outFile.exists() && counter < 100) {
                            int dotIdx = safeFileName.lastIndexOf('.');
                            String candidate = dotIdx > 0
                                    ? safeFileName.substring(0, dotIdx) + " (" + counter + ")" + safeFileName.substring(dotIdx)
                                    : safeFileName + " (" + counter + ")";
                            outFile = new File(downloadsDir, candidate);
                            counter++;
                        }
                        try (FileOutputStream fos = new FileOutputStream(outFile)) {
                            fos.write(bytes);
                            fos.flush();
                        }
                        MediaScannerConnection.scanFile(ctx, new String[]{outFile.getAbsolutePath()}, new String[]{mimeType}, null);
                    }

                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    ret.put("fileName", safeFileName);
                    ret.put("method", "mediastore");
                    call.resolve(ret);
                } catch (Exception e) {
                    android.util.Log.e("CallForegroundPlugin", "Native base64 download failed: " + e.getMessage(), e);
                    call.reject("Failed to save file: " + e.getMessage(), e);
                }
            });
            return;
        }

        if (url != null && !url.trim().isEmpty()) {
            try {
                if (!isSafeDownloadRemoteUrl(url)) {
                    call.reject("Unsupported or unsafe download URL");
                    return;
                }
                long downloadId = downloadViaSystemManager(ctx, url, mimeType, safeFileName);
                if (downloadId < 0) {
                    call.reject("Android DownloadManager unavailable");
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("downloadId", downloadId);
                ret.put("fileName", safeFileName);
                ret.put("method", "download_manager");
                call.resolve(ret);
            } catch (Exception e) {
                android.util.Log.e("CallForegroundPlugin", "Native DownloadManager failed: " + e.getMessage(), e);
                call.reject("DownloadManager failed: " + e.getMessage(), e);
            }
            return;
        }

        call.reject("Missing url or base64Data for download");
    }

    @Override
    protected void handleOnDestroy() {
        if (screenStateReceiver != null) {
            try {
                getContext().unregisterReceiver(screenStateReceiver);
            } catch (Exception ignored) {}
            screenStateReceiver = null;
        }
        super.handleOnDestroy();
    }
}
