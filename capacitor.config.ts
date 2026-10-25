import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.signaldesk.app',
  appName: 'SignalDesk',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Cleartext HTTP from the https://localhost shell is only needed for local
    // debug builds against a plain-HTTP backend. Release must reject it, so it is
    // off by default and enabled explicitly via CAPACITOR_ALLOW_MIXED_CONTENT=true.
    allowMixedContent: process.env.CAPACITOR_ALLOW_MIXED_CONTENT === 'true',
  },
  plugins: {
    FirebaseMessaging: {
      // iOS-only knob; harmless on Android. Keeps foreground pushes visible.
      presentationOptions: ['alert', 'badge', 'sound'],
    },
  },
};

export default config;
