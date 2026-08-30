import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Default [FirebaseOptions] for SwapSkill
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        return android;
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBu-YUExO-0QrK_01QOA5-ai8LAe3enIAM',
    appId: '1:101269763520:web:d70306cc8eb9f467f48425',
    messagingSenderId: '101269763520',
    projectId: 'swapskill-abbe1',
    authDomain: 'swapskill-abbe1.firebaseapp.com',
    storageBucket: 'swapskill-abbe1.firebasestorage.app',
    measurementId: 'G-0GVRXE9V4Y',
  );

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBu-YUExO-0QrK_01QOA5-ai8LAe3enIAM',
    appId: '1:101269763520:android:d70306cc8eb9f467f48425',
    messagingSenderId: '101269763520',
    projectId: 'swapskill-abbe1',
    storageBucket: 'swapskill-abbe1.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyBu-YUExO-0QrK_01QOA5-ai8LAe3enIAM',
    appId: '1:101269763520:ios:d70306cc8eb9f467f48425',
    messagingSenderId: '101269763520',
    projectId: 'swapskill-abbe1',
    storageBucket: 'swapskill-abbe1.firebasestorage.app',
    iosBundleId: 'com.swapskill.app',
  );
}
