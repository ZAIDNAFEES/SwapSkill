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
        createDefaultNotificationChannels();
        applyLockScreenFlagsForIntent(getIntent());
        setupWebViewSettings();
        handleCallIntent(getIntent());
    }

    private void createDefaultNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(android.content.Context.NOTIFICATION_SERVICE);
                if (nm == null) return;

                String[][] channels = {
                    {"swapskill_calls", "Live Swap Calls", "Incoming audio and video Live Swap calls"},
                    {"swapskill_session_alarms", "Session Reminders & Alarms", "10-minute and session start notifications"},
                    {"swapskill_messages", "Chat Messages", "New direct messages from partners"},
                    {"swapskill_general", "General Notifications", "Session requests, confirmations, and announcements"}
                };

                for (String[] ch : channels) {
                    if (nm.getNotificationChannel(ch[0]) == null) {
                        android.app.NotificationChannel channel = new android.app.NotificationChannel(
                                ch[0],
                                ch[1],
                                android.app.NotificationManager.IMPORTANCE_HIGH
                        );
                        channel.setDescription(ch[2]);
                        channel.enableVibration(true);
                        channel.enableLights(true);
                        channel.setShowBadge(true);
                        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
                        if ("swapskill_calls".equals(ch[0])) {
                            channel.setBypassDnd(true);
                        }
                        nm.createNotificationChannel(channel);
                    }
                }
            } catch (Exception e) {
                android.util.Log.w("MainActivity", "Channel init non-fatal: " + e.getMessage());
            }
        }
    }

    private boolean isCallIntent(Intent intent) {
        if (intent == null) return false;
        if (intent.hasExtra("callId") || intent.hasExtra("pending_call_id")) {
            return true;
        }
        android.net.Uri data = intent.getData();
        if (data != null) {
            String scheme = data.getScheme();
            String host = data.getHost();
            if ("swapskill".equals(scheme) && "call".equals(host)) {
                return true;
            }
        }
        return CallForegroundService.isCallActive;
    }

    private void applyLockScreenFlagsForIntent(Intent intent) {
        boolean shouldShowOverLock = isCallIntent(intent);
        applyLockScreenFlags(shouldShowOverLock);
    }

    public void applyLockScreenFlags(boolean enableForCall) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(enableForCall);
                setTurnScreenOn(enableForCall);
            } else {
                if (enableForCall) {
                    getWindow().addFlags(
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    );
                } else {
                    getWindow().clearFlags(
                        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    );
                }
            }
        } catch (Throwable t) {
            android.util.Log.w("MainActivity", "[CALL_LIFECYCLE] applyLockScreenFlags non-fatal: " + t.getMessage());
        }
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
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(true);
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
            webView.setBackgroundColor(android.graphics.Color.parseColor("#F7F4EE"));
            webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
                try {
                    if (CallForegroundPlugin.isSafeDownloadRemoteUrl(url)) {
                        String guessedName = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimetype);
                        CallForegroundPlugin.downloadViaSystemManager(this, url, mimetype, guessedName);
                    }
                } catch (Exception e) {
                    android.util.Log.w("MainActivity", "WebView download listener error: " + e.getMessage());
                }
            });
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
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
        applyLockScreenFlags(callActive);
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
        // If an incoming call notification or answer intent launched MainActivity, dismiss native ringing
        IncomingCallManager.getInstance(this).stopIncomingCall(this, null);
        setupWebViewSettings();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().resumeTimers();
        }
        handleCallIntent(getIntent());
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
        IncomingCallManager.getInstance(this).stopIncomingCall(this, null);
        applyLockScreenFlagsForIntent(intent);
        handleCallIntent(intent);
    }

    private String lastProcessedCallId = null;
    private long lastProcessedCallTime = 0;
    private String lastProcessedChatId = null;
    private long lastProcessedChatTime = 0;

    private void handleCallIntent(Intent intent) {
        if (intent == null) return;
        String callId = intent.getStringExtra("callId");
        if (callId == null || callId.isEmpty()) {
            callId = intent.getStringExtra("pending_call_id");
        }
        if (callId == null || callId.isEmpty()) {
            android.net.Uri data = intent.getData();
            if (data != null && "swapskill".equals(data.getScheme()) && "call".equals(data.getHost())) {
                String path = data.getPath();
                if (path != null) {
                    callId = path.replaceFirst("^/", "").split("\\?")[0];
                }
            }
        }
        if (callId != null && !callId.isEmpty()) {
            callId = callId.trim();
            if (!callId.matches("^[A-Za-z0-9_.-]{1,128}$") || callId.contains("..")) {
                android.util.Log.w("MainActivity", "[INCOMING_CALL] Dropping malformed callId deep link");
                return;
            }
            long now = System.currentTimeMillis();
            if (callId.equals(lastProcessedCallId) && (now - lastProcessedCallTime < 8000)) {
                android.util.Log.d("MainActivity", "[INCOMING_CALL] Skipping already processed call intent: callId=" + callId);
                return;
            }
            lastProcessedCallId = callId;
            lastProcessedCallTime = now;

            boolean hasTrustedInternalExtras = intent.hasExtra("callId") || intent.hasExtra("pending_call_id");
            boolean alreadyAccepted = intent.getBooleanExtra("alreadyAccepted", false) || intent.getBooleanExtra("autoAccept", false);
            android.net.Uri data = intent.getData();
            if (data != null && !alreadyAccepted && hasTrustedInternalExtras) {
                alreadyAccepted = "true".equals(data.getQueryParameter("alreadyAccepted")) || "true".equals(data.getQueryParameter("autoAccept"));
            }

            if (alreadyAccepted && hasTrustedInternalExtras) {
                if (IncomingCallManager.getInstance(this).isCallTerminated(callId)) {
                    android.util.Log.i("MainActivity", "[INCOMING_CALL] Dropping already-terminated call intent: callId=" + callId);
                    IncomingCallManager.getInstance(this).stopIncomingCall(this, callId);
                    try {
                        intent.removeExtra("callId");
                        intent.removeExtra("pending_call_id");
                        intent.removeExtra("alreadyAccepted");
                        intent.removeExtra("autoAccept");
                        intent.setData(null);
                        setIntent(intent);
                    } catch (Exception ignored) {}
                    return;
                }
                String sessionId = intent.getStringExtra("sessionId");
                String callerId = intent.getStringExtra("callerId");
                String callerName = intent.getStringExtra("callerName");
                String callerPhoto = intent.getStringExtra("callerPhoto");
                String callType = intent.getStringExtra("callType");
                String skillName = intent.getStringExtra("skillName");
                String conversationId = intent.getStringExtra("conversationId");

                if (data != null) {
                    if (sessionId == null) sessionId = data.getQueryParameter("sessionId");
                    if (callerId == null) callerId = data.getQueryParameter("callerId");
                    if (callerName == null) callerName = data.getQueryParameter("callerName");
                    if (callerPhoto == null) callerPhoto = data.getQueryParameter("callerPhoto");
                    if (callType == null) callType = data.getQueryParameter("callType");
                    if (skillName == null) skillName = data.getQueryParameter("skillName");
                    if (conversationId == null) conversationId = data.getQueryParameter("conversationId");
                }

                String safeCallerName = sanitizeBoundedText(callerName, 80, "Swap Partner");
                String safeSkillName = sanitizeBoundedText(skillName, 80, "Chat Call");
                String safeCallType = "audio".equalsIgnoreCase(callType) ? "audio" : "video";
                String safeSessionId = sanitizeIdParam(sessionId, callId);
                String safeCallerId = sanitizeIdParam(callerId, "");
                String safeConversationId = sanitizeIdParam(conversationId, "");
                String safeCallerPhoto = sanitizeHttpUrl(callerPhoto, 512);

                // Stop incoming ringing/notification and ensure foreground service is running
                IncomingCallManager.getInstance(this).stopIncomingCall(this, callId);
                CallForegroundService.startService(
                        this,
                        safeCallerName,
                        safeCallType,
                        safeSessionId,
                        callId
                );

                com.getcapacitor.JSObject jsObj = new com.getcapacitor.JSObject();
                jsObj.put("hasPendingCall", true);
                jsObj.put("callId", callId);
                jsObj.put("sessionId", safeSessionId);
                jsObj.put("callerId", safeCallerId);
                jsObj.put("callerName", safeCallerName);
                jsObj.put("callerPhoto", safeCallerPhoto);
                jsObj.put("callType", safeCallType);
                jsObj.put("skillName", safeSkillName);
                jsObj.put("conversationId", safeConversationId);
                jsObj.put("alreadyAccepted", true);

                android.util.Log.i("MainActivity", "[INCOMING_CALL] Forwarding accepted call to CallForegroundPlugin: callId=" + callId);
                CallForegroundPlugin.notifyCallAcceptedNatively(jsObj);
            }

            // Consume and clear intent extras so subsequent onResume calls never re-trigger
            try {
                intent.removeExtra("callId");
                intent.removeExtra("pending_call_id");
                intent.removeExtra("alreadyAccepted");
                intent.removeExtra("autoAccept");
                intent.setData(null);
                setIntent(intent);
            } catch (Exception ignored) {}
            return;
        }

        // Direct-to-chat intent handling (from MessagingStyle tap or launcher shortcut)
        String chatId = intent.getStringExtra("chatId");
        android.net.Uri chatUri = intent.getData();
        if ((chatId == null || chatId.isEmpty()) && chatUri != null) {
            if ("swapskill".equals(chatUri.getScheme()) && "chat".equals(chatUri.getHost())) {
                String path = chatUri.getPath();
                if (path != null) {
                    chatId = android.net.Uri.decode(path.replaceFirst("^/", "").split("\\?")[0]);
                }
            } else {
                String qp = chatUri.getQueryParameter("chatId");
                if (qp != null && !qp.isEmpty()) {
                    chatId = qp;
                }
            }
        }
        if (chatId != null && !chatId.trim().isEmpty()) {
            String resolvedChatId = chatId.trim();
            if (!resolvedChatId.matches("^[A-Za-z0-9_.-]{1,128}$") || resolvedChatId.contains("..")) {
                android.util.Log.w("MainActivity", "[CHAT_ACTION] Dropping malformed chatId deep link");
                return;
            }
            long now = System.currentTimeMillis();
            if (resolvedChatId.equals(lastProcessedChatId) && (now - lastProcessedChatTime < 1500)) {
                return;
            }
            lastProcessedChatId = resolvedChatId;
            lastProcessedChatTime = now;

            SwapSkillMessagingService.clearChatMessageHistory(this, resolvedChatId);
            try {
                android.content.SharedPreferences prefs = SafeStorageUtils.getDeviceProtectedSharedPreferences(this, "swapskill_fcm_prefs");
                if (prefs != null) {
                    prefs.edit()
                            .putString("pending_chat_open_id", resolvedChatId)
                            .putLong("pending_chat_open_ts", now)
                            .apply();
                }
            } catch (Exception ignored) {}

            CallForegroundPlugin.notifyChatOpenedNatively(resolvedChatId);

            try {
                intent.removeExtra("chatId");
                intent.setData(null);
                setIntent(intent);
            } catch (Exception ignored) {}
        }
    }

    private static String sanitizeBoundedText(String raw, int maxLen, String fallback) {
        if (raw == null) return fallback;
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) return fallback;
        return trimmed.length() > maxLen ? trimmed.substring(0, maxLen) : trimmed;
    }

    private static String sanitizeIdParam(String raw, String fallback) {
        if (raw == null) return fallback;
        String trimmed = raw.trim();
        if (!trimmed.matches("^[A-Za-z0-9_.-]{1,128}$") || trimmed.contains("..")) {
            return fallback;
        }
        return trimmed;
    }

    private static String sanitizeHttpUrl(String raw, int maxLen) {
        if (raw == null) return "";
        String trimmed = raw.trim();
        if (trimmed.isEmpty() || trimmed.length() > maxLen) return "";
        try {
            android.net.Uri parsed = android.net.Uri.parse(trimmed);
            String scheme = parsed.getScheme();
            if ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) {
                return trimmed;
            }
        } catch (Exception ignored) {}
        return "";
    }
}


