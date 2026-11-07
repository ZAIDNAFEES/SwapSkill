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
 * Handles incoming call notification action intents (Accept & Decline).
 * Operates reliably even if the app process was killed or in background.
 */
public class CallActionReceiver extends BroadcastReceiver {

    public static final String ACTION_DECLINE = "com.swapskill.app.ACTION_DECLINE";
    public static final String ACTION_ACCEPT = "com.swapskill.app.ACTION_ACCEPT";
    private static final String TAG = "CallActionReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();

        if (ACTION_ACCEPT.equals(action)) {
            String callId = intent.getStringExtra("callId");
            String sessionId = intent.getStringExtra("sessionId");
            String callerId = intent.getStringExtra("callerId");
            String callerName = intent.getStringExtra("callerName");
            String callerPhoto = intent.getStringExtra("callerPhoto");
            String callType = intent.getStringExtra("callType");
            String skillName = intent.getStringExtra("skillName");
            String conversationId = intent.getStringExtra("conversationId");

            Log.i(TAG, "[CALL_ACTION] Call accepted by user via notification action: callId=" + callId + " partner=" + callerName);
            IncomingCallManager.getInstance(context).acceptCall(
                    context,
                    callId,
                    sessionId,
                    callerId,
                    callerName,
                    callerPhoto,
                    callType,
                    skillName,
                    conversationId
            );
        } else if (ACTION_DECLINE.equals(action)) {
            String callId = intent.getStringExtra("callId");
            String sessionId = intent.getStringExtra("sessionId");
            Log.i(TAG, "[CALL_ACTION] Call declined by user via notification action: callId=" + callId);

            IncomingCallManager.getInstance(context).rejectCall(
                    context,
                    callId,
                    sessionId,
                    "Declined from notification"
            );
        }
    }
}
