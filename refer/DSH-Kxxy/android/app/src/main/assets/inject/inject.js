(function () {
  'use strict';
  if (window.__DSH_MOBILE_SHELL__) return;
  window.__DSH_MOBILE_SHELL__ = true;

  var mq = window.matchMedia('(max-width: 767px)');

  function markViewport() {
    document.documentElement.setAttribute('data-ds-mobile', mq.matches ? '1' : '0');
  }
  markViewport();
  if (mq.addEventListener) mq.addEventListener('change', markViewport);
  else if (mq.addListener) mq.addListener(markViewport);

  function dedupeMasks() {
    var masks = document.querySelectorAll('[data-sidebar-mask]');
    for (var i = 1; i < masks.length; i += 1) masks[i].remove();
  }

  function drawerOpen() {
    var mask = document.querySelector('[data-sidebar-mask]');
    if (!mask) return false;
    return getComputedStyle(mask).pointerEvents !== 'none';
  }

  function clickFirst(selector) {
    var el = document.querySelector(selector);
    if (!el) return false;
    el.click();
    return true;
  }

  // Edge swipe: swipe right from the left edge opens the native drawer; swipe
  // left while it is open closes it through the host's own mask. The drawer
  // itself, its animation, and its contents stay entirely native.
  var tracking = null;
  var startX = 0;
  var startY = 0;

  document.addEventListener('touchstart', function (event) {
    dedupeMasks();
    if (event.touches.length !== 1) { tracking = null; return; }
    var touch = event.touches[0];
    var open = drawerOpen();
    if (!open && touch.clientX <= 28) {
      tracking = 'open';
      startX = touch.clientX;
      startY = touch.clientY;
    } else if (open && touch.clientX > 28) {
      tracking = 'close';
      startX = touch.clientX;
      startY = touch.clientY;
    } else {
      tracking = null;
    }
  }, { passive: true, capture: true });

  document.addEventListener('touchend', function (event) {
    if (!tracking) return;
    var touch = event.changedTouches[0];
    var dx = touch.clientX - startX;
    var dy = Math.abs(touch.clientY - startY);
    if (tracking === 'open' && dx > 60 && dy < 50) {
      clickFirst('[data-sidebar-toggle]');
    } else if (tracking === 'close' && dx < -50 && dy < 50) {
      clickFirst('[data-sidebar-mask]');
    }
    tracking = null;
  }, { passive: true, capture: true });

  // Hardware back: close overlays first, then the native drawer, then let the
  // host's own route handling run (MainActivity calls handleAndroidBack()).
  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    var style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.01;
  }

  window.handleAndroidBack = function () {
    var overlays = document.querySelectorAll('[role="dialog"],[aria-modal="true"],[data-shell-overlay]');
    for (var i = overlays.length - 1; i >= 0; i -= 1) {
      if (!isVisible(overlays[i])) continue;
      overlays[i].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      return true;
    }
    if (drawerOpen()) {
      clickFirst('[data-sidebar-mask]');
      return true;
    }
    return false;
  };

  function parseRgb(value) {
    var match = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!match) return null;
    var parts = match[1].split(',');
    return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]), a: parts.length >= 4 ? Number(parts[3]) : 1 };
  }

  function applyInputTheme() {
    var fields = document.querySelectorAll('textarea,input,[contenteditable="true"]');
    for (var i = 0; i < fields.length; i += 1) {
      var node = fields[i];
      var bg = null;
      while (node && node !== document.documentElement) {
        var color = parseRgb(getComputedStyle(node).backgroundColor);
        if (color && color.a > 0.5) { bg = color; break; }
        node = node.parentElement;
      }
      var dark = bg ? ((0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255 < 0.5) : false;
      var text = dark ? '#f5f5f5' : '#111111';
      fields[i].style.setProperty('color', text, 'important');
      fields[i].style.setProperty('-webkit-text-fill-color', text, 'important');
      fields[i].style.setProperty('caret-color', text, 'important');
    }
  }

  function hasVisibleDialog() {
    var dialogs = document.querySelectorAll('[role="dialog"],[aria-modal="true"]');
    for (var i = 0; i < dialogs.length; i += 1) if (isVisible(dialogs[i])) return true;
    return false;
  }

  function hideStuckVeil() {
    if (hasVisibleDialog()) return;
    var nodes = document.querySelectorAll('body *');
    for (var i = 0; i < nodes.length; i += 1) {
      var el = nodes[i];
      if (el === document.body || el === document.documentElement) continue;
      if (el.hasAttribute('role') && el.getAttribute('role') === 'dialog') continue;
      var style = getComputedStyle(el);
      if (style.position !== 'fixed' && style.position !== 'absolute') continue;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) <= 0.01) continue;
      var rect = el.getBoundingClientRect();
      if (rect.width < window.innerWidth * 0.9 || rect.height < window.innerHeight * 0.9) continue;
      var match = /rgba?\(([^)]+)\)/.exec(style.backgroundColor || '');
      var alpha = match && match[1].split(',').length >= 4 ? Number(match[1].split(',')[3]) : 1;
      var blurred = style.backdropFilter && style.backdropFilter !== 'none';
      if (!blurred && alpha >= 0.95) continue;
      if (alpha <= 0.05 && !blurred) continue;
      el.style.display = 'none';
    }
  }

  setInterval(applyInputTheme, 900);
  setInterval(hideStuckVeil, 1800);
  document.addEventListener('focusin', applyInputTheme, true);
  setTimeout(applyInputTheme, 300);
  setTimeout(hideStuckVeil, 600);

  dedupeMasks();
  setTimeout(dedupeMasks, 1500);
  setTimeout(dedupeMasks, 4000);

  window.__DSH_INJECT_META__ = { mobile: mq.matches, at: Date.now() };
  document.dispatchEvent(new CustomEvent('ds:injected'));
})();
