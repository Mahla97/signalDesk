import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.signaldesk.app',
  appName: 'SignalDesk',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // The shell is served from https://localhost, so a plain-HTTP dev backend
    // (http://10.0.2.2:<port>, see VITE_API_BASE_URL) is otherwise blocked as
    // mixed content. Production talks to an HTTPS API, where this has no effect.
    allowMixedContent: true,
  },
  plugins: {
    FirebaseMessaging: {
      // iOS-only knob; harmless on Android. Keeps foreground pushes visible.
      presentationOptions: ['alert', 'badge', 'sound'],
    },
  },
};

export default config;
