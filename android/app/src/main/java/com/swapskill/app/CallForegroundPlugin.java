package com.swapskill.app;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor Plugin interface for Android CallForegroundService,
 * Picture-in-Picture (PiP), and screen lock telemetry.
 */
@CapacitorPlugin(name = "CallForegroundPlugin")
public class CallForegroundPlugin extends Plugin {

    public static CallForegroundPlugin instance;
    private BroadcastReceiver screenStateReceiver;

    @Override
    public void load() {
        super.load();
        instance = this;
        registerScreenStateReceiver();
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

            getContext().registerReceiver(screenStateReceiver, filter);
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
        if (instance != null) {
            android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] Emitting callAcceptedNatively event to JS bridge");
            instance.notifyListeners("callAcceptedNatively", callData);
        }
    }

    @PluginMethod
    public void getFcmToken(PluginCall call) {
        try {
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    if (!task.isSuccessful()) {
                        android.util.Log.w("CallForegroundPlugin", "[TOKEN_SYNC] FirebaseMessaging.getToken failed", task.getException());
                        String cachedToken = getContext().getSharedPreferences("swapskill_fcm_prefs", Context.MODE_PRIVATE)
                                .getString("latest_fcm_token", null);
                        JSObject ret = new JSObject();
                        ret.put("token", cachedToken != null ? cachedToken : "");
                        call.resolve(ret);
                        return;
                    }

                    String token = task.getResult();
                    android.util.Log.i("CallForegroundPlugin", "[TOKEN_SYNC] FirebaseMessaging.getToken success: " +
                            (token != null && token.length() > 10 ? token.substring(0, 10) + "..." : token));

                    if (token != null && !token.isEmpty()) {
                        getContext().getSharedPreferences("swapskill_fcm_prefs", Context.MODE_PRIVATE)
                                .edit()
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
            String cachedToken = getContext().getSharedPreferences("swapskill_fcm_prefs", Context.MODE_PRIVATE)
                    .getString("latest_fcm_token", null);
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
        try {
            android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(getContext(), "swapskill_fcm_prefs");
            if (prefs != null) {
                android.content.SharedPreferences.Editor editor = prefs.edit();
                if (userId != null && !userId.isEmpty()) {
                    editor.putString("current_user_id", userId);
                }
                if (backendUrl != null && !backendUrl.isEmpty()) {
                    editor.putString("backend_api_url", backendUrl);
                }
                if (idToken != null && !idToken.isEmpty()) {
                    editor.putString("current_id_token", idToken);
                }
                editor.apply();
                android.util.Log.i("CallForegroundPlugin", "[TOKEN_SYNC] Cached push userId=" + userId + ", backendUrl=" + backendUrl + ", hasIdToken=" + (idToken != null && !idToken.isEmpty()));
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
            android.util.Log.i("CallForegroundPlugin", "[CALL_LIFECYCLE] FOREGROUND_SERVICE_STOP requested from Web layer");
            Intent intent = new Intent(getContext(), CallForegroundService.class);
            intent.setAction(CallForegroundService.ACTION_STOP_CALL);
            getContext().startService(intent);

            // Disable auto-enter Picture-in-Picture when call ends
            Activity activity = getActivity();
            if (activity instanceof MainActivity) {
                final MainActivity mainActivity = (MainActivity) activity;
                activity.runOnUiThread(() -> mainActivity.updatePipState(false));
            }

            JSObject ret = new JSObject();
            ret.put("stopped", true);
            call.resolve(ret);
        } catch (Exception e) {
            android.util.Log.e("CallForegroundPlugin", "[CALL_LIFECYCLE] Failed to stop call foreground service: " + e.getMessage(), e);
            call.reject("Failed to stop call foreground service: " + e.getMessage(), e);
        }
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

                // Mark consumed
                prefs.edit().putBoolean("pending_accepted_consumed", true).apply();
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
                prefs.edit().putBoolean("pending_accepted_consumed", true).apply();
            }
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("cleared", true);
        call.resolve(ret);
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
