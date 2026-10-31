package com.swapskill.app;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.DisplayMetrics;
import android.view.WindowManager;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Native Android Screen Capture and Local Streaming Engine for SwapSkill.
 * Uses MediaProjection to capture the entire device screen at HD resolution,
 * compress frames to high-performance JPEG, and stream via local loopback (127.0.0.1)
 * to the WebView HTML5 canvas / WebRTC video track.
 */
public class AndroidScreenShareManager {

    private static final String TAG = "ScreenShareManager";
    private static volatile AndroidScreenShareManager instance;

    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread handlerThread;
    private Handler backgroundHandler;

    private ServerSocket serverSocket;
    private Thread serverThread;
    private volatile boolean isRunning = false;
    private int serverPort = 0;

    private final CopyOnWriteArrayList<Socket> connectedClients = new CopyOnWriteArrayList<>();
    private volatile byte[] latestFrameBytes = null;
    private final Object frameLock = new Object();
    private long lastFrameTime = 0;

    private int captureWidth = 720;
    private int captureHeight = 1280;
    private int screenDensity = 320;

    private AndroidScreenShareManager() {}

    public static AndroidScreenShareManager getInstance() {
        if (instance == null) {
            synchronized (AndroidScreenShareManager.class) {
                if (instance == null) {
                    instance = new AndroidScreenShareManager();
                }
            }
        }
        return instance;
    }

    public synchronized boolean isSharing() {
        return isRunning && mediaProjection != null;
    }

    public int getCaptureWidth() {
        return captureWidth;
    }

    public int getCaptureHeight() {
        return captureHeight;
    }

    public int getServerPort() {
        return serverPort;
    }

    /**
     * Start native screen capture with user-granted MediaProjection token.
     */
    public synchronized boolean startCapture(Context context, int resultCode, Intent data) {
        if (context == null || data == null) {
            android.util.Log.e(TAG, "Cannot start capture: Context or Intent data is null");
            return false;
        }

        stopCapture(context);

        try {
            MediaProjectionManager mgr = (MediaProjectionManager) context.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (mgr == null) {
                android.util.Log.e(TAG, "MediaProjectionManager is null");
                return false;
            }

            // Update CallForegroundService to include MEDIA_PROJECTION type before acquiring projection
            CallForegroundService.setScreenShareState(context, true);

            mediaProjection = mgr.getMediaProjection(resultCode, data);
            if (mediaProjection == null) {
                android.util.Log.e(TAG, "Failed to obtain MediaProjection from token");
                CallForegroundService.setScreenShareState(context, false);
                return false;
            }

            // Determine display metrics
            WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            DisplayMetrics metrics = new DisplayMetrics();
            if (wm != null && wm.getDefaultDisplay() != null) {
                wm.getDefaultDisplay().getRealMetrics(metrics);
            } else {
                metrics = context.getResources().getDisplayMetrics();
            }

            screenDensity = metrics.densityDpi > 0 ? metrics.densityDpi : DisplayMetrics.DENSITY_DEFAULT;
            int screenW = metrics.widthPixels;
            int screenH = metrics.heightPixels;

            // Target HD 720p for mobile screen sharing (Zoom/Google Meet industry standard: razor-sharp text, zero lag)
            if (screenW > 0 && screenH > 0) {
                float aspect = (float) screenH / (float) screenW;
                // Cap width at 720px for mobile screen sharing to prevent hardware encoder stall
                captureWidth = Math.min(screenW, 720);
                captureWidth = (captureWidth / 2) * 2;
                captureHeight = (int) (captureWidth * aspect);
                captureHeight = (captureHeight / 2) * 2;
            } else {
                captureWidth = 720;
                captureHeight = 1280;
            }

            // Start background thread for frame processing
            handlerThread = new HandlerThread("ScreenCaptureThread");
            handlerThread.start();
            backgroundHandler = new Handler(handlerThread.getLooper());

            // Start local loopback streaming HTTP server
            startHttpServer();

            // Set up ImageReader
            imageReader = ImageReader.newInstance(captureWidth, captureHeight, PixelFormat.RGBA_8888, 2);
            imageReader.setOnImageAvailableListener(reader -> {
                Image image = null;
                try {
                    image = reader.acquireLatestImage();
                    if (image != null && isRunning) {
                        long now = System.currentTimeMillis();
                        // 30 fps smooth streaming (33ms interval) with low latency
                        if (now - lastFrameTime >= 33) {
                            lastFrameTime = now;
                            processImageFrame(image);
                        }
                    }
                } catch (Exception e) {
                    android.util.Log.w(TAG, "Frame acquisition error: " + e.getMessage());
                } finally {
                    if (image != null) {
                        try { image.close(); } catch (Exception ignored) {}
                    }
                }
            }, backgroundHandler);

            // Register stop callback
            mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    super.onStop();
                    android.util.Log.i(TAG, "MediaProjection stopped by system");
                    stopCapture(context);
                }
            }, backgroundHandler);

            // Create VirtualDisplay targeting ImageReader surface
            virtualDisplay = mediaProjection.createVirtualDisplay(
                    "SwapSkillScreenStream",
                    captureWidth,
                    captureHeight,
                    screenDensity,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(),
                    null,
                    backgroundHandler
            );

            isRunning = true;
            android.util.Log.i(TAG, "Screen capture successfully initiated at " + captureWidth + "x" + captureHeight + " on port " + serverPort);
            return true;

        } catch (Exception e) {
            android.util.Log.e(TAG, "Exception starting screen capture: " + e.getMessage(), e);
            stopCapture(context);
            return false;
        }
    }

    private void processImageFrame(Image image) {
        try {
            Image.Plane[] planes = image.getPlanes();
            if (planes == null || planes.length == 0) return;

            ByteBuffer buffer = planes[0].getBuffer();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();
            int rowPadding = rowStride - pixelStride * captureWidth;

            Bitmap bitmap = Bitmap.createBitmap(
                    captureWidth + (rowPadding / pixelStride),
                    captureHeight,
                    Bitmap.Config.ARGB_8888
            );
            bitmap.copyPixelsFromBuffer(buffer);

            Bitmap finalBitmap;
            if (rowPadding != 0) {
                finalBitmap = Bitmap.createBitmap(bitmap, 0, 0, captureWidth, captureHeight);
                bitmap.recycle();
            } else {
                finalBitmap = bitmap;
            }

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            finalBitmap.compress(Bitmap.CompressFormat.JPEG, 80, baos);
            finalBitmap.recycle();

            byte[] jpeg = baos.toByteArray();
            synchronized (frameLock) {
                latestFrameBytes = jpeg;
                frameLock.notifyAll();
            }
        } catch (Exception e) {
            android.util.Log.w(TAG, "Error encoding frame: " + e.getMessage());
        }
    }

    /**
     * Tiny embedded HTTP multipart/x-mixed-replace server on 127.0.0.1
     */
    private void startHttpServer() {
        try {
            serverSocket = new ServerSocket();
            serverSocket.setReuseAddress(true);
            serverSocket.bind(new InetSocketAddress("127.0.0.1", 0));
            serverPort = serverSocket.getLocalPort();

            serverThread = new Thread(() -> {
                while (!serverSocket.isClosed()) {
                    try {
                        Socket socket = serverSocket.accept();
                        socket.setTcpNoDelay(true);
                        connectedClients.add(socket);
                        handleClientConnection(socket);
                    } catch (Exception ignored) {
                        break;
                    }
                }
            }, "ScreenShareHttpServer");
            serverThread.start();
        } catch (Exception e) {
            android.util.Log.e(TAG, "Failed to start HTTP server: " + e.getMessage(), e);
        }
    }

    private void handleClientConnection(Socket socket) {
        new Thread(() -> {
            OutputStream out = null;
            try {
                out = socket.getOutputStream();
                String header = "HTTP/1.1 200 OK\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Cache-Control: no-cache, no-store, must-revalidate\r\n" +
                        "Pragma: no-cache\r\n" +
                        "Expires: 0\r\n" +
                        "Connection: close\r\n" +
                        "Content-Type: multipart/x-mixed-replace; boundary=--frameboundary\r\n\r\n";
                out.write(header.getBytes("UTF-8"));
                out.flush();

                byte[] lastSent = null;
                while (isRunning && !socket.isClosed()) {
                    byte[] current;
                    synchronized (frameLock) {
                        while (isRunning && latestFrameBytes == lastSent) {
                            frameLock.wait(100);
                        }
                        current = latestFrameBytes;
                    }

                    if (current != null && current != lastSent) {
                        lastSent = current;
                        String partHeader = "--frameboundary\r\n" +
                                "Content-Type: image/jpeg\r\n" +
                                "Content-Length: " + current.length + "\r\n\r\n";
                        out.write(partHeader.getBytes("UTF-8"));
                        out.write(current);
                        out.write("\r\n".getBytes("UTF-8"));
                        out.flush();
                    }
                }
            } catch (Exception ignored) {
            } finally {
                connectedClients.remove(socket);
                try { socket.close(); } catch (Exception ignored) {}
            }
        }, "ScreenClientHandler").start();
    }

    public synchronized void stopCapture(Context context) {
        isRunning = false;

        synchronized (frameLock) {
            latestFrameBytes = null;
            frameLock.notifyAll();
        }

        for (Socket s : connectedClients) {
            try { s.close(); } catch (Exception ignored) {}
        }
        connectedClients.clear();

        if (serverSocket != null) {
            try { serverSocket.close(); } catch (Exception ignored) {}
            serverSocket = null;
        }

        if (virtualDisplay != null) {
            try { virtualDisplay.release(); } catch (Exception ignored) {}
            virtualDisplay = null;
        }

        if (imageReader != null) {
            try { imageReader.close(); } catch (Exception ignored) {}
            imageReader = null;
        }

        if (mediaProjection != null) {
            try { mediaProjection.stop(); } catch (Exception ignored) {}
            mediaProjection = null;
        }

        if (handlerThread != null) {
            try { handlerThread.quitSafely(); } catch (Exception ignored) {}
            handlerThread = null;
            backgroundHandler = null;
        }

        if (context != null) {
            CallForegroundService.setScreenShareState(context, false);
        }

        android.util.Log.i(TAG, "Screen capture engine stopped");
    }
}
