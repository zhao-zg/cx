/*!
 * router.js — SPA hash 路由
 * Hash 格式：
 *   #/            → 首页（训练列表）
 *   #/{path}      → 批次目录（章节列表）
 *   #/{path}/{n}/{view}  → 章节视图（cv/cx/h/ts/sg/zs）
 *
 * 暴露：window.CXRouter
 *   .start()
 *   .navigate(hashPath)   e.g. navigate('2025-04') or navigate('2025-04/1/cx')
 *   .back()
 */
(function (win) {
  'use strict';

  var _started = false;

  function getPath() {
    var h = win.location.hash || '#/';
    // strip leading '#/'
    return h.replace(/^#\/?/, '');
  }

  function dispatch(path) {
    var parts = path.split('/').filter(Boolean);
    var R = win.CXRenderer;
    console.log('[Router] dispatch path="' + path + '" parts=' + JSON.stringify(parts) + ' CXRenderer=' + (R ? 'ok' : 'NULL'));
    if (!R) { console.warn('[Router] CXRenderer 未就绪，dispatch 中止'); return; }
    win.scrollTo(0, 0);
    if (parts.length === 0) {
      R.renderHome();
    } else if (parts.length === 1) {
      R.renderBatchIndex(parts[0]);
    } else if (parts.length === 2 && parts[1] === 'motto') {
      R.renderMotto(parts[0]);
    } else if (parts.length === 2 && parts[1] === 'motto_song') {
      R.renderMottoSong(parts[0]);
    } else if (parts.length >= 3) {
      R.renderChapterView(parts[0], parseInt(parts[1], 10), parts[2]);
    } else {
      R.renderHome();
    }
  }

  function onHashChange() {
    // 若正在执行 PWA 退出（history.back），忽略本次 hash 变化，避免路由重渲染
    console.log('[Router] hashchange hash="' + win.location.hash + '" __cxExiting=' + !!win.__cxExiting);
    if (win.__cxExiting) return;
    dispatch(getPath());
  }

  var Router = {
    start: function () {
      if (_started) return;
      _started = true;
      win.addEventListener('hashchange', onHashChange);
      console.log('[Router] start() initialHash="' + win.location.hash + '"');
      dispatch(getPath());
    },

    navigate: function (hashPath) {
      // 用户主动导航，清除退出标记（防止 exit 流程误阻断后续导航）
      win.__cxExiting = false;
      var newHash = '#/' + (hashPath || '');
      console.log('[Router] navigate("' + hashPath + '") curHash="' + win.location.hash + '" → newHash="' + newHash + '"');
      if (win.location.hash === newHash) {
        // same hash — force re-dispatch (e.g. return to home from home)
        dispatch(hashPath || '');
      } else {
        // Android Chrome PWA 在 location.hash 赋值时会错误触发 popstate，
        // 导致 backStack fallback 把刚导航的页面当成"需要返回"。
        // 先调 skipNext() 让 backStack 忽略下一次 popstate。
        if (win.CX && win.CX.backStack && win.CX.backStack.skipNext) win.CX.backStack.skipNext();
        win.location.hash = newHash;
      }
    },

    back: function () {
      win.history.back();
    },

    currentPath: function () {
      return getPath();
    }
  };

  win.CXRouter = Router;

}(window));
