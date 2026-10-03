package com.studentos.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.studentos.app.alarm.TaskAlarmPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TaskAlarmPlugin.class);
        registerPlugin(GoogleSignInPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
