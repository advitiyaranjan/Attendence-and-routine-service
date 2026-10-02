import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android app. The built web app (dist/) is bundled inside the APK, so the app
 * starts and works fully offline; the API server is only needed for sync and AI.
 */
const config: CapacitorConfig = {
  appId: 'com.studentos.app',
  appName: 'Student OS',
  webDir: 'dist',
  server: {
    // http://localhost lets the app reach a server on your local network over plain HTTP
    // (e.g. http://192.168.1.10:4000) without mixed-content blocking. Data never leaves
    // the device except to the server address you configure in the app.
    androidScheme: 'http',
    cleartext: true,
  },
  android: {
    webContentsDebuggingEnabled: process.env.SOS_DEBUG_WEBVIEW === 'true',
  },
  plugins: {
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover' },
    LocalNotifications: {
      smallIcon: 'ic_stat_student_os',
      iconColor: '#4f46e5',
    },
  },
};

export default config;
