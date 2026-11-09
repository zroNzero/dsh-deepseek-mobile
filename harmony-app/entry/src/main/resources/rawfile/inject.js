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

  function visibleBox(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    var style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.01;
  }

  function hideStuckSidebarMask() {
    var drawer = document.querySelector('[data-sidebar-drawer]');
    var open = false;
    if (drawer) {
      var rect = drawer.getBoundingClientRect();
      open = rect.width > 4 && rect.right > 8 && rect.left < window.innerWidth - 8 && visibleBox(drawer);
    }
    if (open) return;
    var masks = document.querySelectorAll('[data-sidebar-mask]');
    for (var i = 0; i < masks.length; i += 1) masks[i].remove();
  }

  function hasVisibleDialog() {
    var dialogs = document.querySelectorAll('[role="dialog"],[aria-modal="true"]');
    for (var i = 0; i < dialogs.length; i += 1) {
      if (visibleBox(dialogs[i])) return true;
    }
    return false;
  }

  function rgbaAlpha(value) {
    var match = /rgba?\(([^)]+)\)/.exec(value || '');
    if (!match) return 1;
    var parts = match[1].split(',');
    return parts.length >= 4 ? Number(parts[3]) : 1;
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
      var alpha = rgbaAlpha(style.backgroundColor);
      var blurred = style.backdropFilter && style.backdropFilter !== 'none';
      if (!blurred && alpha >= 0.95) continue;
      if (alpha <= 0.05 && !blurred) continue;
      if (style.backgroundColor === 'rgb(255, 255, 255)' || style.backgroundColor === 'rgb(0, 0, 0)') continue;
      el.style.display = 'none';
    }
  }

  setInterval(hideStuckSidebarMask, 1200);
  setInterval(hideStuckVeil, 1800);
  setTimeout(hideStuckSidebarMask, 300);
  setTimeout(hideStuckVeil, 600);

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
    return {
      r: Number(parts[0]),
      g: Number(parts[1]),
      b: Number(parts[2]),
      a: parts.length >= 4 ? Number(parts[3]) : 1
    };
  }

  function effectiveBackground(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      var color = parseRgb(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0.5) return color;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function applyInputTheme() {
    var fields = document.querySelectorAll('textarea,input,[contenteditable="true"]');
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      var bg = effectiveBackground(field);
      var dark = (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255 < 0.5;
      var color = dark ? '#f5f5f5' : '#111111';
      field.style.setProperty('color', color, 'important');
      field.style.setProperty('-webkit-text-fill-color', color, 'important');
      field.style.setProperty('caret-color', color, 'important');
    }
  }

  setInterval(applyInputTheme, 900);
  document.addEventListener('focusin', applyInputTheme, true);

  function closeLocalPluginModal() {
    var modal = document.getElementById('ds-local-plugin-modal');
    if (modal) modal.style.display = 'none';
  }

  function openLocalPluginModal() {
    var modal = document.getElementById('ds-local-plugin-modal');
    if (modal) {
      modal.style.display = 'flex';
      var existing = document.getElementById('ds-local-plugin-spec');
      if (existing) existing.focus();
      return;
    }

    if (!document.getElementById('ds-local-plugin-style')) {
      var style = document.createElement('style');
      style.id = 'ds-local-plugin-style';
      style.textContent = [
        '#ds-local-plugin-modal{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.42);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box}',
        '#ds-local-plugin-modal .ds-lp-panel{width:min(520px,100%);max-height:85vh;overflow:auto;border-radius:16px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:0 18px 60px rgba(0,0,0,.28);padding:20px;box-sizing:border-box;font-family:inherit}',
        '#ds-local-plugin-modal .ds-lp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:18px;font-weight:600}',
        '#ds-local-plugin-modal .ds-lp-close{border:0;background:transparent;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:2px 8px}',
        '#ds-local-plugin-modal .ds-lp-desc{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary,#666);margin:10px 0 14px}',
        '#ds-local-plugin-modal .ds-lp-input{width:100%;box-sizing:border-box;height:44px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#ddd);background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#111);padding:0 12px;font-size:14px;margin:6px 0}',
        '#ds-local-plugin-modal .ds-lp-actions{display:flex;gap:10px;margin-top:14px}',
        '#ds-local-plugin-modal .ds-lp-install{flex:1;height:44px;border:0;border-radius:10px;background:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:15px;font-weight:500;cursor:pointer}',
        '#ds-local-plugin-modal .ds-lp-install:disabled{opacity:.6}',
        '#ds-local-plugin-modal .ds-lp-status{font-size:13px;line-height:1.6;white-space:pre-wrap;margin-top:12px;color:var(--dsw-alias-label-secondary,#666)}',
        '#ds-local-plugin-modal .ds-lp-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#888);margin-top:10px}'
      ].join('\n');
      document.head.appendChild(style);
    }

    modal = document.createElement('div');
    modal.id = 'ds-local-plugin-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('data-shell-overlay', '1');
    modal.innerHTML = '<div class="ds-lp-panel">' +
      '<div class="ds-lp-head"><span>添加插件</span><button type="button" class="ds-lp-close" aria-label="关闭">×</button></div>' +
            '<input id="ds-local-plugin-spec" class="ds-lp-input" placeholder="包名 / GitHub" autocomplete="off">' +
      '<input id="ds-local-plugin-ref" class="ds-lp-input" placeholder="分支 / 版本" autocomplete="off">' +
      '<div class="ds-lp-actions"><button type="button" class="ds-lp-install">安装</button></div>' +
      '<div class="ds-lp-status"></div>' +
      '<div class="ds-lp-hint">需无依赖</div>' +
      '</div>';
    document.body.appendChild(modal);

    var close = modal.querySelector('.ds-lp-close');
    var install = modal.querySelector('.ds-lp-install');
    var specInput = modal.querySelector('#ds-local-plugin-spec');
    var refInput = modal.querySelector('#ds-local-plugin-ref');
    var status = modal.querySelector('.ds-lp-status');

    close.addEventListener('click', closeLocalPluginModal);
    modal.addEventListener('click', function (event) {
      if (event.target === modal) closeLocalPluginModal();
    });
    install.addEventListener('click', function () {
      var spec = specInput.value.trim();
      if (!spec) { status.textContent = '参数缺失'; return; }
      install.disabled = true;
      install.textContent = '安装中';
      status.textContent = '安装中';
      fetch('/cloud-github/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: spec, ref: refInput.value.trim() || undefined })
      }).then(function (response) {
        return response.json();
      }).then(function (data) {
        if (data.ok) {
          status.textContent = '已安装';
          install.textContent = '完成';
          install.disabled = false;
          install.addEventListener('click', closeLocalPluginModal, { once: true });
        } else {
          status.textContent = '安装失败';
          install.textContent = '重试';
          install.disabled = false;
        }
      }).catch(function (error) {
        status.textContent = '安装失败';
        install.textContent = '重试';
        install.disabled = false;
      });
    });
    specInput.focus();
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    var button = target && target.closest ? target.closest('button[aria-label]') : null;
    if (!button) return;
    var label = String(button.getAttribute('aria-label') || '').trim().toLowerCase();
    if (label.indexOf('添加插件') >= 0 || label.indexOf('选择添加插件方式') >= 0 || label.indexOf('add plugin') >= 0 || label.indexOf('choose add method') >= 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openLocalPluginModal();
    }
  }, true);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeLocalPluginModal();
  }, true);
  dedupeMasks();
  setTimeout(dedupeMasks, 1500);
  setTimeout(dedupeMasks, 4000);

  window.__DSH_INJECT_META__ = { mobile: mq.matches, at: Date.now() };
  document.dispatchEvent(new CustomEvent('ds:injected'));
})();
