package com.tv1.player;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.hls.HlsMediaSource;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.MultiFormatWriter;
import com.google.zxing.common.BitMatrix;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class MainActivity extends Activity {
    private static final String PREFS_NAME = "tv1_player";
    private static final String PREF_CUSTOM_NODES = "custom_nodes";
    private static final int ADD_NODE_PORT = 8765;
    private static final String TAG = "TV1-Media3";
    private static final long PLAYBACK_RECOVERY_DELAY_MS = 1000L;
    private static final long PLAYBACK_STABLE_RESET_DELAY_MS = 10000L;
    private static final int MAX_PLAYBACK_RECOVERY_ATTEMPTS = 3;

    private final List<Channel> channels = new ArrayList<>();
    private final List<Button> channelButtons = new ArrayList<>();
    private final List<Button> nodeButtons = new ArrayList<>();
    private final List<LinearLayout> nodePanels = new ArrayList<>();
    private final List<Button> categoryButtons = new ArrayList<>();
    private final List<Integer> visibleChannelIndexes = new ArrayList<>();
    private final List<String> categories = new ArrayList<>();
    private final Map<String, Integer> pendingAddRequests = new ConcurrentHashMap<>();
    private final Handler uiHandler = new Handler(Looper.getMainLooper());

    private ExoPlayer player;
    private PlaybackDiagnostics playbackDiagnostics;
    private PlayerView playerView;
    private FrameLayout rootLayout;
    private LinearLayout sidePanel;
    private LinearLayout categoryTabs;
    private LinearLayout channelList;
    private ScrollView channelScroll;
    private TextView statusView;

    private int activeChannelIndex = 0;
    private int activeNodeIndex = 0;
    private int expandedChannelIndex = -1;
    private String activeCategory = "";
    private boolean userStopped = false;
    private boolean controlsVisible = true;
    private boolean pendingExitConfirm = false;
    private boolean activityPaused = false;
    private int playbackRecoveryAttempts = 0;
    private boolean playbackRecoveryPending = false;
    private boolean playbackStableResetPending = false;
    private AddNodeServer addNodeServer;
    private AlertDialog addNodeDialog;
    private AlertDialog exitConfirmDialog;
    private final Runnable hideControlsRunnable = this::hideControls;
    private final Runnable resetPendingExitRunnable = () -> pendingExitConfirm = false;
    private final Runnable playbackRecoveryRunnable = this::recoverPlayback;
    private final Runnable playbackStableResetRunnable = this::markPlaybackStable;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemUi();
        buildLayout();
        loadChannels();
        initPlayer();

        if (!channels.isEmpty()) {
            selectChannel(0, false);
            playActiveNode(false);
        } else {
            setStatus("没有读取到频道配置。");
        }
    }

    private void buildLayout() {
        rootLayout = new FrameLayout(this);
        rootLayout.setBackgroundColor(Color.BLACK);
        rootLayout.setPadding(dp(14), dp(14), dp(14), dp(14));

        LinearLayout contentLayout = new LinearLayout(this);
        contentLayout.setOrientation(LinearLayout.HORIZONTAL);

        LinearLayout playerPanel = new LinearLayout(this);
        playerPanel.setOrientation(LinearLayout.VERTICAL);
        playerPanel.setBackgroundColor(Color.BLACK);

        playerView = new PlayerView(this);
        playerView.setUseController(false);
        playerView.setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING);
        playerView.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        playerPanel.addView(playerView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1
        ));

        statusView = new TextView(this);
        statusView.setTextColor(Color.rgb(230, 235, 244));
        statusView.setTextSize(16);
        statusView.setGravity(Gravity.CENTER_VERTICAL);
        statusView.setPadding(dp(14), 0, dp(14), 0);
        statusView.setBackgroundColor(Color.rgb(27, 31, 40));
        playerPanel.addView(statusView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(52)
        ));

        sidePanel = new LinearLayout(this);
        sidePanel.setOrientation(LinearLayout.VERTICAL);
        sidePanel.setPadding(dp(14), 0, 0, 0);

        TextView title = makeLabel("TV1 原生播放器", 22, true);
        sidePanel.addView(title, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(44)
        ));

        TextView channelTitle = makeLabel("频道", 16, false);
        sidePanel.addView(channelTitle, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(34)
        ));

        categoryTabs = new LinearLayout(this);
        categoryTabs.setOrientation(LinearLayout.HORIZONTAL);
        sidePanel.addView(categoryTabs, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(42)
        ));

        channelScroll = new ScrollView(this);
        channelScroll.setFillViewport(false);
        channelScroll.setClipChildren(false);
        channelScroll.setOnScrollChangeListener((view, scrollX, scrollY, oldScrollX, oldScrollY) -> updateExpandedNodePanelPosition());
        channelList = new LinearLayout(this);
        channelList.setOrientation(LinearLayout.VERTICAL);
        channelScroll.addView(channelList);
        sidePanel.addView(channelScroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1
        ));

        contentLayout.addView(playerPanel, new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.MATCH_PARENT,
                1
        ));
        contentLayout.addView(sidePanel, new LinearLayout.LayoutParams(
                dp(360),
                LinearLayout.LayoutParams.MATCH_PARENT
        ));
        rootLayout.addView(contentLayout, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
        ));

        setContentView(rootLayout);
    }

    private TextView makeLabel(String text, int sizeSp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextColor(Color.WHITE);
        view.setTextSize(sizeSp);
        view.setGravity(Gravity.CENTER_VERTICAL);
        if (bold) {
            view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        }
        return view;
    }

    private void initPlayer() {
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(15000, 50000, 1000, 1000)
                .build();
        player = new ExoPlayer.Builder(this)
                .setLoadControl(loadControl)
                .build();
        playerView.setPlayer(player);
        playbackDiagnostics = new PlaybackDiagnostics(this);
        playbackDiagnostics.attach(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_BUFFERING) {
                    setStatus("缓冲中：" + currentTitle());
                } else if (playbackState == Player.STATE_READY) {
                    if (player.getPlayWhenReady()) {
                        scheduleStablePlaybackReset();
                        setStatus("播放中：" + currentTitle());
                    }
                } else if (playbackState == Player.STATE_ENDED) {
                    showControls();
                    setStatus("播放结束，可切换其它节点。");
                }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                if (schedulePlaybackRecovery(error)) {
                    return;
                }
                Log.e(TAG, "Playback recovery exhausted for " + currentTitle()
                        + ": " + error.getErrorCodeName(), error);
                if (!userStopped && !activityPaused && tryNextNode()) {
                    return;
                }
                showControls();
                setStatus("播放失败：" + error.getErrorCodeName() + "。请切换其它节点或检查网络。");
            }
        });
    }

    private boolean schedulePlaybackRecovery(PlaybackException error) {
        if (userStopped || activityPaused || player == null) {
            return false;
        }
        if (playbackRecoveryPending) {
            return true;
        }
        if (playbackRecoveryAttempts >= MAX_PLAYBACK_RECOVERY_ATTEMPTS) {
            return false;
        }

        playbackRecoveryAttempts += 1;
        playbackRecoveryPending = true;
        uiHandler.removeCallbacks(playbackStableResetRunnable);
        playbackStableResetPending = false;
        Log.e(TAG, "Playback error: " + error.getErrorCodeName()
                + ", recovery attempt: " + playbackRecoveryAttempts, error);
        uiHandler.postDelayed(playbackRecoveryRunnable, PLAYBACK_RECOVERY_DELAY_MS);
        return true;
    }

    private void recoverPlayback() {
        playbackRecoveryPending = false;
        if (userStopped || activityPaused || player == null) {
            return;
        }
        Log.w(TAG, "Recovering playback, attempt: " + playbackRecoveryAttempts);
        player.prepare();
        player.play();
    }

    private void resetPlaybackRecovery() {
        uiHandler.removeCallbacks(playbackRecoveryRunnable);
        uiHandler.removeCallbacks(playbackStableResetRunnable);
        playbackRecoveryPending = false;
        playbackStableResetPending = false;
        playbackRecoveryAttempts = 0;
    }

    private void scheduleStablePlaybackReset() {
        if (playbackRecoveryAttempts == 0 || playbackStableResetPending) {
            return;
        }
        playbackStableResetPending = true;
        uiHandler.postDelayed(playbackStableResetRunnable, PLAYBACK_STABLE_RESET_DELAY_MS);
    }

    private void markPlaybackStable() {
        playbackStableResetPending = false;
        if (userStopped || activityPaused || player == null) {
            return;
        }
        Log.i(TAG, "Playback stable; resetting recovery attempts.");
        playbackRecoveryAttempts = 0;
    }

    private void loadChannels() {
        try {
            String json = readAsset("channels.json");
            JSONArray array = new JSONArray(json);
            channels.clear();
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.getJSONObject(i);
                Channel channel = new Channel();
                channel.id = item.optString("id", "channel-" + i);
                channel.name = item.optString("name", channel.id);
                channel.category = item.optString("category", "\u672a\u5206\u7c7b");

                JSONArray nodes = item.optJSONArray("nodes");
                if (nodes != null) {
                    for (int n = 0; n < nodes.length(); n++) {
                        JSONObject nodeJson = nodes.getJSONObject(n);
                        Node node = new Node();
                        node.label = nodeJson.optString("label", "节点" + (n + 1));
                        node.url = nodeJson.optString("url", "").trim();
                        if (!node.url.isEmpty()) {
                            channel.nodes.add(node);
                        }
                    }
                } else {
                    String url = item.optString("url", "").trim();
                    if (!url.isEmpty()) {
                        Node node = new Node();
                        node.label = "节点1";
                        node.url = url;
                        channel.nodes.add(node);
                    }
                }

                if (!channel.nodes.isEmpty()) {
                    channels.add(channel);
                }
            }
            loadCustomNodes();
            rebuildCategories();
            renderCategoryButtons();
            renderChannelButtons();
        } catch (Exception error) {
            channels.clear();
            setStatus("读取 channels.json 失败：" + error.getMessage());
        }
    }

    private void loadCustomNodes() {
        try {
            String json = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREF_CUSTOM_NODES, "{}");
            JSONObject root = new JSONObject(json);
            for (Channel channel : channels) {
                JSONArray nodes = root.optJSONArray(channel.id);
                if (nodes == null) {
                    continue;
                }
                for (int i = 0; i < nodes.length(); i++) {
                    JSONObject item = nodes.optJSONObject(i);
                    if (item == null) {
                        continue;
                    }
                    String url = item.optString("url", "").trim();
                    if (url.isEmpty()) {
                        continue;
                    }
                    Node node = new Node();
                    node.label = item.optString("label", "节点" + (channel.nodes.size() + 1));
                    node.url = url;
                    node.userAdded = true;
                    channel.nodes.add(node);
                }
            }
        } catch (Exception error) {
            setStatus("读取自定义节点失败：" + error.getMessage());
        }
    }

    private void saveCustomNodes() {
        try {
            JSONObject root = new JSONObject();
            for (Channel channel : channels) {
                JSONArray nodes = new JSONArray();
                for (Node node : channel.nodes) {
                    if (!node.userAdded || node.url == null || node.url.trim().isEmpty()) {
                        continue;
                    }
                    JSONObject item = new JSONObject();
                    item.put("label", node.label);
                    item.put("url", node.url.trim());
                    nodes.put(item);
                }
                if (nodes.length() > 0) {
                    root.put(channel.id, nodes);
                }
            }
            SharedPreferences.Editor editor = getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit();
            editor.putString(PREF_CUSTOM_NODES, root.toString());
            editor.apply();
        } catch (Exception error) {
            setStatus("保存自定义节点失败：" + error.getMessage());
        }
    }

    private String readAsset(String name) throws Exception {
        try (InputStream input = getAssets().open(name);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void rebuildCategories() {
        categories.clear();
        for (Channel channel : channels) {
            String category = categoryOf(channel);
            if (!categories.contains(category)) {
                categories.add(category);
            }
        }
        if (categories.isEmpty()) {
            activeCategory = "";
        } else if (activeCategory == null || activeCategory.isEmpty() || !categories.contains(activeCategory)) {
            activeCategory = categories.get(0);
        }
    }

    private String categoryOf(Channel channel) {
        if (channel == null || channel.category == null || channel.category.trim().isEmpty()) {
            return "\u672a\u5206\u7c7b";
        }
        return channel.category.trim();
    }

    private boolean isChannelVisible(int channelIndex) {
        if (activeCategory == null || activeCategory.isEmpty()) {
            return true;
        }
        if (channelIndex < 0 || channelIndex >= channels.size()) {
            return false;
        }
        return activeCategory.equals(categoryOf(channels.get(channelIndex)));
    }

    private int firstVisibleChannelIndex() {
        for (int i = 0; i < channels.size(); i++) {
            if (isChannelVisible(i)) {
                return i;
            }
        }
        return channels.isEmpty() ? -1 : 0;
    }

    private void renderCategoryButtons() {
        categoryTabs.removeAllViews();
        categoryButtons.clear();
        if (categories.size() <= 1) {
            categoryTabs.setVisibility(View.GONE);
            return;
        }
        categoryTabs.setVisibility(View.VISIBLE);
        for (String category : categories) {
            Button button = makeButton(category);
            button.setTextSize(14);
            button.setOnClickListener(v -> selectCategory(category));
            categoryButtons.add(button);
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(38), 1);
            params.setMargins(0, 0, dp(8), dp(4));
            categoryTabs.addView(button, params);
        }
        refreshCategoryButtons();
    }

    private void selectCategory(String category) {
        activeCategory = category;
        expandedChannelIndex = -1;
        if (!isChannelVisible(activeChannelIndex)) {
            int firstVisible = firstVisibleChannelIndex();
            if (firstVisible >= 0) {
                activeChannelIndex = firstVisible;
                activeNodeIndex = 0;
            }
        }
        renderChannelButtons();
        renderNodeButtons();
        refreshAllButtons();
        refreshNodePanelVisibility();
        showControls();
    }

    private void clearNodePanelsFromRoot() {
        for (LinearLayout panel : nodePanels) {
            rootLayout.removeView(panel);
        }
    }

    private void renderChannelButtons() {
        clearNodePanelsFromRoot();
        channelList.removeAllViews();
        channelButtons.clear();
        nodePanels.clear();
        visibleChannelIndexes.clear();
        for (int i = 0; i < channels.size(); i++) {
            final int index = i;
            LinearLayout panel = new LinearLayout(this);
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setPadding(dp(12), 0, dp(12), dp(10));
            panel.setBackground(makeNodePanelBackground());
            panel.setVisibility(View.GONE);
            nodePanels.add(panel);
            rootLayout.addView(panel, new FrameLayout.LayoutParams(
                    dp(260),
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.TOP | Gravity.START
            ));

            if (!isChannelVisible(i)) {
                continue;
            }

            visibleChannelIndexes.add(index);

            Button button = makeButton(channels.get(i).name);
            button.setGravity(Gravity.CENTER_VERTICAL);
            button.setOnClickListener(v -> selectChannel(index, true));
            button.setOnKeyListener((v, keyCode, event) -> {
                if (event.getAction() == KeyEvent.ACTION_DOWN
                        && keyCode == KeyEvent.KEYCODE_DPAD_LEFT) {
                    expandNodePanelAndFocusFirstNode(index);
                    return true;
                }
                return false;
            });
            channelButtons.add(button);

            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(46)
            );
            params.setMargins(0, 0, 0, dp(8));
            channelList.addView(button, params);
        }
        refreshCategoryButtons();
        refreshChannelButtons();
        refreshNodePanelVisibility();
    }

    private GradientDrawable makeNodePanelBackground() {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Color.rgb(27, 31, 40));
        drawable.setCornerRadius(dp(8));
        drawable.setStroke(dp(1), Color.rgb(95, 118, 153));
        return drawable;
    }

    private void renderNodeButtons() {
        nodeButtons.clear();
        for (int channelIndex = 0; channelIndex < channels.size(); channelIndex++) {
            LinearLayout panel = nodePanels.get(channelIndex);
            panel.removeAllViews();
            Channel channel = channels.get(channelIndex);

            for (int nodeIndex = 0; nodeIndex < channel.nodes.size(); nodeIndex++) {
                final int currentChannelIndex = channelIndex;
                final int currentNodeIndex = nodeIndex;
                Button button = makeButton(channel.nodes.get(nodeIndex).label);
                button.setGravity(Gravity.CENTER_VERTICAL);
                button.setTag(new int[]{currentChannelIndex, currentNodeIndex});
                button.setOnClickListener(v -> {
                    activeChannelIndex = currentChannelIndex;
                    activeNodeIndex = currentNodeIndex;
                    expandedChannelIndex = currentChannelIndex;
                    refreshAllButtons();
                    refreshNodePanelVisibility();
                    playActiveNode(false);
                });
                nodeButtons.add(button);
                LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        dp(42)
                );
                params.setMargins(0, 0, 0, dp(6));
                panel.addView(button, params);
            }

            final int currentChannelIndex = channelIndex;
            Button addButton = makeButton("添加节点");
            addButton.setGravity(Gravity.CENTER_VERTICAL);
            addButton.setOnClickListener(v -> addNode(currentChannelIndex));
            LinearLayout.LayoutParams addParams = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(42)
            );
            addParams.setMargins(0, 0, 0, dp(2));
            panel.addView(addButton, addParams);
        }
        refreshNodeButtons();
        refreshNodePanelVisibility();
    }

    private Button makeButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(15);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setFocusable(true);
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setOnFocusChangeListener((v, hasFocus) -> refreshAllButtons());
        applyButtonStyle(button, false, false);
        return button;
    }

    private void selectChannel(int index, boolean autoPlay) {
        activeChannelIndex = Math.max(0, Math.min(index, channels.size() - 1));
        activeNodeIndex = 0;
        renderNodeButtons();
        refreshChannelButtons();
        if (autoPlay) {
            playActiveNode(false);
        } else {
            showControls();
            setStatus("已选择：" + currentTitle());
        }
    }

    private void toggleNodePanel(int index) {
        activeChannelIndex = Math.max(0, Math.min(index, channels.size() - 1));
        activeNodeIndex = 0;
        expandedChannelIndex = expandedChannelIndex == activeChannelIndex ? -1 : activeChannelIndex;
        renderNodeButtons();
        refreshAllButtons();
        refreshNodePanelVisibility();
        showControls();
        if (expandedChannelIndex != -1) {
            setStatus("已展开：" + channels.get(activeChannelIndex).name + " 的节点。");
        }
    }

    private void expandNodePanelAndFocusFirstNode(int channelIndex) {
        activeChannelIndex = Math.max(0, Math.min(channelIndex, channels.size() - 1));
        activeNodeIndex = 0;
        expandedChannelIndex = activeChannelIndex;
        renderNodeButtons();
        refreshAllButtons();
        refreshNodePanelVisibility();
        Button firstNodeButton = firstNodeButtonForChannel(activeChannelIndex);
        if (firstNodeButton != null) {
            rootLayout.post(() -> firstNodeButton.requestFocus());
        }
        setStatus("已展开：" + channels.get(activeChannelIndex).name + " 的节点。");
    }

    private Button firstNodeButtonForChannel(int channelIndex) {
        for (Button button : nodeButtons) {
            Object tag = button.getTag();
            if (tag instanceof int[]) {
                int[] indexes = (int[]) tag;
                if (indexes.length == 2 && indexes[0] == channelIndex && indexes[1] == 0) {
                    return button;
                }
            }
        }
        return null;
    }

    private void addNode(int channelIndex) {
        if (channelIndex < 0 || channelIndex >= channels.size()) {
            return;
        }
        activeChannelIndex = channelIndex;
        expandedChannelIndex = channelIndex;
        refreshAllButtons();
        refreshNodePanelVisibility();
        showControls();
        showAddNodeQr(channelIndex);
    }

    private void showAddNodeQr(int channelIndex) {
        try {
            ensureAddNodeServer();
            String host = getLocalIpAddress();
            if (host == null) {
                setStatus("无法获取电视局域网 IP。请确认电视已连接 Wi-Fi 或有线网络。");
                return;
            }

            String token = System.currentTimeMillis() + "-" + channelIndex;
            pendingAddRequests.put(token, channelIndex);
            String url = "http://" + host + ":" + ADD_NODE_PORT + "/add?token="
                    + URLEncoder.encode(token, "UTF-8");

            LinearLayout content = new LinearLayout(this);
            content.setOrientation(LinearLayout.VERTICAL);
            content.setPadding(dp(24), dp(18), dp(24), dp(12));

            TextView title = makeLabel("手机扫码添加节点", 20, true);
            title.setTextColor(Color.BLACK);
            content.addView(title, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(42)
            ));

            TextView hint = makeLabel("频道：" + channels.get(channelIndex).name + "\n手机和电视需要连接同一个局域网。", 14, false);
            hint.setTextColor(Color.rgb(45, 52, 64));
            content.addView(hint, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(64)
            ));

            ImageView qrView = new ImageView(this);
            qrView.setImageBitmap(createQrBitmap(url, dp(260)));
            qrView.setAdjustViewBounds(true);
            content.addView(qrView, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(280)
            ));

            TextView urlView = makeLabel(url, 12, false);
            urlView.setTextColor(Color.rgb(45, 52, 64));
            urlView.setGravity(Gravity.CENTER);
            content.addView(urlView, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    dp(48)
            ));

            if (addNodeDialog != null) {
                addNodeDialog.dismiss();
            }
            addNodeDialog = new AlertDialog.Builder(this)
                    .setView(content)
                    .setNegativeButton("关闭", null)
                    .create();
            addNodeDialog.setOnDismissListener(dialog -> pendingAddRequests.remove(token));
            addNodeDialog.show();
            setStatus("请用手机扫码，为 " + channels.get(channelIndex).name + " 添加节点。");
        } catch (Exception error) {
            setStatus("生成添加节点二维码失败：" + error.getMessage());
        }
    }

    private void addNodeFromRemote(String token, String label, String url) {
        Integer channelIndex = pendingAddRequests.remove(token);
        if (channelIndex == null || channelIndex < 0 || channelIndex >= channels.size()) {
            setStatus("添加节点失败：二维码已失效，请重新打开添加节点。");
            return;
        }
        String cleanUrl = url == null ? "" : url.trim();
        if (cleanUrl.isEmpty() || !(cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://"))) {
            setStatus("添加节点失败：请输入 http 或 https 开头的播放链接。");
            return;
        }

        Channel channel = channels.get(channelIndex);
        Node node = new Node();
        node.label = label == null || label.trim().isEmpty()
                ? "节点" + (channel.nodes.size() + 1)
                : label.trim();
        node.url = cleanUrl;
        node.userAdded = true;
        channel.nodes.add(node);
        saveCustomNodes();

        activeChannelIndex = channelIndex;
        activeNodeIndex = channel.nodes.size() - 1;
        expandedChannelIndex = channelIndex;
        renderNodeButtons();
        refreshAllButtons();
        refreshNodePanelVisibility();
        if (addNodeDialog != null) {
            addNodeDialog.dismiss();
            addNodeDialog = null;
        }
        showControls();
        setStatus("已保存新节点：" + channel.name + " " + node.label);
    }

    private void ensureAddNodeServer() throws IOException {
        if (addNodeServer != null && addNodeServer.isAlive()) {
            return;
        }
        addNodeServer = new AddNodeServer();
        addNodeServer.start();
    }

    private Bitmap createQrBitmap(String text, int size) throws Exception {
        BitMatrix matrix = new MultiFormatWriter().encode(text, BarcodeFormat.QR_CODE, size, size);
        Bitmap bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565);
        for (int x = 0; x < size; x++) {
            for (int y = 0; y < size; y++) {
                bitmap.setPixel(x, y, matrix.get(x, y) ? Color.BLACK : Color.WHITE);
            }
        }
        return bitmap;
    }

    private String getLocalIpAddress() {
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface networkInterface = interfaces.nextElement();
                if (!networkInterface.isUp() || networkInterface.isLoopback()) {
                    continue;
                }
                Enumeration<InetAddress> addresses = networkInterface.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        return address.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private String buildAddNodeForm(String token) {
        Integer channelIndex = pendingAddRequests.get(token);
        String channelName = channelIndex == null || channelIndex < 0 || channelIndex >= channels.size()
                ? "未知频道"
                : channels.get(channelIndex).name;
        return "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>添加节点</title>"
                + "<style>body{font-family:Arial,'Microsoft YaHei',sans-serif;background:#111318;color:#f4f7fb;margin:0;padding:20px;}"
                + "main{max-width:520px;margin:auto;}label{display:block;margin:16px 0 8px;color:#aeb7c6;}"
                + "input{box-sizing:border-box;width:100%;min-height:46px;padding:10px;border:1px solid #343b49;border-radius:6px;background:#1b1f28;color:#fff;font-size:16px;}"
                + "button{width:100%;min-height:48px;margin-top:18px;border:0;border-radius:6px;background:#2f80ed;color:#fff;font-size:17px;}"
                + ".hint{color:#aeb7c6;line-height:1.5;}</style></head><body><main>"
                + "<h1>添加播放节点</h1><p class=\"hint\">频道：" + escapeHtml(channelName) + "</p>"
                + "<form method=\"post\" action=\"/add\">"
                + "<input type=\"hidden\" name=\"token\" value=\"" + escapeHtml(token) + "\">"
                + "<label>节点名称</label><input name=\"label\" placeholder=\"例如：节点5\">"
                + "<label>m3u8 链接</label><input name=\"url\" required placeholder=\"https://.../live.m3u8\">"
                + "<button type=\"submit\">保存到电视播放器</button></form></main></body></html>";
    }

    private String buildSuccessPage() {
        return "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>已保存</title><style>body{font-family:Arial,'Microsoft YaHei',sans-serif;background:#111318;color:#f4f7fb;margin:0;padding:28px;line-height:1.6;}"
                + "main{max-width:520px;margin:auto;}a{color:#79b5ff;}</style></head><body><main>"
                + "<h1>已保存</h1><p>新节点已经添加到电视播放器。可以回到电视上选择播放。</p>"
                + "</main></body></html>";
    }

    private String buildErrorPage(String message) {
        return "<!doctype html><html><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>保存失败</title><style>body{font-family:Arial,'Microsoft YaHei',sans-serif;background:#111318;color:#f4f7fb;margin:0;padding:28px;line-height:1.6;}"
                + "main{max-width:520px;margin:auto;}.error{color:#ff8a8a;}</style></head><body><main>"
                + "<h1>保存失败</h1><p class=\"error\">" + escapeHtml(message) + "</p>"
                + "<p>请回到电视上重新打开添加节点二维码。</p></main></body></html>";
    }

    private String escapeHtml(String value) {
        if (value == null) {
            return "";
        }
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    private Map<String, String> parseFormBody(String body) throws Exception {
        Map<String, String> values = new HashMap<>();
        if (body == null || body.isEmpty()) {
            return values;
        }
        String[] pairs = body.split("&");
        for (String pair : pairs) {
            int separator = pair.indexOf('=');
            String key = separator >= 0 ? pair.substring(0, separator) : pair;
            String value = separator >= 0 ? pair.substring(separator + 1) : "";
            values.put(
                    URLDecoder.decode(key, "UTF-8"),
                    URLDecoder.decode(value, "UTF-8")
            );
        }
        return values;
    }

    private void writeHttpResponse(Socket socket, int statusCode, String statusText, String html) throws IOException {
        byte[] body = html.getBytes(StandardCharsets.UTF_8);
        String headers = "HTTP/1.1 " + statusCode + " " + statusText + "\r\n"
                + "Content-Type: text/html; charset=utf-8\r\n"
                + "Content-Length: " + body.length + "\r\n"
                + "Connection: close\r\n\r\n";
        OutputStream output = socket.getOutputStream();
        output.write(headers.getBytes(StandardCharsets.UTF_8));
        output.write(body);
        output.flush();
    }

    private void playActiveNode(boolean keepFullscreen) {
        if (playbackDiagnostics != null) {
            playbackDiagnostics.stopSession();
        }
        Node node = activeNode();
        if (node == null || node.url.isEmpty()) {
            if (keepFullscreen) {
                hideControls();
            } else {
                showControls();
            }
            setStatus("当前频道没有可用播放地址。");
            return;
        }

        userStopped = false;
        resetPlaybackRecovery();
        if (playbackDiagnostics != null) {
            playbackDiagnostics.startSession(node.url);
        }
        setStatus("加载中：" + currentTitle());
        MediaItem.Builder mediaItemBuilder = new MediaItem.Builder()
                .setUri(Uri.parse(node.url));
        if (isHlsUrl(node.url)) {
            mediaItemBuilder.setMimeType(MimeTypes.APPLICATION_M3U8);
        }
        MediaItem mediaItem = mediaItemBuilder.build();
        if (isHlsUrl(node.url)) {
            HlsMediaSource.Factory hlsFactory = new HlsMediaSource.Factory(
                    new DefaultHttpDataSource.Factory())
                    .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy());
            player.setMediaSource(hlsFactory.createMediaSource(mediaItem));
        } else {
            player.setMediaItem(mediaItem);
        }
        player.prepare();
        player.play();
        if (keepFullscreen) {
            hideControls();
        } else {
            showControls();
            scheduleHideControls();
        }
    }

    private boolean isFlvUrl(String url) {
        return url != null && url.toLowerCase(Locale.ROOT).contains(".flv");
    }

    private boolean isHlsUrl(String url) {
        if (url == null) {
            return false;
        }
        String lowerUrl = url.toLowerCase(Locale.ROOT);
        return lowerUrl.contains(".m3u8") || lowerUrl.contains(".m3u");
    }

    private boolean tryNextNode() {
        Channel channel = activeChannel();
        if (channel == null || activeNodeIndex + 1 >= channel.nodes.size()) {
            return false;
        }
        activeNodeIndex += 1;
        refreshNodeButtons();
        setStatus("当前节点失败，切换到：" + currentTitle());
        playActiveNode(!controlsVisible);
        return true;
    }

    private void switchChannelFromFullscreen(int direction) {
        if (controlsVisible || visibleChannelIndexes.isEmpty()) {
            return;
        }
        clearPendingExitConfirm();
        int visibleIndex = visibleChannelIndexes.indexOf(activeChannelIndex);
        if (visibleIndex < 0) {
            visibleIndex = 0;
        }
        int nextVisibleIndex = (visibleIndex + direction + visibleChannelIndexes.size()) % visibleChannelIndexes.size();
        activeChannelIndex = visibleChannelIndexes.get(nextVisibleIndex);
        activeNodeIndex = 0;
        expandedChannelIndex = -1;
        renderNodeButtons();
        refreshAllButtons();
        refreshNodePanelVisibility();
        playActiveNode(true);
    }

    private Channel activeChannel() {
        if (channels.isEmpty() || activeChannelIndex < 0 || activeChannelIndex >= channels.size()) {
            return null;
        }
        return channels.get(activeChannelIndex);
    }

    private Node activeNode() {
        Channel channel = activeChannel();
        if (channel == null || channel.nodes.isEmpty()) {
            return null;
        }
        if (activeNodeIndex < 0 || activeNodeIndex >= channel.nodes.size()) {
            activeNodeIndex = 0;
        }
        return channel.nodes.get(activeNodeIndex);
    }

    private String currentTitle() {
        Channel channel = activeChannel();
        Node node = activeNode();
        if (channel == null) {
            return "未知频道";
        }
        if (node == null) {
            return channel.name;
        }
        return channel.name + " " + node.label;
    }

    private void refreshAllButtons() {
        refreshCategoryButtons();
        refreshChannelButtons();
        refreshNodeButtons();
    }

    private void refreshCategoryButtons() {
        for (int i = 0; i < categoryButtons.size(); i++) {
            Button button = categoryButtons.get(i);
            boolean selected = i < categories.size() && categories.get(i).equals(activeCategory);
            applyButtonStyle(button, selected, button.hasFocus());
        }
    }

    private void refreshChannelButtons() {
        for (int i = 0; i < channelButtons.size(); i++) {
            Button button = channelButtons.get(i);
            int channelIndex = visibleChannelIndexes.get(i);
            boolean expanded = channelIndex == expandedChannelIndex;
            boolean selected = expanded || channelIndex == activeChannelIndex;
            applyButtonStyle(button, selected, button.hasFocus());
            button.setText((button.hasFocus() || expanded ? "<  " : "   ") + channels.get(channelIndex).name);
        }
    }

    private void refreshNodeButtons() {
        for (Button button : nodeButtons) {
            Object tag = button.getTag();
            boolean selected = false;
            if (tag instanceof int[]) {
                int[] indexes = (int[]) tag;
                selected = indexes.length == 2
                        && indexes[0] == activeChannelIndex
                        && indexes[1] == activeNodeIndex;
            }
            applyButtonStyle(button, selected, button.hasFocus());
        }
    }

    private void refreshNodePanelVisibility() {
        for (int i = 0; i < nodePanels.size(); i++) {
            LinearLayout panel = nodePanels.get(i);
            panel.setVisibility(i == expandedChannelIndex ? View.VISIBLE : View.GONE);
            if (i == expandedChannelIndex) {
                panel.bringToFront();
            }
        }
        updateExpandedNodePanelPosition();
    }

    private void updateExpandedNodePanelPosition() {
        if (expandedChannelIndex < 0 || expandedChannelIndex >= nodePanels.size()) {
            return;
        }
        int visibleIndex = visibleChannelIndexes.indexOf(expandedChannelIndex);
        if (visibleIndex < 0 || visibleIndex >= channelButtons.size()) {
            return;
        }

        LinearLayout panel = nodePanels.get(expandedChannelIndex);
        Button channelButton = channelButtons.get(visibleIndex);
        if (panel.getVisibility() != View.VISIBLE || rootLayout.getWidth() == 0 || channelButton.getWidth() == 0) {
            return;
        }

        rootLayout.post(() -> positionNodePanel(panel, channelButton));
    }

    private void positionNodePanel(LinearLayout panel, Button channelButton) {
        int panelWidth = dp(260);
        int[] rootLocation = new int[2];
        int[] channelButtonLocation = new int[2];
        rootLayout.getLocationOnScreen(rootLocation);
        channelButton.getLocationOnScreen(channelButtonLocation);

        panel.measure(
                View.MeasureSpec.makeMeasureSpec(panelWidth, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
        );

        int margin = dp(14);
        int gap = dp(10);
        int left = channelButtonLocation[0] - rootLocation[0] - panelWidth - gap;
        int top = channelButtonLocation[1] - rootLocation[1];
        int[] channelScrollLocation = new int[2];
        channelScroll.getLocationOnScreen(channelScrollLocation);
        int minTop = Math.max(margin, channelScrollLocation[1] - rootLocation[1]);

        FrameLayout.LayoutParams params = (FrameLayout.LayoutParams) panel.getLayoutParams();
        params.width = panelWidth;
        params.height = FrameLayout.LayoutParams.WRAP_CONTENT;
        params.leftMargin = Math.max(margin, left);
        params.topMargin = Math.max(minTop, top);
        panel.setLayoutParams(params);
    }

    private void applyButtonStyle(Button button, boolean selected, boolean focused) {
        int color = selected ? Color.rgb(47, 128, 237) : Color.rgb(35, 41, 55);
        int stroke = focused ? Color.WHITE : (selected ? Color.rgb(121, 181, 255) : Color.rgb(60, 68, 84));

        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(6));
        drawable.setStroke(dp(focused ? 2 : 1), stroke);
        button.setBackground(drawable);
    }

    private void setStatus(String message) {
        statusView.setText(message);
    }

    private void showControls() {
        uiHandler.removeCallbacks(hideControlsRunnable);
        clearPendingExitConfirm();
        controlsVisible = true;
        rootLayout.setPadding(dp(14), dp(14), dp(14), dp(14));
        sidePanel.setVisibility(View.VISIBLE);
        statusView.setVisibility(View.VISIBLE);
        if (!channelButtons.isEmpty()) {
            int visibleIndex = visibleChannelIndexes.indexOf(activeChannelIndex);
            if (visibleIndex < 0) {
                visibleIndex = 0;
            }
            channelButtons.get(Math.max(0, Math.min(visibleIndex, channelButtons.size() - 1))).requestFocus();
        }
        hideSystemUi();
    }

    private void hideControls() {
        uiHandler.removeCallbacks(hideControlsRunnable);
        controlsVisible = false;
        expandedChannelIndex = -1;
        refreshNodePanelVisibility();
        sidePanel.setVisibility(View.GONE);
        statusView.setVisibility(View.GONE);
        rootLayout.setPadding(0, 0, 0, 0);
        playerView.requestFocus();
        hideSystemUi();
    }

    private void scheduleHideControls() {
        uiHandler.removeCallbacks(hideControlsRunnable);
        uiHandler.postDelayed(hideControlsRunnable, 2500);
    }

    private void clearPendingExitConfirm() {
        pendingExitConfirm = false;
        uiHandler.removeCallbacks(resetPendingExitRunnable);
    }

    private void handleFullscreenBack() {
        if (pendingExitConfirm) {
            showExitConfirmDialog();
            return;
        }
        pendingExitConfirm = true;
        uiHandler.removeCallbacks(resetPendingExitRunnable);
        uiHandler.postDelayed(resetPendingExitRunnable, 2000);
        Toast.makeText(this, "再按一次返回退出", Toast.LENGTH_SHORT).show();
        hideSystemUi();
    }

    private void showExitConfirmDialog() {
        uiHandler.removeCallbacks(resetPendingExitRunnable);
        pendingExitConfirm = false;
        if (exitConfirmDialog != null && exitConfirmDialog.isShowing()) {
            return;
        }
        exitConfirmDialog = new AlertDialog.Builder(this)
                .setTitle("是否退出程序？")
                .setMessage("确认退出电视播放器？")
                .setNegativeButton("取消", (dialog, which) -> {
                    dialog.dismiss();
                    clearPendingExitConfirm();
                    hideControls();
                })
                .setPositiveButton("确认", (dialog, which) -> {
                    clearPendingExitConfirm();
                    finishAndRemoveTask();
                })
                .create();
        exitConfirmDialog.setOnCancelListener(dialog -> {
            clearPendingExitConfirm();
            hideControls();
        });
        exitConfirmDialog.setOnDismissListener(dialog -> hideSystemUi());
        exitConfirmDialog.show();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            int keyCode = event.getKeyCode();
            if (!controlsVisible && keyCode == KeyEvent.KEYCODE_DPAD_UP) {
                switchChannelFromFullscreen(-1);
                return true;
            }
            if (!controlsVisible && keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                switchChannelFromFullscreen(1);
                return true;
            }
            if (!controlsVisible && (
                    keyCode == KeyEvent.KEYCODE_DPAD_CENTER
                            || keyCode == KeyEvent.KEYCODE_ENTER
                            || keyCode == KeyEvent.KEYCODE_MENU
                            || keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
            )) {
                showControls();
                return true;
            }

            if (keyCode == KeyEvent.KEYCODE_BACK) {
                if (controlsVisible) {
                    hideControls();
                    return true;
                }
                handleFullscreenBack();
                return true;
            }

            if (controlsVisible) {
                uiHandler.removeCallbacks(hideControlsRunnable);
            }
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        activityPaused = true;
        resetPlaybackRecovery();
        if (playbackDiagnostics != null) {
            playbackDiagnostics.detach();
        }
        if (player != null) {
            player.pause();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        activityPaused = false;
        if (player != null && playbackDiagnostics != null) {
            playbackDiagnostics.attach(player);
        }
    }

    @Override
    protected void onDestroy() {
        userStopped = true;
        activityPaused = true;
        uiHandler.removeCallbacks(hideControlsRunnable);
        uiHandler.removeCallbacks(resetPendingExitRunnable);
        resetPlaybackRecovery();
        if (addNodeDialog != null) {
            addNodeDialog.dismiss();
            addNodeDialog = null;
        }
        if (exitConfirmDialog != null) {
            exitConfirmDialog.dismiss();
            exitConfirmDialog = null;
        }
        if (addNodeServer != null) {
            addNodeServer.shutdown();
            addNodeServer = null;
        }
        if (playbackDiagnostics != null) {
            playbackDiagnostics.detach();
            playbackDiagnostics = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static class Channel {
        String id;
        String name;
        String category;
        final List<Node> nodes = new ArrayList<>();
    }

    private static class Node {
        String label;
        String url;
        boolean userAdded;
    }

    private class AddNodeServer extends Thread {
        private ServerSocket serverSocket;
        private volatile boolean running = true;

        AddNodeServer() throws IOException {
            super("TV1AddNodeServer");
            serverSocket = new ServerSocket(ADD_NODE_PORT);
        }

        @Override
        public void run() {
            while (running) {
                try (Socket socket = serverSocket.accept()) {
                    handleClient(socket);
                } catch (IOException error) {
                    if (running) {
                        uiHandler.post(() -> setStatus("添加节点服务异常：" + error.getMessage()));
                    }
                }
            }
        }

        void shutdown() {
            running = false;
            try {
                if (serverSocket != null) {
                    serverSocket.close();
                }
            } catch (IOException ignored) {
            }
        }

        private void handleClient(Socket socket) throws IOException {
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String requestLine = reader.readLine();
            if (requestLine == null || requestLine.isEmpty()) {
                writeHttpResponse(socket, 400, "Bad Request", buildErrorPage("请求为空。"));
                return;
            }

            String[] parts = requestLine.split(" ");
            String method = parts.length > 0 ? parts[0] : "";
            String path = parts.length > 1 ? parts[1] : "/";
            int contentLength = 0;
            String header;
            while ((header = reader.readLine()) != null && !header.isEmpty()) {
                int separator = header.indexOf(':');
                if (separator > 0 && "content-length".equalsIgnoreCase(header.substring(0, separator).trim())) {
                    try {
                        contentLength = Integer.parseInt(header.substring(separator + 1).trim());
                    } catch (NumberFormatException ignored) {
                        contentLength = 0;
                    }
                }
            }

            try {
                if ("GET".equalsIgnoreCase(method) && path.startsWith("/add")) {
                    String token = queryValue(path, "token");
                    if (token == null || !pendingAddRequests.containsKey(token)) {
                        writeHttpResponse(socket, 404, "Not Found", buildErrorPage("二维码已失效。"));
                        return;
                    }
                    writeHttpResponse(socket, 200, "OK", buildAddNodeForm(token));
                    return;
                }

                if ("POST".equalsIgnoreCase(method) && path.startsWith("/add")) {
                    char[] buffer = new char[Math.max(contentLength, 0)];
                    int total = 0;
                    while (total < buffer.length) {
                        int read = reader.read(buffer, total, buffer.length - total);
                        if (read == -1) {
                            break;
                        }
                        total += read;
                    }
                    Map<String, String> form = parseFormBody(new String(buffer, 0, total));
                    String token = form.get("token");
                    String url = form.get("url");
                    if (token == null || !pendingAddRequests.containsKey(token)) {
                        writeHttpResponse(socket, 404, "Not Found", buildErrorPage("二维码已失效。"));
                        return;
                    }
                    if (url == null || url.trim().isEmpty()) {
                        writeHttpResponse(socket, 400, "Bad Request", buildErrorPage("请输入播放链接。"));
                        return;
                    }
                    uiHandler.post(() -> addNodeFromRemote(token, form.get("label"), url));
                    writeHttpResponse(socket, 200, "OK", buildSuccessPage());
                    return;
                }

                writeHttpResponse(socket, 404, "Not Found", buildErrorPage("页面不存在。"));
            } catch (Exception error) {
                writeHttpResponse(socket, 500, "Internal Server Error", buildErrorPage(error.getMessage()));
            }
        }

        private String queryValue(String path, String name) throws Exception {
            int queryIndex = path.indexOf('?');
            if (queryIndex < 0 || queryIndex + 1 >= path.length()) {
                return null;
            }
            String[] pairs = path.substring(queryIndex + 1).split("&");
            for (String pair : pairs) {
                int separator = pair.indexOf('=');
                String key = separator >= 0 ? pair.substring(0, separator) : pair;
                String value = separator >= 0 ? pair.substring(separator + 1) : "";
                if (name.equals(URLDecoder.decode(key, "UTF-8"))) {
                    return URLDecoder.decode(value, "UTF-8");
                }
            }
            return null;
        }
    }
}
