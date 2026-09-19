package com.swapskill.app;

import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.util.Rational;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {

    public static volatile boolean isAppInForeground = false;

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {
        // Contract implemented for @capgo/capacitor-social-login
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallForegroundPlugin.class);
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        setupWebViewSettings();
    }

    private void setupWebViewSettings() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(false);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            webView.setBackgroundColor(android.graphics.Color.parseColor("#F7F4EE"));
        }
    }

    /**
     * Standard Android behavior: When user presses Home or swipes up while an active
     * Live Swap call is running, automatically transition into Picture-in-Picture mode
     * instead of pausing/stopping the call.
     */
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (CallForegroundService.isCallActive) {
            android.util.Log.i("MainActivity", "[CALL_LIFECYCLE] onUserLeaveHint: Active call running, auto-entering Picture-in-Picture");
            enterPipMode();
        }
    }

    /**
     * Enter native Android Picture-in-Picture mode
     */
    public boolean enterPipMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                PictureInPictureParams.Builder pipBuilder = new PictureInPictureParams.Builder();
                // 9:16 aspect ratio matches portrait video call orientation
                Rational aspectRatio = new Rational(9, 16);
                pipBuilder.setAspectRatio(aspectRatio);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    pipBuilder.setAutoEnterEnabled(true);
                    pipBuilder.setSeamlessResizeEnabled(true);
                }
                boolean result = enterPictureInPictureMode(pipBuilder.build());
                android.util.Log.i("MainActivity", "[CALL_LIFECYCLE] enterPictureInPictureMode invoked: result=" + result);
                return result;
            } catch (Exception e) {
                android.util.Log.e("MainActivity", "[CALL_LIFECYCLE] enterPictureInPictureMode failed: " + e.getMessage(), e);
                return false;
            }
        }
        return false;
    }

    /**
     * Dynamically configure Android 12+ (API 31+) auto-enter PiP params when call state changes.
     * When autoEnterEnabled is true, pressing Home or gesture-swiping up enters PiP immediately.
     */
    public void updatePipState(boolean callActive) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                PictureInPictureParams.Builder pipBuilder = new PictureInPictureParams.Builder();
                Rational aspectRatio = new Rational(9, 16);
                pipBuilder.setAspectRatio(aspectRatio);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    pipBuilder.setAutoEnterEnabled(callActive);
                    pipBuilder.setSeamlessResizeEnabled(true);
                }
                setPictureInPictureParams(pipBuilder.build());
                android.util.Log.i("MainActivity", "[CALL_LIFECYCLE] updatePipState autoEnter=" + callActive);
            } catch (Exception e) {
                android.util.Log.w("MainActivity", "Failed to update PiP params: " + e.getMessage());
            }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        android.util.Log.i("MainActivity", "[CALL_LIFECYCLE] onPictureInPictureModeChanged: isInPictureInPictureMode=" + isInPictureInPictureMode);
        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.resumeTimers();
            if (isInPictureInPictureMode) {
                webView.onResume();
            }
        }
        if (CallForegroundPlugin.instance != null) {
            CallForegroundPlugin.instance.notifyPipModeChanged(isInPictureInPictureMode);
        }
    }

    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        try {
            if (getBridge() != null) {
                PluginHandle handle = getBridge().getPlugin("SocialLogin");
                if (handle != null) {
                    Plugin plugin = handle.getInstance();
                    if (plugin instanceof SocialLoginPlugin) {
                        ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
                    }
                }
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        isAppInForeground = true;
        setupWebViewSettings();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().resumeTimers();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        isAppInForeground = false;
        android.util.Log.d("MainActivity", "[CALL_LIFECYCLE] onPause (isCallActive=" + CallForegroundService.isCallActive + ")");
        // Keep WebView execution, WebRTC audio streaming, and JavaScript timers active during background calls
        if (CallForegroundService.isCallActive && getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.resumeTimers();
            // Critical: undo webView.onPause() so Chromium media capture and WebRTC peer connection pipeline do not freeze
            webView.onResume();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        isAppInForeground = false;
        android.util.Log.d("MainActivity", "[CALL_LIFECYCLE] onStop (isCallActive=" + CallForegroundService.isCallActive + ")");
        // Maintain active timers and Chromium WebRTC engine if screen is locked or app is in background during an ongoing call
        if (CallForegroundService.isCallActive && getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.resumeTimers();
            webView.onResume();
        }
    }

    @Override
    public void onDestroy() {
        isAppInForeground = false;
        super.onDestroy();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
    }
}


