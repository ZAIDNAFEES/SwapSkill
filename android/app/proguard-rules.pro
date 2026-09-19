# SwapSkill Proguard / R8 Rules for Release Build

# Capacitor core and plugins
-keep public class com.getcapacitor.** { *; }
-keep public class * extends com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.Bridge { *; }
-keep class com.getcapacitor.BridgeActivity { *; }

# SwapSkill Custom Native Plugins & Services
-keep class com.swapskill.app.** { *; }
-keep public class com.swapskill.app.CallForegroundPlugin { *; }
-keep public class com.swapskill.app.CallForegroundService { *; }
-keep public class com.swapskill.app.MainActivity { *; }

# WebRTC & Media Engine
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# Firebase / Google Play Services
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-dontwarn com.google.android.gms.**
-dontwarn com.google.firebase.**
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }

# Keep Cordova plugin bridges if any
-dontwarn org.apache.cordova.**
-keep class org.apache.cordova.** { *; }
