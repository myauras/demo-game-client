/**
 * Aura Web Host Bridge
 * 外部頁面以 sendJsonToUnity / postMessage 呼叫 PlatformBridge.OnPlatformJsonRaw；
 * GameBundle 尚未就緒時先保留訊息，待 PlatformBridge 安裝後依序送入。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') {
    return;
  }

  // 在 Cocos 引擎初始化前先取得正式站相同目錄的 VersionConfig。
  // BaseManager 會接手這個 Promise；任何失敗都轉成結果物件，避免未處理的 rejection。
  function startVersionConfigPrefetch() {
    if (window.__auraVersionConfigPrefetch || typeof window.fetch !== 'function') return;
    try {
      var pageUrl = new URL(window.location.href);
      if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') return;
      var configUrl = new URL('./VersionConfig.json', pageUrl).toString();
      var separator = configUrl.indexOf('?') >= 0 ? '&' : '?';
      var requestUrl = configUrl + separator + '_t=' + Date.now();
      var promise = window.fetch(requestUrl, { cache: 'no-store' })
        .then(function (response) {
          if (!response.ok) {
            return { ok: false, status: response.status };
          }
          return response.json().then(function (raw) {
            return { ok: true, status: response.status, raw: raw };
          });
        })
        .catch(function (error) {
          return {
            ok: false,
            status: 0,
            errorMessage: error && error.message ? String(error.message) : String(error),
          };
        });
      window.__auraVersionConfigPrefetch = { url: configUrl, promise: promise };
    } catch (error) {
      // 非標準 Preview URL 仍由 VersionConfigLoader 原流程處理。
    }
  }

  startVersionConfigPrefetch();

  var enableWindowMessageBridge = true;
  var maxPlatformJsonQueue = 64;
  var mainProgramLoadingComplete = false;
  var lastMainProgramProgress = -1;
  var mainProgramResourceObserver = null;
  window.__auraPlatformJsonQueue = Array.isArray(window.__auraPlatformJsonQueue)
    ? window.__auraPlatformJsonQueue.slice(-maxPlatformJsonQueue)
    : [];
  try {
    enableWindowMessageBridge = !/([?&])disablePostMessageBridge=1(&|$)/i.test(window.location.search);
  } catch (e) {
    enableWindowMessageBridge = true;
  }

  function getPostMessageTargetWindow() {
    return window.parent || window;
  }

  function postJsonMessageToHost(payload, suppressLog) {
    try {
      if (!suppressLog) {
        console.log('[HostBridge] postMessage:', JSON.stringify(payload));
      }
      getPostMessageTargetWindow().postMessage(payload, '*');
      return true;
    } catch (error) {
      console.warn('[HostBridge] postMessage failed:', error);
      return false;
    }
  }

  function notifyHostLifecycle(message, data) {
    if (message === 'game_loaded') {
      completeMainProgramLoading();
    }
    if (
      message === 'game_entry' &&
      typeof window.buildToolNotifyCandidateReady === 'function'
    ) {
      window.buildToolNotifyCandidateReady();
    }
    var isLoadingProgress = message === 'loading_progress';
    if (isLoadingProgress) {
      console.log('loading_progress:' + String(data && data.value != null ? data.value : ''));
    } else {
      console.log(message);
    }
    postJsonMessageToHost({
      cmd: message,
      data: data || {},
    }, isLoadingProgress);
  }

  function setMainProgramProgress(percent) {
    if (mainProgramLoadingComplete) {
      return;
    }
    var value = Math.max(0, Math.min(99, Math.round(Number(percent) || 0)));
    if (value <= lastMainProgramProgress) {
      return;
    }
    lastMainProgramProgress = value;
    updateMainProgramLoadingVisual(value);
    notifyHostLifecycle('loading_progress', { value: value });
  }

  function updateMainProgramLoadingVisual(percent) {
    try {
      if (
        window.auraStaticLoadingShell
        && typeof window.auraStaticLoadingShell.setProgress === 'function'
      ) {
        window.auraStaticLoadingShell.setProgress(percent);
      }
    } catch (error) {
      console.warn('[HostBridge] Static loading progress failed:', error);
    }
  }

  function completeMainProgramLoading() {
    if (mainProgramLoadingComplete) {
      return;
    }
    updateMainProgramLoadingVisual(100);
    try {
      if (
        window.auraStaticLoadingShell
        && typeof window.auraStaticLoadingShell.revealCocos === 'function'
      ) {
        window.auraStaticLoadingShell.revealCocos();
      }
    } catch (error) {
      console.warn('[HostBridge] Static loading handoff failed:', error);
    }
    mainProgramLoadingComplete = true;
    lastMainProgramProgress = 100;
    if (mainProgramResourceObserver) {
      mainProgramResourceObserver.disconnect();
      mainProgramResourceObserver = null;
    }
    notifyHostLifecycle('loading_progress', { value: 100 });
  }

  function observeMainProgramResources() {
    if (typeof PerformanceObserver !== 'function') {
      return;
    }
    try {
      var baseUrl = new URL('index.79231.js', window.location.href);
      mainProgramResourceObserver = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          var resourceUrl;
          try {
            resourceUrl = new URL(entry.name, window.location.href);
          } catch (error) {
            return;
          }
          if (
            resourceUrl.origin !== baseUrl.origin ||
            resourceUrl.pathname.indexOf(baseUrl.pathname) !== 0 ||
            /platform-host-bridge(?:\.[a-z0-9_-]+)?\.js$/i.test(resourceUrl.pathname)
          ) {
            return;
          }
          var remaining = 25 - Math.max(0, lastMainProgramProgress);
          if (remaining > 0) {
            setMainProgramProgress(Math.min(25, lastMainProgramProgress + Math.max(1, Math.ceil(remaining * 0.2))));
          }
        });
      });
      mainProgramResourceObserver.observe({ type: 'resource', buffered: true });
    } catch (error) {
      mainProgramResourceObserver = null;
    }
  }

  window.auraSetMainProgramProgress = setMainProgramProgress;

  window.auraPostLifecycle = notifyHostLifecycle;

  window.auraSendAction = function (action) {
    var normalizedAction = String(action || '');
    // GameBundle entry uses this action route, rather than auraPostLifecycle.
    // Notify the optional candidate observer from the same real entry signal.
    if (
      normalizedAction === 'game_entry' &&
      typeof window.buildToolNotifyCandidateReady === 'function'
    ) {
      window.buildToolNotifyCandidateReady();
    }
    console.log('SendAction:', normalizedAction);
    if (typeof window.sendAction === 'function' && window.sendAction !== window.auraSendAction) {
      window.sendAction(normalizedAction);
      return true;
    }
    return postJsonMessageToHost({ action: normalizedAction });
  };

  window.auraSendActionWithParam = function (action, param) {
    var normalizedAction = String(action || '');
    var normalizedParam = String(param == null ? '' : param);
    console.log('SendActionWithParam: action=' + normalizedAction + ' param=' + normalizedParam);
    if (
      typeof window.sendActionWithParam === 'function' &&
      window.sendActionWithParam !== window.auraSendActionWithParam
    ) {
      window.sendActionWithParam(normalizedAction, normalizedParam);
      return true;
    }
    return postJsonMessageToHost({ action: normalizedAction, param: normalizedParam });
  };

  function normalizeJsonRaw(jsonRaw) {
    if (jsonRaw === undefined) {
      return null;
    }
    if (jsonRaw === null) {
      return 'null';
    }
    if (typeof jsonRaw === 'string') {
      return jsonRaw;
    }
    try {
      return JSON.stringify(jsonRaw);
    } catch (error) {
      return null;
    }
  }

  function flushPlatformJsonQueue() {
    if (typeof window.OnPlatformJsonRaw !== 'function') {
      return false;
    }

    while (window.__auraPlatformJsonQueue.length > 0) {
      var jsonRaw = window.__auraPlatformJsonQueue.shift();
      try {
        window.OnPlatformJsonRaw(jsonRaw);
      } catch (error) {
        console.warn('[PlatformBridge.index] queued message dispatch failed:', error);
      }
    }
    return true;
  }

  function queuePlatformJson(jsonRaw) {
    if (window.__auraPlatformJsonQueue.length >= maxPlatformJsonQueue) {
      window.__auraPlatformJsonQueue.shift();
    }
    window.__auraPlatformJsonQueue.push(jsonRaw);
    console.warn('[PlatformBridge.index] Game is not ready, queued.');
    return false;
  }

  window.auraFlushPlatformJsonQueue = flushPlatformJsonQueue;

  window.sendJsonToGame = function (jsonRaw) {
    try {
      if (jsonRaw === undefined) {
        console.warn('[PlatformBridge.index] jsonRaw is undefined.');
        return false;
      }

      jsonRaw = normalizeJsonRaw(jsonRaw);
      if (jsonRaw === null) {
        console.warn('[PlatformBridge.index] jsonRaw is invalid.');
        return false;
      }

      console.log('[PlatformBridge.index] received jsonRaw:', jsonRaw);
      if (typeof window.OnPlatformJsonRaw !== 'function') {
        return queuePlatformJson(jsonRaw);
      }

      window.OnPlatformJsonRaw(jsonRaw);
      return true;
    } catch (error) {
      console.warn('[PlatformBridge.index] sendJsonToGame failed:', error);
      return false;
    }
  };

  // 與既有宿主（Unity 嵌入協定）相容
  window.sendJsonToUnity = window.sendJsonToGame;
  window.sendRawJsonToUnity = window.sendJsonToGame;

  function isHostOutboundMessage(data) {
    if (data === 'game_load' || data === 'game_loaded') {
      return true;
    }

    var parsed = data;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch (error) {
        return false;
      }
    }

    return !!(
      parsed &&
      typeof parsed === 'object' &&
      (
        parsed.cmd === 'game_load' ||
        parsed.cmd === 'game_loaded' ||
        parsed.cmd === 'loading_progress'
      )
    );
  }

  function normalizeHostPostMessageData(data) {
    if (typeof data === 'string') {
      var text = data.trim();
      if (!text) {
        return null;
      }
      try {
        var parsed = JSON.parse(text);
        if (parsed && parsed.cmd) {
          return text;
        }
        if (parsed && parsed.type === 'unity_json' && parsed.payload !== undefined) {
          return typeof parsed.payload === 'string'
            ? parsed.payload
            : JSON.stringify(parsed.payload);
        }
      } catch (e) {
        return null;
      }
      return null;
    }

    if (data && typeof data === 'object') {
      if (data.cmd) {
        return JSON.stringify(data);
      }
      if (data.type === 'unity_json' && data.payload !== undefined) {
        return typeof data.payload === 'string'
          ? data.payload
          : JSON.stringify(data.payload);
      }
    }

    return null;
  }

  function handlePlatformMessage(event) {
    try {
      if (isHostOutboundMessage(event.data)) {
        return;
      }

      var jsonRaw = normalizeHostPostMessageData(event.data);
      if (!jsonRaw) {
        return;
      }

      console.log('[PlatformBridge.index] postMessage received:', jsonRaw);
      window.sendJsonToGame(jsonRaw);
    } catch (error) {
      console.warn('[PlatformBridge.index] postMessage failed:', error);
    }
  }

  if (enableWindowMessageBridge) {
    window.addEventListener('message', handlePlatformMessage, false);
  }

  notifyHostLifecycle('game_load');
  setMainProgramProgress(0);
  observeMainProgramResources();
})();
