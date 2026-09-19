package com.swapskill.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Handles incoming call notification action intents (e.g. Decline).
 * Operates reliably even if the app process was killed or in background.
 */
public class CallActionReceiver extends BroadcastReceiver {

    public static final String ACTION_DECLINE = "com.swapskill.app.ACTION_DECLINE";
    private static final String TAG = "CallActionReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();

        if (ACTION_DECLINE.equals(action)) {
            String callId = intent.getStringExtra("callId");
            String sessionId = intent.getStringExtra("sessionId");
            Log.i(TAG, "[CALL_ACTION] Call declined by user via notification action: callId=" + callId);

            // 1. Immediately stop ringing, vibration, and dismiss notification
            IncomingCallManager.getInstance(context).stopIncomingCall(context, callId);

            // 2. Report rejection to backend in background thread
            if (callId != null && !callId.trim().isEmpty()) {
                final String finalCallId = callId.trim();
                new Thread(() -> {
                    String[] endpoints = new String[]{
                        "https://swap-skill-cnge.vercel.app/api/calls/reject",
                        "http://127.0.0.1:3000/api/calls/reject"
                    };
                    for (String endpointUrl : endpoints) {
                        try {
                            URL url = new URL(endpointUrl);
                            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                            conn.setRequestMethod("POST");
                            conn.setRequestProperty("Content-Type", "application/json");
                            conn.setConnectTimeout(4000);
                            conn.setReadTimeout(4000);
                            conn.setDoOutput(true);

                            String jsonPayload = "{\"callId\":\"" + finalCallId + "\",\"reason\":\"Declined from notification\"}";
                            try (OutputStream os = conn.getOutputStream()) {
                                os.write(jsonPayload.getBytes(StandardCharsets.UTF_8));
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
        }
    }
}
