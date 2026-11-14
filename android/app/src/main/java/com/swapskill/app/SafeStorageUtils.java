package com.swapskill.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.UserManager;
import android.util.Log;

/**
 * Utility for safe storage access across Android Direct Boot (device-encrypted before first unlock)
 * and normal credential-encrypted storage (after user unlock).
 */
public final class SafeStorageUtils {

    private static final String TAG = "SafeStorageUtils";

    private SafeStorageUtils() {}

    /**
     * Checks if the device has been unlocked at least once since boot.
     */
    public static boolean isUserUnlocked(Context context) {
        if (context == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
            return um == null || um.isUserUnlocked();
        }
        return true;
    }

    /**
     * Returns a Context that is safe to use in Direct Boot mode.
     * Before user unlock on API 24+, returns a device-protected storage context.
     */
    public static Context getSafeContext(Context context) {
        if (context == null) return null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            UserManager um = (UserManager) context.getSystemService(Context.USER_SERVICE);
            if (um != null && !um.isUserUnlocked()) {
                return context.createDeviceProtectedStorageContext();
            }
        }
        return context;
    }

    /**
     * Returns a device-protected storage context that is ALWAYS accessible
     * both before and after user unlock.
     */
    public static Context getDeviceProtectedContext(Context context) {
        if (context == null) return null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            return context.createDeviceProtectedStorageContext();
        }
        return context;
    }

    /**
     * Safely accesses SharedPreferences without throwing IllegalStateException during Direct Boot.
     * Prioritizes device-protected storage during Direct Boot.
     */
    public static SharedPreferences getSafeSharedPreferences(Context context, String name) {
        if (context == null) return null;
        try {
            return getSafeContext(context).getSharedPreferences(name, Context.MODE_PRIVATE);
        } catch (Exception e) {
            Log.w(TAG, "Standard storage unavailable in Direct Boot, falling back to device-protected storage: " + e.getMessage());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                try {
                    return context.createDeviceProtectedStorageContext().getSharedPreferences(name, Context.MODE_PRIVATE);
                } catch (Exception ignored) {}
            }
            return null;
        }
    }

    /**
     * SharedPreferences that ALWAYS use device-protected storage (available before and after unlock).
     * Ideal for incoming call action handoff and FCM push configuration.
     */
    public static SharedPreferences getDeviceProtectedSharedPreferences(Context context, String name) {
        if (context == null) return null;
        try {
            return getDeviceProtectedContext(context).getSharedPreferences(name, Context.MODE_PRIVATE);
        } catch (Exception e) {
            return getSafeSharedPreferences(context, name);
        }
    }
}
