package com.swapskill.app;

import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Full-screen incoming call activity displayed over lock screen and across all Android lifecycle states.
 */
public class IncomingCallActivity extends AppCompatActivity {

    private static final String TAG = "IncomingCallActivity";

    private String callId;
    private String sessionId;
    private String callerName;
    private String callerPhoto;
    private String callType;
    private String skillName;

    private final BroadcastReceiver callCancelledReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String cancelledCallId = intent.getStringExtra("callId");
            if (cancelledCallId == null || cancelledCallId.equals(callId)) {
                Log.i(TAG, "[INCOMING_CALL] Call was cancelled remotely; finishing activity.");
                finish();
            }
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configure window to turn screen on and show over lock screen
        configureWindowOverLockScreen();

        // Extract call extras
        Intent intent = getIntent();
        if (intent != null) {
            callId = intent.getStringExtra("callId");
            sessionId = intent.getStringExtra("sessionId");
            callerName = intent.getStringExtra("callerName");
            callerPhoto = intent.getStringExtra("callerPhoto");
            callType = intent.getStringExtra("callType");
            skillName = intent.getStringExtra("skillName");
        }

        if (callerName == null || callerName.trim().isEmpty()) {
            callerName = "Skill Swap Partner";
        }
        if (callType == null || callType.trim().isEmpty()) {
            callType = "video";
        }

        // Build clean programmatic layout
        setContentView(buildIncomingCallView());

        // Register cancel receiver
        IntentFilter filter = new IntentFilter(IncomingCallManager.ACTION_CALL_CANCELLED);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(callCancelledReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(callCancelledReceiver, filter);
        }
    }

    private void configureWindowOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) {
                km.requestDismissKeyguard(this, null);
            }
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            );
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private LinearLayout buildIncomingCallView() {
        int dp24 = dpToPx(24);
        int dp16 = dpToPx(16);
        int dp8 = dpToPx(8);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setBackgroundColor(Color.parseColor("#0F0F12"));
        root.setPadding(dp24, dpToPx(56), dp24, dpToPx(48));

        // 1. Top Badge: "SWAPSKILL LIVE SWAP"
        TextView badge = new TextView(this);
        badge.setText("audio".equalsIgnoreCase(callType) ? "INCOMING VOICE CALL" : "INCOMING LIVE VIDEO SWAP");
        badge.setTextColor(Color.parseColor("#10B981"));
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(dp16, dp8, dp16, dp8);

        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setShape(GradientDrawable.RECTANGLE);
        badgeBg.setCornerRadius(dpToPx(20));
        badgeBg.setColor(Color.parseColor("#16231E"));
        badgeBg.setStroke(dpToPx(1), Color.parseColor("#10B981"));
        badge.setBackground(badgeBg);

        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        root.addView(badge, badgeParams);

        // 2. Avatar Placeholder circle
        int avatarSize = dpToPx(96);
        TextView avatarView = new TextView(this);
        String initial = (!callerName.isEmpty()) ? String.valueOf(callerName.charAt(0)).toUpperCase() : "S";
        avatarView.setText(initial);
        avatarView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 36);
        avatarView.setTextColor(Color.parseColor("#FFFFFF"));
        avatarView.setTypeface(Typeface.DEFAULT_BOLD);
        avatarView.setGravity(Gravity.CENTER);

        GradientDrawable avatarBg = new GradientDrawable();
        avatarBg.setShape(GradientDrawable.OVAL);
        avatarBg.setColor(Color.parseColor("#C9A96E"));
        avatarView.setBackground(avatarBg);

        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(avatarSize, avatarSize);
        avatarParams.topMargin = dpToPx(44);
        avatarParams.bottomMargin = dpToPx(24);
        root.addView(avatarView, avatarParams);

        // 3. Caller Name
        TextView nameView = new TextView(this);
        nameView.setText(callerName);
        nameView.setTextColor(Color.parseColor("#FFFFFF"));
        nameView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26);
        nameView.setTypeface(Typeface.DEFAULT_BOLD);
        nameView.setGravity(Gravity.CENTER);
        root.addView(nameView);

        // 4. Subtitle / Skill Info
        TextView subtitleView = new TextView(this);
        if (skillName != null && !skillName.trim().isEmpty()) {
            subtitleView.setText("Topic: " + skillName);
        } else {
            subtitleView.setText("Skill Swap Session");
        }
        subtitleView.setTextColor(Color.parseColor("#9CA3AF"));
        subtitleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        subtitleView.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams subParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        subParams.topMargin = dpToPx(8);
        root.addView(subtitleView, subParams);

        // 5. Ringing pulse text
        TextView ringingText = new TextView(this);
        ringingText.setText("Ringing…");
        ringingText.setTextColor(Color.parseColor("#D1D5DB"));
        ringingText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        ringingText.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams ringParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        ringParams.topMargin = dpToPx(16);
        root.addView(ringingText, ringParams);

        // Spacer
        LinearLayout spacer = new LinearLayout(this);
        LinearLayout.LayoutParams spacerParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1.0f
        );
        root.addView(spacer, spacerParams);

        // 6. Action Buttons Row (Decline vs Answer)
        LinearLayout actionsRow = new LinearLayout(this);
        actionsRow.setOrientation(LinearLayout.HORIZONTAL);
        actionsRow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        rowParams.bottomMargin = dpToPx(16);
        root.addView(actionsRow, rowParams);

        // Decline Button (Crimson Red)
        Button declineBtn = new Button(this);
        declineBtn.setText("Decline");
        declineBtn.setTextColor(Color.WHITE);
        declineBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        declineBtn.setTypeface(Typeface.DEFAULT_BOLD);

        GradientDrawable declineBg = new GradientDrawable();
        declineBg.setShape(GradientDrawable.RECTANGLE);
        declineBg.setCornerRadius(dpToPx(30));
        declineBg.setColor(Color.parseColor("#E11D48"));
        declineBtn.setBackground(declineBg);

        LinearLayout.LayoutParams decParams = new LinearLayout.LayoutParams(
                0,
                dpToPx(56),
                1.0f
        );
        decParams.rightMargin = dp16;
        declineBtn.setLayoutParams(decParams);
        declineBtn.setOnClickListener(v -> onDeclineClicked());
        actionsRow.addView(declineBtn);

        // Answer Button (Emerald Green)
        Button answerBtn = new Button(this);
        answerBtn.setText("Answer");
        answerBtn.setTextColor(Color.WHITE);
        answerBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        answerBtn.setTypeface(Typeface.DEFAULT_BOLD);

        GradientDrawable answerBg = new GradientDrawable();
        answerBg.setShape(GradientDrawable.RECTANGLE);
        answerBg.setCornerRadius(dpToPx(30));
        answerBg.setColor(Color.parseColor("#10B981"));
        answerBtn.setBackground(answerBg);

        LinearLayout.LayoutParams ansParams = new LinearLayout.LayoutParams(
                0,
                dpToPx(56),
                1.0f
        );
        ansParams.leftMargin = dp16;
        answerBtn.setLayoutParams(ansParams);
        answerBtn.setOnClickListener(v -> onAnswerClicked());
        actionsRow.addView(answerBtn);

        return root;
    }

    private void onAnswerClicked() {
        Log.i(TAG, "[INCOMING_CALL] User answered call from full-screen activity: callId=" + callId);
        // 1. Stop native ringing and notification
        IncomingCallManager.getInstance(this).stopIncomingCall(this, callId);

        // 2. Launch MainActivity with deep link and autoAccept=true
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_VIEW);
        launchIntent.setData(Uri.parse("swapskill://call/" + callId + "?sessionId=" + (sessionId != null ? sessionId : "") + "&autoAccept=true"));
        launchIntent.putExtra("callId", callId);
        launchIntent.putExtra("sessionId", sessionId);
        launchIntent.putExtra("autoAccept", true);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(launchIntent);

        finish();
    }

    private void onDeclineClicked() {
        Log.i(TAG, "[INCOMING_CALL] User declined call from full-screen activity: callId=" + callId);
        // 1. Stop native ringing and notification
        IncomingCallManager.getInstance(this).stopIncomingCall(this, callId);

        // 2. Broadcast decline action to CallActionReceiver
        Intent declineBroadcast = new Intent(this, CallActionReceiver.class);
        declineBroadcast.setAction(CallActionReceiver.ACTION_DECLINE);
        declineBroadcast.putExtra("callId", callId);
        declineBroadcast.putExtra("sessionId", sessionId);
        sendBroadcast(declineBroadcast);

        finish();
    }

    private int dpToPx(int dp) {
        return (int) TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP,
                dp,
                getResources().getDisplayMetrics()
        );
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(callCancelledReceiver);
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
