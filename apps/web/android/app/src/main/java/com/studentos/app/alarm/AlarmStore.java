package com.studentos.app.alarm;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Ringing alarms for tasks, reminders, study sessions, etc. Scheduled alarms are kept in
 * SharedPreferences so they survive reboots, and answers given on the alarm screen
 * (complete, snooze...) are queued for the web app, which owns the data.
 *
 * An alarm is a JSON object: { nid, at (epoch ms), item (the web app's NotifyItem),
 * action?: { id, title } (the quick action to offer), vibrate }.
 */
public final class AlarmStore {
    private static final String PREFS = "sos.alarms";
    private static final String KEY_SCHEDULED = "scheduled";
    private static final String KEY_PENDING = "pending";
    static final String EXTRA_ALARM = "alarm";
    static final String ACTION_FIRE = "com.studentos.app.alarm.FIRE";

    private AlarmStore() {}

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized JSONObject scheduled(Context c) {
        try {
            return new JSONObject(prefs(c).getString(KEY_SCHEDULED, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private static void saveScheduled(Context c, JSONObject all) {
        prefs(c).edit().putString(KEY_SCHEDULED, all.toString()).apply();
    }

    /** Registers (or replaces) one alarm with Android and remembers it. */
    public static synchronized void schedule(Context c, JSONObject alarm) throws JSONException {
        int nid = alarm.getInt("nid");
        long at = alarm.getLong("at");
        JSONObject all = scheduled(c);
        all.put(String.valueOf(nid), alarm);
        saveScheduled(c, all);
        register(c, nid, at, alarm);
    }

    /** (Re)registers every remembered alarm, e.g. after a reboot. Past ones are dropped. */
    public static synchronized void restoreAll(Context c) {
        JSONObject all = scheduled(c);
        long now = System.currentTimeMillis();
        List<String> stale = new ArrayList<>();
        for (Iterator<String> it = all.keys(); it.hasNext(); ) {
            String k = it.next();
            JSONObject a = all.optJSONObject(k);
            if (a == null || a.optLong("at") < now - 60_000) {
                stale.add(k);
                continue;
            }
            register(c, a.optInt("nid"), a.optLong("at"), a);
        }
        for (String k : stale) all.remove(k);
        saveScheduled(c, all);
    }

    public static synchronized void cancelAll(Context c) {
        JSONObject all = scheduled(c);
        for (Iterator<String> it = all.keys(); it.hasNext(); ) {
            String k = it.next();
            JSONObject a = all.optJSONObject(k);
            if (a != null) unregister(c, a.optInt("nid"), a);
        }
        saveScheduled(c, new JSONObject());
    }

    /** Drops one alarm (it fired). */
    static synchronized void forget(Context c, int nid) {
        JSONObject all = scheduled(c);
        all.remove(String.valueOf(nid));
        saveScheduled(c, all);
    }

    /** After "Complete"/"Done": later alarms for the same item must not ring again. */
    static synchronized void cancelForEntity(Context c, String entityId) {
        if (entityId == null || entityId.isEmpty()) return;
        JSONObject all = scheduled(c);
        List<String> gone = new ArrayList<>();
        for (Iterator<String> it = all.keys(); it.hasNext(); ) {
            String k = it.next();
            JSONObject a = all.optJSONObject(k);
            JSONObject item = a == null ? null : a.optJSONObject("item");
            if (item != null && entityId.equals(item.optString("entityId"))) {
                unregister(c, a.optInt("nid"), a);
                gone.add(k);
            }
        }
        for (String k : gone) all.remove(k);
        saveScheduled(c, all);
    }

    private static PendingIntent fireIntent(Context c, int nid, JSONObject alarm) {
        Intent i = new Intent(c, AlarmReceiver.class).setAction(ACTION_FIRE);
        if (alarm != null) i.putExtra(EXTRA_ALARM, alarm.toString());
        return PendingIntent.getBroadcast(c, nid, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void register(Context c, int nid, long at, JSONObject alarm) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = fireIntent(c, nid, alarm);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
            // An alarm clock is exact, survives Doze and lets the service start from the background.
            PendingIntent show = PendingIntent.getActivity(c, nid, RingActivity.intent(c), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), pi);
        } else {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    private static void unregister(Context c, int nid, JSONObject alarm) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(fireIntent(c, nid, alarm));
    }

    // -------------------------------------------------------------------------
    // Answers for the web app

    static synchronized void queueAction(Context c, JSONObject action) {
        JSONArray list = pending(c);
        list.put(action);
        prefs(c).edit().putString(KEY_PENDING, list.toString()).apply();
        TaskAlarmPlugin.notifyPending();
    }

    private static JSONArray pending(Context c) {
        try {
            return new JSONArray(prefs(c).getString(KEY_PENDING, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    public static synchronized JSONArray takePending(Context c) {
        JSONArray list = pending(c);
        prefs(c).edit().putString(KEY_PENDING, "[]").apply();
        return list;
    }

    /** Same stable 31-bit id as the web app's nativeId() (FNV-1a over UTF-16 code units). */
    static int nativeId(String id) {
        int h = 0x811c9dc5;
        for (int i = 0; i < id.length(); i++) {
            h ^= id.charAt(i);
            h *= 0x01000193;
        }
        int r = h & 0x7fffffff;
        return r == 0 ? 1 : r;
    }
}
