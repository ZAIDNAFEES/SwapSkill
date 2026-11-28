package com.swapskill.app;

import android.Manifest;
import android.app.KeyguardManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.SurfaceTexture;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.util.Size;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import java.util.Collections;

/**
 * Full-screen incoming call activity displayed over lock screen and across all Android lifecycle states.
 * - Voice calls keep the clean dark audio-only UI.
 * - Video calls display an imo-style fullscreen live front-camera self-preview.
 * - Live Swap Meeting calls display clear champagne-gold Swap Session branding (+ self-camera preview when video).
 */
public class IncomingCallActivity extends AppCompatActivity {

    private static final String TAG = "IncomingCallActivity";

    private String callId;
    private String sessionId;
    private String callerId;
    private String callerName;
    private String callerPhoto;
    private String callType;
    private String skillName;
    private String conversationId;

    private boolean isVoiceCall;
    private boolean isSwapMeeting;

    // Front camera preview components (Video & Video Swap calls only)
    private TextureView cameraTextureView;
    private CameraDevice cameraDevice;
    private CameraCaptureSession cameraCaptureSession;
    private HandlerThread cameraThread;
    private Handler cameraHandler;
    private Size previewSize = new Size(1280, 720);
    private int sensorOrientation = 270;
    private final Object cameraLock = new Object();
    private volatile boolean isClosingOrDone = false;

    private final BroadcastReceiver callCancelledReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String cancelledCallId = intent.getStringExtra("callId");
            if (cancelledCallId == null || cancelledCallId.equals(callId)) {
                Log.i(TAG, "[INCOMING_CALL] Call was cancelled remotely; closing camera and finishing activity.");
                isClosingOrDone = true;
                closeCameraPreview();
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
            callerId = intent.getStringExtra("callerId");
            callerName = intent.getStringExtra("callerName");
            callerPhoto = intent.getStringExtra("callerPhoto");
            callType = intent.getStringExtra("callType");
            skillName = intent.getStringExtra("skillName");
            conversationId = intent.getStringExtra("conversationId");
        }

        if (callId != null && IncomingCallManager.getInstance(this).isCallTerminated(callId)) {
            Log.i(TAG, "[INCOMING_CALL] Call was already cancelled before activity launched; closing callId=" + callId);
            finish();
            return;
        }

        if (callerName == null || callerName.trim().isEmpty()) {
            callerName = "Skill Swap Partner";
        }
        if (callType == null || callType.trim().isEmpty()) {
            callType = "video";
        }

        isVoiceCall = "audio".equalsIgnoreCase(callType.trim());
        isSwapMeeting = sessionId != null
                && !sessionId.trim().isEmpty()
                && !sessionId.startsWith("chat_")
                && skillName != null
                && !skillName.trim().isEmpty()
                && !"Chat Call".equalsIgnoreCase(skillName.trim());

        Log.i(TAG, "[TIMING] INCOMING_UI_SHOWN: (native activity) callId=" + callId + " caller=" + callerName + " type=" + callType + " swap=" + isSwapMeeting + " t=" + System.currentTimeMillis());

        // Build clean layout (with fullscreen front-camera preview for video calls)
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

    private View buildIncomingCallView() {
        int dp24 = dpToPx(24);
        int dp16 = dpToPx(16);
        int dp12 = dpToPx(12);
        int dp8 = dpToPx(8);

        boolean hasCameraPermission = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        boolean enableCameraPreview = !isVoiceCall && hasCameraPermission;

        FrameLayout rootContainer = new FrameLayout(this);
        rootContainer.setBackgroundColor(Color.parseColor(isSwapMeeting ? "#0D0D0F" : "#0F0F12"));

        // Layer 0: Fullscreen imo-style Front Camera Preview for Video & Video Swap Calls
        if (enableCameraPreview) {
            cameraTextureView = new TextureView(this);
            FrameLayout.LayoutParams texParams = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
            );
            rootContainer.addView(cameraTextureView, texParams);

            // Top contrast scrim
            View topScrim = new View(this);
            GradientDrawable topGrad = new GradientDrawable(
                    GradientDrawable.Orientation.TOP_BOTTOM,
                    new int[]{Color.parseColor("#CC09090B"), Color.parseColor("#5509090B"), Color.TRANSPARENT}
            );
            topScrim.setBackground(topGrad);
            FrameLayout.LayoutParams topScrimParams = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dpToPx(290),
                    Gravity.TOP
            );
            rootContainer.addView(topScrim, topScrimParams);

            // Bottom contrast scrim
            View bottomScrim = new View(this);
            GradientDrawable bottomGrad = new GradientDrawable(
                    GradientDrawable.Orientation.BOTTOM_TOP,
                    new int[]{Color.parseColor("#E609090B"), Color.parseColor("#7709090B"), Color.TRANSPARENT}
            );
            bottomScrim.setBackground(bottomGrad);
            FrameLayout.LayoutParams bottomScrimParams = new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dpToPx(230),
                    Gravity.BOTTOM
            );
            rootContainer.addView(bottomScrim, bottomScrimParams);

            setupCameraTextureListener();
        }

        // Foreground Content Stack
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp24, dpToPx(52), dp24, dpToPx(44));
        rootContainer.addView(content, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));

        // 1. Top Badge
        TextView badge = new TextView(this);
        GradientDrawable badgeBg = new GradientDrawable();
        badgeBg.setShape(GradientDrawable.RECTANGLE);
        badgeBg.setCornerRadius(dpToPx(20));

        if (isSwapMeeting) {
            badge.setText("LIVE SWAP MEETING");
            badge.setTextColor(Color.parseColor("#E5C98B"));
            badgeBg.setColor(Color.parseColor("#CC1D1912"));
            badgeBg.setStroke(dpToPx(1), Color.parseColor("#C9A96E"));
        } else {
            badge.setText(isVoiceCall ? "INCOMING VOICE CALL" : "INCOMING VIDEO CALL");
            badge.setTextColor(Color.parseColor("#10B981"));
            badgeBg.setColor(Color.parseColor(enableCameraPreview ? "#B3101815" : "#16231E"));
            badgeBg.setStroke(dpToPx(1), Color.parseColor("#10B981"));
        }
        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        badge.setLetterSpacing(0.08f);
        badge.setGravity(Gravity.CENTER);
        badge.setPadding(dp16, dp8, dp16, dp8);
        badge.setBackground(badgeBg);

        LinearLayout.LayoutParams badgeParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        content.addView(badge, badgeParams);

        // 2. Caller Avatar Circle (Compact in upper region when video preview is active so self-video stays clear)
        int avatarSize = dpToPx(enableCameraPreview ? 76 : 96);
        TextView avatarView = new TextView(this);
        String initial = (!callerName.isEmpty()) ? String.valueOf(callerName.charAt(0)).toUpperCase() : "S";
        avatarView.setText(initial);
        avatarView.setTextSize(TypedValue.COMPLEX_UNIT_SP, enableCameraPreview ? 28 : 36);
        avatarView.setTextColor(Color.parseColor("#FFFFFF"));
        avatarView.setTypeface(Typeface.DEFAULT_BOLD);
        avatarView.setGravity(Gravity.CENTER);

        GradientDrawable avatarBg = new GradientDrawable();
        avatarBg.setShape(GradientDrawable.OVAL);
        avatarBg.setColor(Color.parseColor(isSwapMeeting ? "#1E1A13" : "#C9A96E"));
        if (isSwapMeeting) {
            avatarBg.setStroke(dpToPx(2), Color.parseColor("#C9A96E"));
        } else if (enableCameraPreview) {
            avatarBg.setStroke(dpToPx(2), Color.parseColor("#66FFFFFF"));
        }
        avatarView.setBackground(avatarBg);

        LinearLayout.LayoutParams avatarParams = new LinearLayout.LayoutParams(avatarSize, avatarSize);
        avatarParams.topMargin = dpToPx(enableCameraPreview ? 20 : 44);
        avatarParams.bottomMargin = dpToPx(enableCameraPreview ? 14 : 24);
        content.addView(avatarView, avatarParams);

        // 3. Caller Name
        TextView nameView = new TextView(this);
        nameView.setText(callerName);
        nameView.setTextColor(Color.parseColor("#FFFFFF"));
        nameView.setTextSize(TypedValue.COMPLEX_UNIT_SP, enableCameraPreview ? 24 : 26);
        nameView.setTypeface(Typeface.DEFAULT_BOLD);
        nameView.setGravity(Gravity.CENTER);
        nameView.setShadowLayer(6f, 0f, 2f, Color.parseColor("#88000000"));
        content.addView(nameView);

        // 4. Subtitle / Skill Session Identity
        TextView subtitleView = new TextView(this);
        if (isSwapMeeting) {
            subtitleView.setText("Swap Session • " + skillName.trim());
            subtitleView.setTextColor(Color.parseColor("#E5C98B"));
            subtitleView.setTypeface(Typeface.DEFAULT_BOLD);
        } else {
            subtitleView.setText(isVoiceCall ? "SwapSkill Voice Call" : "SwapSkill Video Call");
            subtitleView.setTextColor(Color.parseColor(enableCameraPreview ? "#E5E7EB" : "#9CA3AF"));
        }
        subtitleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        subtitleView.setGravity(Gravity.CENTER);
        subtitleView.setShadowLayer(4f, 0f, 1f, Color.parseColor("#88000000"));
        LinearLayout.LayoutParams subParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        subParams.topMargin = dpToPx(6);
        content.addView(subtitleView, subParams);

        // 5. Ringing status line
        TextView ringingText = new TextView(this);
        if (isSwapMeeting) {
            ringingText.setText(isVoiceCall ? "Audio Swap • Ringing…" : "Live Video Swap • Ringing…");
        } else {
            ringingText.setText("Ringing…");
        }
        ringingText.setTextColor(Color.parseColor("#D1D5DB"));
        ringingText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        ringingText.setGravity(Gravity.CENTER);
        ringingText.setShadowLayer(4f, 0f, 1f, Color.parseColor("#88000000"));
        LinearLayout.LayoutParams ringParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        ringParams.topMargin = dpToPx(enableCameraPreview ? 6 : 16);
        content.addView(ringingText, ringParams);

        // Flexible Spacer leaving middle open for self-camera preview
        LinearLayout spacer = new LinearLayout(this);
        content.addView(spacer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1.0f
        ));

        // Subtle privacy assurance note when live camera preview is visible
        if (enableCameraPreview) {
            TextView previewNote = new TextView(this);
            previewNote.setText(isSwapMeeting
                    ? "Only visible to you until you join"
                    : "Only visible to you until you answer");
            previewNote.setTextColor(Color.parseColor("#E5E7EB"));
            previewNote.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            previewNote.setGravity(Gravity.CENTER);
            previewNote.setPadding(dp12, dpToPx(6), dp12, dpToPx(6));

            GradientDrawable noteBg = new GradientDrawable();
            noteBg.setShape(GradientDrawable.RECTANGLE);
            noteBg.setCornerRadius(dpToPx(16));
            noteBg.setColor(Color.parseColor("#73000000"));
            previewNote.setBackground(noteBg);

            LinearLayout.LayoutParams noteParams = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
            );
            noteParams.bottomMargin = dpToPx(18);
            content.addView(previewNote, noteParams);
        }

        // 6. Action Buttons Row (Decline vs Answer / Join Swap)
        LinearLayout actionsRow = new LinearLayout(this);
        actionsRow.setOrientation(LinearLayout.HORIZONTAL);
        actionsRow.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
        );
        rowParams.bottomMargin = dpToPx(16);
        content.addView(actionsRow, rowParams);

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

        // Answer / Join Swap Button
        Button answerBtn = new Button(this);
        if (isSwapMeeting) {
            answerBtn.setText("Join Swap");
            answerBtn.setTextColor(Color.parseColor("#0D0D0F"));
        } else {
            answerBtn.setText("Answer");
            answerBtn.setTextColor(Color.WHITE);
        }
        answerBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        answerBtn.setTypeface(Typeface.DEFAULT_BOLD);

        GradientDrawable answerBg = new GradientDrawable();
        answerBg.setShape(GradientDrawable.RECTANGLE);
        answerBg.setCornerRadius(dpToPx(30));
        answerBg.setColor(Color.parseColor(isSwapMeeting ? "#C9A96E" : "#10B981"));
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

        return rootContainer;
    }

    private void setupCameraTextureListener() {
        if (cameraTextureView == null) return;
        cameraTextureView.setSurfaceTextureListener(new TextureView.SurfaceTextureListener() {
            @Override
            public void onSurfaceTextureAvailable(@NonNull SurfaceTexture surface, int width, int height) {
                openFrontCameraPreview(width, height);
            }

            @Override
            public void onSurfaceTextureSizeChanged(@NonNull SurfaceTexture surface, int width, int height) {
                configurePreviewTransform(width, height);
            }

            @Override
            public boolean onSurfaceTextureDestroyed(@NonNull SurfaceTexture surface) {
                closeCameraPreview();
                return true;
            }

            @Override
            public void onSurfaceTextureUpdated(@NonNull SurfaceTexture surface) {}
        });
    }

    private void openFrontCameraPreview(int viewWidth, int viewHeight) {
        if (isClosingOrDone || isVoiceCall) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        try {
            startCameraThread();
            CameraManager manager = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
            if (manager == null) return;

            String frontCameraId = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics chars = manager.getCameraCharacteristics(id);
                Integer facing = chars.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) {
                    frontCameraId = id;
                    Integer orientation = chars.get(CameraCharacteristics.SENSOR_ORIENTATION);
                    if (orientation != null) {
                        sensorOrientation = orientation;
                    }
                    StreamConfigurationMap map = chars.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
                    if (map != null) {
                        Size[] sizes = map.getOutputSizes(SurfaceTexture.class);
                        if (sizes != null && sizes.length > 0) {
                            previewSize = chooseOptimalSize(sizes);
                        }
                    }
                    break;
                }
            }

            if (frontCameraId == null) {
                Log.i(TAG, "[CAMERA_PREVIEW] No front camera found; keeping clean backdrop.");
                return;
            }

            configurePreviewTransform(viewWidth, viewHeight);

            manager.openCamera(frontCameraId, new CameraDevice.StateCallback() {
                @Override
                public void onOpened(@NonNull CameraDevice camera) {
                    synchronized (cameraLock) {
                        if (isClosingOrDone) {
                            try { camera.close(); } catch (Exception ignored) {}
                            return;
                        }
                        cameraDevice = camera;
                    }
                    createCameraPreviewSession();
                }

                @Override
                public void onDisconnected(@NonNull CameraDevice camera) {
                    synchronized (cameraLock) {
                        try { camera.close(); } catch (Exception ignored) {}
                        if (cameraDevice == camera) {
                            cameraDevice = null;
                        }
                    }
                }

                @Override
                public void onError(@NonNull CameraDevice camera, int error) {
                    Log.w(TAG, "[CAMERA_PREVIEW] Camera error code=" + error);
                    synchronized (cameraLock) {
                        try { camera.close(); } catch (Exception ignored) {}
                        if (cameraDevice == camera) {
                            cameraDevice = null;
                        }
                    }
                }
            }, cameraHandler);
        } catch (CameraAccessException | RuntimeException e) {
            Log.w(TAG, "[CAMERA_PREVIEW] Non-fatal error starting front camera preview: " + e.getMessage());
        }
    }

    private void createCameraPreviewSession() {
        try {
            if (isClosingOrDone || cameraTextureView == null || !cameraTextureView.isAvailable()) return;
            SurfaceTexture texture = cameraTextureView.getSurfaceTexture();
            if (texture == null) return;

            texture.setDefaultBufferSize(previewSize.getWidth(), previewSize.getHeight());
            Surface surface = new Surface(texture);

            final CameraDevice device;
            synchronized (cameraLock) {
                device = cameraDevice;
            }
            if (device == null) return;

            final CaptureRequest.Builder previewRequestBuilder = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
            previewRequestBuilder.addTarget(surface);
            previewRequestBuilder.set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE);

            device.createCaptureSession(Collections.singletonList(surface), new CameraCaptureSession.StateCallback() {
                @Override
                public void onConfigured(@NonNull CameraCaptureSession session) {
                    synchronized (cameraLock) {
                        if (isClosingOrDone || cameraDevice == null) {
                            try { session.close(); } catch (Exception ignored) {}
                            return;
                        }
                        cameraCaptureSession = session;
                    }
                    try {
                        session.setRepeatingRequest(previewRequestBuilder.build(), null, cameraHandler);
                    } catch (CameraAccessException | IllegalStateException e) {
                        Log.w(TAG, "[CAMERA_PREVIEW] Repeating request error: " + e.getMessage());
                    }
                }

                @Override
                public void onConfigureFailed(@NonNull CameraCaptureSession session) {
                    Log.w(TAG, "[CAMERA_PREVIEW] Failed to configure preview session.");
                }
            }, cameraHandler);
        } catch (CameraAccessException | RuntimeException e) {
            Log.w(TAG, "[CAMERA_PREVIEW] Error creating camera session: " + e.getMessage());
        }
    }

    private Size chooseOptimalSize(Size[] choices) {
        Size best = choices[0];
        int bestDiff = Integer.MAX_VALUE;
        for (Size option : choices) {
            if (option.getWidth() <= 1280 && option.getHeight() <= 960) {
                int diff = Math.abs(option.getWidth() - 1280) + Math.abs(option.getHeight() - 720);
                if (diff < bestDiff) {
                    best = option;
                    bestDiff = diff;
                }
            }
        }
        return best;
    }

    private void configurePreviewTransform(int viewWidth, int viewHeight) {
        if (cameraTextureView == null || viewWidth <= 0 || viewHeight <= 0) return;
        runOnUiThread(() -> {
            if (cameraTextureView == null) return;
            try {
                int rotation = getWindowManager().getDefaultDisplay().getRotation();
                boolean isPortrait = (rotation == Surface.ROTATION_0 || rotation == Surface.ROTATION_180);

                float camW = isPortrait ? previewSize.getHeight() : previewSize.getWidth();
                float camH = isPortrait ? previewSize.getWidth() : previewSize.getHeight();
                if (camW <= 0 || camH <= 0) return;

                float viewAspect = (float) viewWidth / viewHeight;
                float camAspect = camW / camH;

                float scaleX = 1.0f;
                float scaleY = 1.0f;
                if (camAspect > viewAspect) {
                    scaleX = camAspect / viewAspect;
                } else {
                    scaleY = viewAspect / camAspect;
                }

                Matrix matrix = new Matrix();
                float centerX = viewWidth / 2f;
                float centerY = viewHeight / 2f;

                if (rotation == Surface.ROTATION_90 || rotation == Surface.ROTATION_270) {
                    matrix.postRotate(90f * (rotation - 2), centerX, centerY);
                } else if (rotation == Surface.ROTATION_180) {
                    matrix.postRotate(180f, centerX, centerY);
                }
                matrix.postScale(scaleX, scaleY, centerX, centerY);
                cameraTextureView.setTransform(matrix);
            } catch (Exception ignored) {}
        });
    }

    private void startCameraThread() {
        if (cameraThread == null) {
            cameraThread = new HandlerThread("IncomingCallCamera");
            cameraThread.start();
            cameraHandler = new Handler(cameraThread.getLooper());
        }
    }

    private void closeCameraPreview() {
        synchronized (cameraLock) {
            if (cameraCaptureSession != null) {
                try {
                    cameraCaptureSession.stopRepeating();
                    cameraCaptureSession.close();
                } catch (Exception ignored) {}
                cameraCaptureSession = null;
            }
            if (cameraDevice != null) {
                try {
                    cameraDevice.close();
                } catch (Exception ignored) {}
                cameraDevice = null;
            }
        }
        if (cameraThread != null) {
            try {
                cameraThread.quitSafely();
            } catch (Exception ignored) {}
            cameraThread = null;
            cameraHandler = null;
        }
    }

    private void onAnswerClicked() {
        Log.i(TAG, "[INCOMING_CALL] User answered call from full-screen activity: callId=" + callId);
        isClosingOrDone = true;
        // Release camera hardware SYNCHRONOUSLY before MainActivity WebRTC opens getUserMedia
        closeCameraPreview();
        IncomingCallManager.getInstance(this).acceptCall(
                this,
                callId,
                sessionId,
                callerId,
                callerName,
                callerPhoto,
                callType,
                skillName,
                conversationId
        );
        finish();
    }

    private void onDeclineClicked() {
        Log.i(TAG, "[INCOMING_CALL] User declined call from full-screen activity: callId=" + callId);
        isClosingOrDone = true;
        closeCameraPreview();
        IncomingCallManager.getInstance(this).rejectCall(
                this,
                callId,
                sessionId,
                "Declined from incoming call screen"
        );
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
    protected void onPause() {
        closeCameraPreview();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        isClosingOrDone = true;
        closeCameraPreview();
        try {
            unregisterReceiver(callCancelledReceiver);
        } catch (Exception ignored) {}
        super.onDestroy();
    }
}
