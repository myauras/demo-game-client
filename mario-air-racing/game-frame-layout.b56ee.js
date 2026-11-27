(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AuraGameFrameLayout = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var DESIGN_WIDTH = 1179;
  var DESIGN_HEIGHT = 1977;
  var MINIMUM_FLUID_HEIGHT = 1400;
  var MODE_FLUID = 'fluid';
  var MODE_STANDALONE_DESKTOP = 'standalone-desktop';

  function toPositiveSize(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 1;
  }

  function readMeasuredSize(primary, fallback) {
    var primaryNumber = Number(primary);
    if (Number.isFinite(primaryNumber) && primaryNumber > 0) return primaryNumber;
    var fallbackNumber = Number(fallback);
    return Number.isFinite(fallbackNumber) && fallbackNumber > 0 ? fallbackNumber : 0;
  }

  function calculateFrameLayout(input) {
    var availableWidth = toPositiveSize(input && input.availableWidth);
    var availableHeight = toPositiveSize(input && input.availableHeight);
    var mode = input && input.mode === MODE_STANDALONE_DESKTOP
      ? MODE_STANDALONE_DESKTOP
      : MODE_FLUID;
    var width;
    var height;

    if (mode === MODE_STANDALONE_DESKTOP) {
      var scale = Math.min(
        1,
        availableWidth / DESIGN_WIDTH,
        availableHeight / DESIGN_HEIGHT
      );
      width = DESIGN_WIDTH * scale;
      height = DESIGN_HEIGHT * scale;
    } else {
      width = availableWidth;
      height = availableHeight;
      var minimumAspect = MINIMUM_FLUID_HEIGHT / DESIGN_WIDTH;
      if (height / width < minimumAspect) {
        width = height / minimumAspect;
      }
    }

    return {
      mode: mode,
      width: width,
      height: height,
      left: (availableWidth - width) / 2,
      top: (availableHeight - height) / 2,
    };
  }

  function getQueryValue(search, name) {
    var source = String(search || '').replace(/^\?/, '').split('&');
    for (var index = 0; index < source.length; index += 1) {
      var pair = source[index].split('=');
      if (decodeURIComponent(pair[0] || '') === name) {
        return decodeURIComponent((pair[1] || '').replace(/\+/g, ' '));
      }
    }
    return '';
  }

  function isInsideIframe(target) {
    try {
      return target.self !== target.top;
    } catch (error) {
      return true;
    }
  }

  function isLikelyWebView(target) {
    var navigatorValue = target.navigator || {};
    var userAgent = String(navigatorValue.userAgent || '');
    var androidWebView = /;\s*wv\)/i.test(userAgent)
      || (/Android/i.test(userAgent) && /Version\/\d+(?:\.\d+)*\s+Chrome\//i.test(userAgent));
    var iosDevice = /iPhone|iPad|iPod/i.test(userAgent);
    var iosWebView = iosDevice && /AppleWebKit/i.test(userAgent) && !/Safari/i.test(userAgent);
    var injectedBridge = Boolean(
      target.ReactNativeWebView
      || target.Android
      || (target.webkit && target.webkit.messageHandlers)
    );
    return androidWebView || iosWebView || injectedBridge;
  }

  function isMobileDevice(target) {
    var navigatorValue = target.navigator || {};
    if (navigatorValue.userAgentData && navigatorValue.userAgentData.mobile === true) {
      return true;
    }

    var userAgent = String(navigatorValue.userAgent || '');
    if (/Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i.test(userAgent)) {
      return true;
    }

    return navigatorValue.platform === 'MacIntel' && Number(navigatorValue.maxTouchPoints) > 1;
  }

  function resolveRuntimeMode(target) {
    var layoutOverride = getQueryValue(target.location && target.location.search, 'layout').toLowerCase();
    if (['embedded', 'fluid', 'mobile', 'webview'].indexOf(layoutOverride) >= 0) {
      return MODE_FLUID;
    }
    if (['desktop', 'standalone'].indexOf(layoutOverride) >= 0) {
      return MODE_STANDALONE_DESKTOP;
    }
    if (isInsideIframe(target) || isLikelyWebView(target) || isMobileDevice(target)) {
      return MODE_FLUID;
    }
    return MODE_STANDALONE_DESKTOP;
  }

  function measureAvailableRect(target, host) {
    var hostRect = host.getBoundingClientRect();
    var left = 0;
    var top = 0;
    // A host page can temporarily collapse the game iframe/container while a
    // deposit page is visible. Zero is not a real viewport and must never
    // overwrite the last good frame with a persistent 1x1 layout.
    var width = readMeasuredSize(host.clientWidth, hostRect.width);
    var height = readMeasuredSize(host.clientHeight, hostRect.height);
    var visualViewport = target.visualViewport;
    // GameViewport already represents the host's Safe Area. After a native or
    // parent-host deposit page returns, an embedded visualViewport can retain
    // that page's vertical offset/height and incorrectly crop GameDiv again,
    // producing black bars above and below the game. Keep the gameplay root
    // fitted to the actual host in embedded/WebView builds.
    // visualViewport events are still useful resize triggers, but its rect is
    // only authoritative for a standalone browser page.
    if (!visualViewport || isInsideIframe(target) || isLikelyWebView(target)) {
      return { left: left, top: top, width: width, height: height };
    }

    var viewportLeft = Number(visualViewport.offsetLeft) || 0;
    var viewportTop = Number(visualViewport.offsetTop) || 0;
    var intersectionLeft = Math.max(hostRect.left, viewportLeft);
    var intersectionTop = Math.max(hostRect.top, viewportTop);
    var intersectionRight = Math.min(hostRect.right, viewportLeft + visualViewport.width);
    var intersectionBottom = Math.min(hostRect.bottom, viewportTop + visualViewport.height);
    if (intersectionRight > intersectionLeft && intersectionBottom > intersectionTop) {
      left = intersectionLeft - hostRect.left;
      top = intersectionTop - hostRect.top;
      width = intersectionRight - intersectionLeft;
      height = intersectionBottom - intersectionTop;
    }

    return { left: left, top: top, width: width, height: height };
  }

  function install(options) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return null;
    }

    var settings = options || {};
    var host = document.getElementById(settings.hostId || 'GameViewport');
    var frame = document.getElementById(settings.frameId || 'GameDiv');
    if (!host || !frame) {
      throw new Error('[GameFrameLayout] Missing GameViewport or GameDiv.');
    }

    var mode = settings.mode || resolveRuntimeMode(window);
    var lastSignature = '';
    var resizeObserver = null;
    var notifyScheduled = false;
    var foregroundRefreshGeneration = 0;
    var foregroundRefreshTimer = null;
    var disposed = false;

    function notifyEngineResize() {
      if (notifyScheduled) return;
      notifyScheduled = true;
      window.requestAnimationFrame(function () {
        notifyScheduled = false;
        window.dispatchEvent(new Event('resize'));
      });
    }

    function applyLayout(notifyEngine, forceNotify) {
      var available = measureAvailableRect(window, host);
      if (available.width <= 0 || available.height <= 0) return false;
      var layout = calculateFrameLayout({
        availableWidth: available.width,
        availableHeight: available.height,
        mode: mode,
      });
      var left = available.left + layout.left;
      var top = available.top + layout.top;
      var signature = [layout.mode, layout.width, layout.height, left, top].join(':');
      if (signature === lastSignature) {
        if (notifyEngine && forceNotify) notifyEngineResize();
        return true;
      }
      lastSignature = signature;

      frame.style.width = layout.width + 'px';
      frame.style.height = layout.height + 'px';
      frame.style.left = left + 'px';
      frame.style.top = top + 'px';
      frame.dataset.layoutMode = layout.mode;
      if (notifyEngine) notifyEngineResize();
      return true;
    }

    function handleWindowResize() {
      applyLayout(false);
    }

    function handleViewportResize() {
      applyLayout(true);
    }

    function refreshAfterForeground() {
      if (disposed) return;
      var generation = ++foregroundRefreshGeneration;
      if (foregroundRefreshTimer !== null && typeof window.clearTimeout === 'function') {
        window.clearTimeout(foregroundRefreshTimer);
        foregroundRefreshTimer = null;
      }

      // Notify even when the CSS frame signature did not change: after a
      // bfcache/native-page return, Cocos' backing canvas can still be stale.
      applyLayout(true, true);
      window.requestAnimationFrame(function () {
        if (disposed || generation !== foregroundRefreshGeneration) return;
        applyLayout(true, false);
        window.requestAnimationFrame(function () {
          if (disposed || generation !== foregroundRefreshGeneration) return;
          applyLayout(true, true);
        });
      });
      if (typeof window.setTimeout === 'function') {
        foregroundRefreshTimer = window.setTimeout(function () {
          foregroundRefreshTimer = null;
          if (disposed || generation !== foregroundRefreshGeneration) return;
          applyLayout(true, true);
        }, 250);
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' || document.hidden === false) {
        refreshAfterForeground();
      }
    }

    applyLayout(false);
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('orientationchange', handleViewportResize);
    window.addEventListener('pageshow', refreshAfterForeground);
    window.addEventListener('focus', refreshAfterForeground);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
      window.visualViewport.addEventListener('scroll', handleViewportResize);
    }
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(handleViewportResize);
      resizeObserver.observe(host);
    }

    return {
      mode: mode,
      refresh: refreshAfterForeground,
      dispose: function () {
        disposed = true;
        foregroundRefreshGeneration += 1;
        window.removeEventListener('resize', handleWindowResize);
        window.removeEventListener('orientationchange', handleViewportResize);
        window.removeEventListener('pageshow', refreshAfterForeground);
        window.removeEventListener('focus', refreshAfterForeground);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (window.visualViewport) {
          window.visualViewport.removeEventListener('resize', handleViewportResize);
          window.visualViewport.removeEventListener('scroll', handleViewportResize);
        }
        if (resizeObserver) resizeObserver.disconnect();
        if (foregroundRefreshTimer !== null && typeof window.clearTimeout === 'function') {
          window.clearTimeout(foregroundRefreshTimer);
          foregroundRefreshTimer = null;
        }
      },
    };
  }

  return {
    DESIGN_WIDTH: DESIGN_WIDTH,
    DESIGN_HEIGHT: DESIGN_HEIGHT,
    MINIMUM_FLUID_HEIGHT: MINIMUM_FLUID_HEIGHT,
    MODE_FLUID: MODE_FLUID,
    MODE_STANDALONE_DESKTOP: MODE_STANDALONE_DESKTOP,
    calculateFrameLayout: calculateFrameLayout,
    resolveRuntimeMode: resolveRuntimeMode,
    install: install,
  };
});
