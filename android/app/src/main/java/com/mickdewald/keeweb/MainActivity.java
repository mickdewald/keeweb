package com.mickdewald.keeweb;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureClipboardPlugin.class);
        super.onCreate(savedInstanceState);
        // No screenshots and a blank recent-apps thumbnail.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
    }
}
