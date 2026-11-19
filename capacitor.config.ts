import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.swapskill.app',
  appName: 'SwapSkill',
  webDir: 'dist',
  backgroundColor: '#F7F4EE',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false
      }
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    LocalNotifications: {
      smallIcon: "ic_stat_swapskill",
      iconColor: "#C9A96E",
      sound: "beep.wav"
    },
    Keyboard: {
      resize: KeyboardResize.Body,
      resizeOnFullScreen: true
    }
  }
};

export default config;
