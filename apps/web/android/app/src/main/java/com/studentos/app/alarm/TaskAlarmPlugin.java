package com.studentos.app.alarm;

import android.app.NotificationManager;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;

import java.lang.ref.WeakReference;

import androidx.core.content.ContextCompat;

/** JS bridge: schedule ringing alarms and collect the answers given on the alarm screen. */
@CapacitorPlugin(name = "TaskAlarm")
public class TaskAlarmPlugin extends Plugin {
    private static WeakReference<TaskAlarmPlugin> current = new WeakReference<>(null);

    @Override
    public void load() {
        current = new WeakReference<>(this);
        RingService.createChannel(getContext());
    }

    /** Called when an answer is queued, so a running app picks it up right away. */
    static void notifyPending() {
        TaskAlarmPlugin p = current.get();
        if (p != null) p.notifyListeners("pending", new JSObject());
    }

    /** { alarms: [{ nid, at, item, action?, vibrate }] } — adds or replaces, keeps the rest. */
    @PluginMethod
    public void schedule(PluginCall call) {
        JSArray alarms = call.getArray("alarms");
        if (alarms == null) {
            call.reject("alarms is required");
            return;
        }
        try {
            for (int i = 0; i < alarms.length(); i++) AlarmStore.schedule(getContext(), alarms.getJSONObject(i));
            call.resolve();
        } catch (JSONException e) {
            call.reject("Bad alarm", e);
        }
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        AlarmStore.cancelAll(getContext());
        call.resolve();
    }

    /** Rings now (the "Test alarm" button). */
    @PluginMethod
    public void ringNow(PluginCall call) {
        JSObject alarm = call.getObject("alarm");
        if (alarm == null) {
            call.reject("alarm is required");
            return;
        }
        Intent ring = new Intent(getContext(), RingService.class).setAction(RingService.ACTION_RING).putExtra(AlarmStore.EXTRA_ALARM, alarm.toString());
        ContextCompat.startForegroundService(getContext(), ring);
        call.resolve();
    }

    /** Answers given while the app was closed (or just now): [{ action, item, at? }]. */
    @PluginMethod
    public void takePending(PluginCall call) {
        JSONArray list = AlarmStore.takePending(getContext());
        JSObject res = new JSObject();
        try {
            res.put("actions", new JSArray(list.toString()));
        } catch (JSONException e) {
            res.put("actions", new JSArray());
        }
        call.resolve(res);
    }

    /** Whether the alarm can take over the screen (Android 14+ asks the user for this). */
    @PluginMethod
    public void status(PluginCall call) {
        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            fullScreen = nm == null || nm.canUseFullScreenIntent();
        }
        JSObject res = new JSObject();
        res.put("fullScreen", fullScreen);
        call.resolve(res);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        Intent i = Build.VERSION.SDK_INT >= 34
            ? new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + getContext().getPackageName()))
            : new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(i);
        } catch (Exception e) {
            getContext().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }
}
