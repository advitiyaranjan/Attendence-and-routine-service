package com.studentos.app.alarm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Rings (looping alarm sound + vibration) until the student answers: stop, snooze or the
 * item's quick action (complete / done). Several alarms at once queue up: answering one
 * shows the next. Silences itself after {@link #MAX_RING_MS} as a safety net, leaving the
 * notification in place.
 */
public class RingService extends Service {
    static final String ACTION_RING = "com.studentos.app.alarm.RING";
    static final String ACTION_ANSWER = "com.studentos.app.alarm.ANSWER";
    static final String EXTRA_ANSWER = "answer";
    static final String ANSWER_STOP = "stop";
    static final String ANSWER_SNOOZE = "snooze";
    static final String ANSWER_QUICK = "quick";
    static final String ANSWER_OPEN = "open";

    static final String CHANNEL = "sos-ring";
    private static final int NOTIFICATION_ID = 0x5051;
    private static final long MAX_RING_MS = 30 * 60_000L;
    static final int SNOOZE_MINUTES = 10;

    /** Alarms currently ringing, oldest first. The last one is shown. */
    private static final List<JSONObject> ringing = new ArrayList<>();

    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable timeout = this::silence;

    /** The alarm on screen, for {@link RingActivity}. */
    static synchronized JSONObject current() {
        return ringing.isEmpty() ? null : ringing.get(ringing.size() - 1);
    }

    static synchronized int count() {
        return ringing.size();
    }

    static Intent answer(Context c, String answer) {
        return new Intent(c, RingService.class).setAction(ACTION_ANSWER).putExtra(EXTRA_ANSWER, answer);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_RING.equals(action)) {
            try {
                JSONObject alarm = new JSONObject(intent.getStringExtra(AlarmStore.EXTRA_ALARM));
                AlarmStore.forget(this, alarm.optInt("nid"));
                synchronized (RingService.class) {
                    ringing.add(alarm);
                }
                show();
                startRinging(alarm.optBoolean("vibrate", true));
                launchScreen();
            } catch (JSONException | NullPointerException e) {
                stopIfIdle();
            }
        } else if (ACTION_ANSWER.equals(action)) {
            onAnswer(intent.getStringExtra(EXTRA_ANSWER));
        } else {
            stopIfIdle();
        }
        return START_NOT_STICKY;
    }

    private void onAnswer(String answer) {
        JSONObject alarm;
        synchronized (RingService.class) {
            if (ringing.isEmpty()) {
                stopIfIdle();
                return;
            }
            alarm = ringing.remove(ringing.size() - 1);
        }
        JSONObject item = alarm.optJSONObject("item");
        try {
            JSONObject queued = new JSONObject().put("item", item);
            if (ANSWER_SNOOZE.equals(answer)) {
                long at = System.currentTimeMillis() + SNOOZE_MINUTES * 60_000L;
                JSONObject snoozed = snoozedCopy(alarm, at);
                AlarmStore.schedule(this, snoozed);
                queued.put("action", "snoozed").put("item", snoozed.getJSONObject("item")).put("at", at);
            } else if (ANSWER_QUICK.equals(answer)) {
                JSONObject quick = alarm.optJSONObject("action");
                queued.put("action", quick == null ? "open" : quick.optString("id"));
                if (item != null) AlarmStore.cancelForEntity(this, item.optString("entityId"));
            } else if (ANSWER_OPEN.equals(answer)) {
                queued.put("action", "open");
            } else {
                queued.put("action", "stop");
            }
            AlarmStore.queueAction(this, queued);
        } catch (JSONException ignored) {
            // Nothing to tell the app.
        }
        if (count() == 0) {
            stopRinging();
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
        } else {
            show();
            launchScreen();
        }
    }

    /** Same id/key scheme as snoozes made in the web app, so both stay in step. */
    private static JSONObject snoozedCopy(JSONObject alarm, long at) throws JSONException {
        JSONObject copy = new JSONObject(alarm.toString());
        JSONObject item = copy.getJSONObject("item");
        String id = item.optString("id");
        String newId = id.substring(0, Math.min(24, id.length())) + "-" + Long.toString(at, 36);
        item.put("id", newId).put("key", item.optString("key") + ":snooze:" + at);
        copy.put("nid", AlarmStore.nativeId(newId)).put("at", at);
        return copy;
    }

    // -------------------------------------------------------------------------

    private void show() {
        JSONObject alarm = current();
        if (alarm == null) return;
        Notification n = buildNotification(alarm);
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
    }

    private Notification buildNotification(JSONObject alarm) {
        JSONObject item = alarm.optJSONObject("item");
        String title = item == null ? "Reminder" : item.optString("title", "Reminder");
        String body = item == null ? "" : item.optString("body", "");
        int more = count() - 1;
        if (more > 0) body = body + "\n+" + more + " more";

        PendingIntent full = PendingIntent.getActivity(this, 1, RingActivity.intent(this), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(full)
            .setFullScreenIntent(full, true)
            .addAction(0, "Stop", service(2, ANSWER_STOP))
            .addAction(0, "Snooze " + SNOOZE_MINUTES + " min", service(3, ANSWER_SNOOZE));
        JSONObject quick = alarm.optJSONObject("action");
        if (quick != null) b.addAction(0, quick.optString("title", "Done"), service(4, ANSWER_QUICK));
        return b.build();
    }

    private PendingIntent service(int code, String answer) {
        return PendingIntent.getService(this, code, answer(this, answer), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void launchScreen() {
        // Works when the app may draw over the lock screen; otherwise the full-screen intent / heads-up does it.
        try {
            startActivity(RingActivity.intent(this));
        } catch (Exception ignored) {
            // Background activity start not allowed: the notification takes over.
        }
    }

    private void startRinging(boolean vibrate) {
        if (player != null) return; // already ringing for an earlier alarm
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "studentos:ring");
            wakeLock.acquire(MAX_RING_MS + 60_000L);
        }
        try {
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            player.setDataSource(this, alarmSound());
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception e) {
            if (player != null) player.release();
            player = null;
        }
        if (vibrate) {
            vibrator = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? ((VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE)).getDefaultVibrator()
                : (Vibrator) getSystemService(VIBRATOR_SERVICE);
            long[] pattern = {0, 800, 600};
            if (vibrator != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                else vibrator.vibrate(pattern, 0);
            }
        }
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout, MAX_RING_MS);
    }

    private Uri alarmSound() {
        Uri u = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (u == null) u = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        return u;
    }

    /** Safety net: stop the noise, keep a normal notification so nothing is lost. */
    private void silence() {
        JSONObject alarm = current();
        stopRinging();
        if (alarm != null) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            JSONObject item = alarm.optJSONObject("item");
            NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("Missed: " + (item == null ? "Reminder" : item.optString("title", "Reminder")))
                .setContentText(item == null ? "" : item.optString("body", ""))
                .setAutoCancel(true);
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch != null) b.setContentIntent(PendingIntent.getActivity(this, 5, launch, PendingIntent.FLAG_IMMUTABLE));
            Notification n = b.build();
            synchronized (RingService.class) {
                ringing.clear();
            }
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            if (nm != null) nm.notify(NOTIFICATION_ID + 1, n);
        }
        stopSelf();
    }

    private void stopRinging() {
        handler.removeCallbacks(timeout);
        if (player != null) {
            try {
                player.stop();
            } catch (IllegalStateException ignored) {
                // Never started.
            }
            player.release();
            player = null;
        }
        if (vibrator != null) {
            vibrator.cancel();
            vibrator = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        RingActivity.closeAll();
    }

    private void stopIfIdle() {
        if (count() == 0) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        stopRinging();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static void createChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Alarms (ring until stopped)", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Tasks and reminders that ring until you stop them");
        ch.setSound(null, null); // the service plays the looping sound itself
        ch.enableVibration(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setBypassDnd(true);
        nm.createNotificationChannel(ch);
    }
}
