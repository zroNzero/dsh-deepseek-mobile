package app.dsh.deepseek;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * DSH DeepSeek — single WebView host.
 *
 * The whole UI lives in assets/mobile. This activity only:
 *  - enables JavaScript / DOM storage / file access,
 *  - injects the mobile CSS + DOM-probing JS on every page finish,
 *  - intercepts the hardware back key through window.handleAndroidBack().
 */
public class MainActivity extends Activity {

    private static final String TAG = "DSH-DeepSeek";
    private static final String APP_URL = "file:///android_asset/mobile/index.html";

    private WebView webView;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(Color.parseColor("#0A0A0A"));
            getWindow().setNavigationBarColor(Color.parseColor("#0A0A0A"));
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0A0A0A"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setLongClickable(false);
        webView.setHapticFeedbackEnabled(false);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);                 // 1. JavaScript
        s.setDomStorageEnabled(true);                 // 2. DOM Storage
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " DSHDeepSeek/1.0.0");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.addJavascriptInterface(new NativeBridge(), "DSHNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectCss(view);
                injectJs(view);
                Log.i(TAG, "onPageFinished -> assets injected: " + url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage cm) {
                Log.d(TAG, "[console] " + cm.message() + " @" + cm.sourceId() + ":" + cm.lineNumber());
                return true;
            }
        });

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0A0A0A"));
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        webView.loadUrl(APP_URL);
        Log.i(TAG, "loading " + APP_URL);
    }

    private boolean handleUrl(String url) {
        if (url == null) return false;
        if (url.startsWith("file://") || url.startsWith("about:") || url.startsWith("data:")) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            Log.w(TAG, "no activity for " + url, e);
        }
        return true;
    }

    private void injectCss(WebView view) {
        String css = readAsset("inject/inject.css");
        String js = "(function(){var id='ds-inject-style';var s=document.getElementById(id);" +
                "if(!s){s=document.createElement('style');s.id=id;document.head.appendChild(s);}" +
                "s.textContent=" + JSONObject.quote(css) + ";" +
                "document.documentElement.setAttribute('data-dsh-native','1');})();";
        view.evaluateJavascript(js, null);
    }

    private void injectJs(WebView view) {
        String js = readAsset("inject/inject.js");
        if (js.isEmpty()) {
            Log.e(TAG, "inject/inject.js is empty");
            return;
        }
        view.evaluateJavascript(js, value -> Log.i(TAG, "inject.js result=" + value));
    }

    private String readAsset(String path) {
        try (InputStream is = getAssets().open(path);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            Log.e(TAG, "cannot read asset " + path, e);
            return "";
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        // Ask the web layer first: true means "handled, do not exit".
        webView.evaluateJavascript(
                "(function(){try{return window.handleAndroidBack?window.handleAndroidBack():false;}catch(e){return false;}})()",
                value -> {
                    if ("true".equals(value)) {
                        Log.i(TAG, "back consumed by web layer");
                        return;
                    }
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        MainActivity.super.onBackPressed();
                    }
                });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("DSHNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** Small bridge so the bundled plugins can detect the Android host. */
    private class NativeBridge {
        @JavascriptInterface
        public String platform() { return "android"; }

        @JavascriptInterface
        public String version() { return "1.0.0"; }

        @JavascriptInterface
        public String pluginPath() { return "plugins/dsh-one-sync"; }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(MainActivity.this::finish);
        }
    }
}
