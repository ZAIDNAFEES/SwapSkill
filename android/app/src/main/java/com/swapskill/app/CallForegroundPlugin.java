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
