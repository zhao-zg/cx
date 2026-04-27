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
  var _skipNextDispatch = false;  // 用于跳过 ghost history 条目的 hashchange dispatch

  function getPath() {
    var h = win.location.hash || '#/';
    // strip leading '#/'
    return h.replace(/^#\/?/, '');
  }

  function dispatch(path) {
    var parts = path.split('/').filter(Boolean);
    // 记录当前路由路径，供 nav-stack.js 返回键处理读取（popstate 后 hash 已改变，需此值定位来源页）
    win.__cxCurrentPath = path;
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
    if (_skipNextDispatch) {
      _skipNextDispatch = false;
      console.log('[Router] hashchange skipped (ghost entry)');
      return;
    }
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
        return;
      }
      // 判断是否为同一章节内的视图切换（cx↔cv↔h↔ts↔sg↔zs）
      // 视图切换：replaceState 替换当前历史条目，不新增条目，
      //   避免返回键需逐一回放每个视图标签（与 APK backButton 行为一致）
      // 跨层级跳转（home↔批次↔章节）：location.hash 新增历史条目，
      //   确保返回键可逐级退回
      var curParts = (win.__cxCurrentPath || '').split('/').filter(Boolean);
      var newParts = (hashPath || '').split('/').filter(Boolean);
      var isSameChapterViewSwitch = (
        curParts.length === 3 && newParts.length === 3 &&
        curParts[0] === newParts[0] && curParts[1] === newParts[1]
      );
      if (isSameChapterViewSwitch) {
        // 同章节视图切换：replaceState 不触发 popstate / hashchange，需手动 dispatch
        try { win.history.replaceState(null, '', win.location.pathname + newHash); } catch(e) {}
        dispatch(hashPath || '');
      } else {
        // 跨层级跳转：Android Chrome PWA 在 location.hash 赋值时会触发虚假 popstate，
        // 先 skipNext() 让 backStack 忽略它；hashchange 会自动触发 dispatch
        if (win.CX && win.CX.backStack && win.CX.backStack.skipNext) win.CX.backStack.skipNext();
        win.location.hash = newHash;
      }
    },

    back: function () {
      win.history.back();
    },

    // 让下一次 hashchange 不触发 dispatch（用于跳过 ghost replaceState 条目）
    skipNextDispatch: function() { _skipNextDispatch = true; },

    currentPath: function () {
      return getPath();
    }
  };

  win.CXRouter = Router;

}(window));
