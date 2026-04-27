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
    if (!R) return;
    console.log('[Router] dispatch:', path, 'parts:', parts.length, new Error().stack.split('\n').slice(1,4).join(' | '));
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
    dispatch(getPath());
  }

  var Router = {
    start: function () {
      if (_started) return;
      _started = true;
      win.addEventListener('hashchange', onHashChange);
      dispatch(getPath());
    },

    navigate: function (hashPath) {
      var newHash = '#/' + (hashPath || '');
      if (win.location.hash === newHash) {
        // same hash — force re-dispatch (e.g. return to home from home)
        dispatch(hashPath || '');
      } else {
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
