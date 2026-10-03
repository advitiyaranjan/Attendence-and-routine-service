package com.studentos.app.alarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

/** An alarm went off, the phone rebooted, or a button on the ringing notification was pressed. */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        switch (action) {
            case AlarmStore.ACTION_FIRE: {
                String alarm = intent.getStringExtra(AlarmStore.EXTRA_ALARM);
                if (alarm == null) return;
                Intent ring = new Intent(context, RingService.class).setAction(RingService.ACTION_RING).putExtra(AlarmStore.EXTRA_ALARM, alarm);
                ContextCompat.startForegroundService(context, ring);
                break;
            }
            case Intent.ACTION_BOOT_COMPLETED:
            case Intent.ACTION_MY_PACKAGE_REPLACED:
            case "android.intent.action.QUICKBOOT_POWERON":
                AlarmStore.restoreAll(context);
                break;
            default:
                break;
        }
    }
}
