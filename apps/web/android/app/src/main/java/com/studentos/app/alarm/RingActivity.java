package com.studentos.app.alarm;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.lang.ref.WeakReference;
import java.text.DateFormat;
import java.util.Date;

/** Full-screen alarm (also over the lock screen): Stop, Snooze, or the item's quick action. */
public class RingActivity extends Activity {
    private static WeakReference<RingActivity> shown = new WeakReference<>(null);

    static Intent intent(Context c) {
        return new Intent(c, RingActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_USER_ACTION | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    static void closeAll() {
        RingActivity a = shown.get();
        if (a != null) a.finish();
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        shown = new WeakReference<>(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        render();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        render();
    }

    private void render() {
        JSONObject alarm = RingService.current();
        if (alarm == null) {
            finish();
            return;
        }
        JSONObject item = alarm.optJSONObject("item");
        String title = item == null ? "Reminder" : item.optString("title", "Reminder");
        String body = item == null ? "" : item.optString("body", "");
        JSONObject quick = alarm.optJSONObject("action");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#4f46e5"));
        int pad = dp(28);
        root.setPadding(pad, pad, pad, pad);

        root.addView(text(DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date()), 56, true, 1f));
        root.addView(space(16));
        root.addView(text(title, 26, true, 1f));
        if (!body.isEmpty()) {
            root.addView(space(8));
            root.addView(text(body, 17, false, 0.85f));
        }
        int more = RingService.count() - 1;
        if (more > 0) {
            root.addView(space(8));
            root.addView(text("+" + more + " more ringing", 14, false, 0.7f));
        }
        root.addView(space(48));
        if (quick != null) root.addView(button("✓  " + quick.optString("title", "Done"), true, v -> answer(RingService.ANSWER_QUICK)));
        root.addView(button("Snooze " + RingService.SNOOZE_MINUTES + " min", false, v -> answer(RingService.ANSWER_SNOOZE)));
        root.addView(button("Stop", false, v -> answer(RingService.ANSWER_STOP)));
        root.addView(button("Open app", false, v -> answer(RingService.ANSWER_OPEN)));
        setContentView(root);
    }

    private void answer(String answer) {
        ContextCompat.startForegroundService(this, RingService.answer(this, answer));
        if (RingService.ANSWER_OPEN.equals(answer)) {
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch != null) startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        }
        // If several rang together, the service re-opens this screen for the next one.
        finish();
    }

    @Override
    public void onBackPressed() {
        // Back must not silently dismiss a ringing alarm: treat it as Stop.
        answer(RingService.ANSWER_STOP);
    }

    private TextView text(String s, int sp, boolean bold, float alpha) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(Color.WHITE);
        t.setAlpha(alpha);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String label, boolean primary, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        b.setTextColor(primary ? Color.parseColor("#4f46e5") : Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(28));
        bg.setColor(primary ? Color.WHITE : Color.parseColor("#33FFFFFF"));
        b.setBackground(bg);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56));
        lp.topMargin = dp(12);
        b.setLayoutParams(lp);
        return b;
    }

    private View space(int heightDp) {
        View v = new View(this);
        v.setLayoutParams(new LinearLayout.LayoutParams(1, dp(heightDp)));
        return v;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
