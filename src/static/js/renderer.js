/*!
 * renderer.js — SPA JSON→HTML 渲染器
 *
 * 从 training.json 渲染各视图，DOM/class/id 与旧静态模板完全一致，
 * 确保 speech.js / outline.js / scripture-popup.js / highlight.js 等选择器全部兼容。
 *
 * 暴露：window.CXRenderer
 *   .renderHome()
 *   .renderBatchIndex(batchPath)
 *   .renderChapterView(batchPath, chapterNum, viewType)
 *   .renderMotto(batchPath)
 *   .renderMottoSong(batchPath)
 */
(function (win) {
  'use strict';

  // ── 工具 ────────────────────────────────────────────────────────────────

  function escAttr(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function escText(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function wrapRefs(text, ctx) {
    return win.CXRef ? win.CXRef.wrapRefs(text, ctx||'') : escText(text);
  }

  // 把读经横幅文本（如 "徒六4，犹20，可十一20~24"）整体包成可点击的 scripture-ref。
  // 优先使用 CXRef.expandCnRefs 展开 → data-refs；若无则回退 fallbackRefs（已为逗号分隔的引用键）。
  function buildScriptureBanner(displayText, fallbackRefs) {
    if (!displayText) return '';
    var refs = '';
    if (win.CXRef && win.CXRef.expandCnRefs) {
      try { refs = (win.CXRef.expandCnRefs(displayText, '', 0) || []).join(','); } catch(e) {}
    }
    if (!refs && fallbackRefs) refs = fallbackRefs;
    if (refs) {
      return '<span class="scripture-ref" data-refs="' + escAttr(refs) + '">' + escText(displayText) + '</span>';
    }
    return escText(displayText);
  }

  // 缓存已加载的 training.json
  var _cache = {};

  // 滚动位置记忆
  var _scrollSaveTimer = null;
  var _scrollSaveHandler = null;
  var _scrollPageKey = null;  // 当前页面的 per-page 滚动键（cx 分页器视图除外均有）

  function loadTraining(batchPath) {
    if (_cache[batchPath]) return Promise.resolve(_cache[batchPath]);
    // 本地导入训练（LocalForage）
    if (batchPath.indexOf('local-') === 0 && win.CXLocalImport) {
      return win.CXLocalImport.getTraining(batchPath).then(function (d) {
        if (!d) throw new Error('本地训练不存在，请重新导入');
        _cache[batchPath] = d;
        setTimeout(function () {
          if (win.CXSearch && win.CXSearch._cacheTraining) win.CXSearch._cacheTraining(batchPath, d);
        }, 0);
        return d;
      });
    }
    var root = win.CX_ROOT || './';
    var isNative = !!(win.Capacitor && win.Capacitor.isNativePlatform && win.Capacitor.isNativePlatform());
    // Capacitor 原生 App 无 SW，用时间戳参数绕过 WebView HTTP 缓存，确保取到 APK 包内最新文件。
    // 注意：不使用 {cache:'reload'} ——部分 Android 机型（含华为）该选项会绕过 Capacitor
    //   的 WebView 资产拦截器，向真实网络请求 localhost 而得到 404。
    var jsonUrl = isNative
      ? root + batchPath + '/training.json?_t=' + Date.now()
      : root + batchPath + '/training.json';
    return fetch(jsonUrl)
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function(fetchErr) {
        // Capacitor 原生：fetch 失败(如 APK 未打包该训练)，尝试从 Cache Storage 兜底；
        // 这确保用户通过资源包/旧版已缓存的历史训练仍可离线打开。
        if (isNative && ('caches' in win)) {
          // 尝试多种可能的 URL 格式（绝对 URL 和相对路径，均不含时间戳）
          var cacheUrls = [
            (win.location.origin || '') + '/' + batchPath + '/training.json',
            root + batchPath + '/training.json'
          ];
          return caches.match(cacheUrls[0]).then(function(r1) {
            return r1 || caches.match(cacheUrls[1]);
          }).then(function(cachedResp) {
            if (cachedResp && cachedResp.ok) return cachedResp.json();
            throw fetchErr;
          });
        }
        throw fetchErr;
      })
      .then(function(data) {
        _cache[batchPath] = data;
        // 异步提取搜索缓存（不阻塞渲染）
        setTimeout(function() {
          if (win.CXSearch && win.CXSearch._cacheTraining) {
            win.CXSearch._cacheTraining(batchPath, data);
          }
        }, 0);
        return data;
      });
  }

  // 从经文文本中提取所有引用（与 Python 的 _extract_verse_refs 等价）
  var _BOOK_RE = /([创出利民申书士得撒王代拉尼斯伯诗箴传歌赛耶哀结但何珥摩俄拿弥鸿哈番该亚玛太可路约徒罗林加弗腓西帖提门多彼约犹启来])(?:[一二三四五六七八九十后前上下壹贰叁]\d+|\d+):\d+[上下]?/g;
  function extractRefs(text) {
    if (!text) return '';
    var m, out = [], seen = {};
    _BOOK_RE.lastIndex = 0;
    while ((m = _BOOK_RE.exec(text)) !== null) {
      var ref = m[0];
      if (!seen[ref]) { seen[ref] = 1; out.push(ref); }
    }
    return out.join(',');
  }

  // outline_level_class — 与 Python 完全一致
  var _LEVEL_1_CHARS = '壹贰叁肆伍陆柒捌玖拾';
  var _LEVEL_2_CHARS = '一二三四五六七八九十百';
  var _ROMAN = ['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
  function outlineLevelClass(s) {
    if (!s) return 'level-1';
    s = String(s).trim();
    if (!s) return 'level-1';
    var i, ok;
    ok = true; for (i=0;i<s.length;i++){ if (_LEVEL_1_CHARS.indexOf(s.charAt(i))<0){ok=false;break;} }
    if (ok) return 'level-1';
    if (_ROMAN.indexOf(s.toUpperCase()) >= 0) return 'level-1';
    if (s.length === 1 && /^[A-Z]$/.test(s)) return 'level-1';
    ok = true; for (i=0;i<s.length;i++){ if (_LEVEL_2_CHARS.indexOf(s.charAt(i))<0){ok=false;break;} }
    if (ok) return 'level-2';
    if (/^\d+$/.test(s)) return 'level-3';
    if (s.length === 1 && /^[a-z]$/.test(s)) return 'level-4';
    if ('㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩'.indexOf(s) >= 0) return 'level-5';
    return 'level-3';
  }

  // 提取星期：「第一周 • 周一」-> 「周一」
  function extractDay(s) {
    s = String(s||'');
    if (s.indexOf('•') >= 0) return s.split('•')[1].trim();
    return s;
  }

  // 当前星期对应索引（周一=0 ... 周日=6）
  function currentWeekdayIdx() {
    var d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  }

  // ── 容器与视图切换 ────────────────────────────────────────────────────

  function getApp() { return document.getElementById('app') || document.body; }

  function showApp() {
    if (win._cxShowApp) { win._cxShowApp(); return; }
    var h=document.getElementById('homeView'),a=document.getElementById('app');
    if (h) h.style.display='none';
    if (a) a.style.display='';
  }
  function showHome() {
    if (win._cxShowHome) { win._cxShowHome(); return; }
    var h=document.getElementById('homeView'),a=document.getElementById('app');
    if (h) h.style.display='';
    if (a) a.style.display='none';
    document.title = '特会信息合集';
  }

  function setMeta(training) {
    var m1 = document.querySelector('meta[name="training-title"]');
    if (m1 && training) m1.setAttribute('content', training.title || '');
    var m2 = document.querySelector('meta[name="app-version"]');
    if (m2 && training && training.app_version) m2.setAttribute('content', training.app_version);
  }

  // ── 通用片段：page_navigation + bottom-control-bar ────────────────────

  function buildBottomControlBar() {
    return '' +
      '<div class="bottom-control-bar" id="bottomControlBar" style="display:none;">' +
        '<button class="control-btn play-pause-btn" id="playPauseBtn" title="播放/暂停" aria-label="播放">' +
          '<span class="play-icon">▶</span>' +
          '<span class="pause-icon" style="display:none;">⏸</span>' +
        '</button>' +
        '<button class="control-btn loop-btn" id="loopBtn" title="循环播放" aria-label="循环播放">🔁</button>' +
        '<div class="progress-section">' +
          '<div class="progress-column">' +
            '<input type="range" id="progressBar" class="progress-bar" min="0" max="100" value="0" step="0.1">' +
            '<span class="speech-time" id="speechTime">00:00 / 00:00</span>' +
          '</div>' +
          '<select id="rateSelect" class="control-select" title="语速">' +
            '<option value="0.5">0.5x</option>' +
            '<option value="0.75">0.75x</option>' +
            '<option value="1" selected>1x</option>' +
            '<option value="1.25">1.25x</option>' +
            '<option value="1.5">1.5x</option>' +
            '<option value="2">2x</option>' +
          '</select>' +
        '</div>' +
      '</div>';
  }

  function buildPageNavigation(batchPath, chapter, activeView, training) {
    var num = chapter.number;
    // 面包屑
    var trainingTitle = training && training.title ? training.title : '';
    function link(view, label) {
      var act = (view === activeView || (view === 'h' && activeView === 'ts')) ? ' active' : '';
      return '<a href="javascript:void(0)" class="nav-link' + act + '" title="' + label + '" onclick="CXRouter.navigate(\'' +
        escAttr(batchPath) + '/' + num + '/' + view + '\')">' + label + '</a>';
    }
    var html = '<div class="page-navigation">';
    html += '<a href="javascript:void(0)" class="nav-link" title="返回目录" onclick="CXRouter.navigate(\'' + escAttr(batchPath) + '\')">返回</a>';
    html += link('cv', '纲目');
    if ((chapter.message_content && chapter.message_content.length > 0) || chapter.has_listen_block) {
      html += link('h', '听抄');
    }
    if (chapter.morning_revivals && chapter.morning_revivals.length > 0) {
      html += link('cx', '晨读');
    }
    if (chapter.hymn_number && String(chapter.hymn_number).trim()) {
      html += link('sg', '诗歌');
    }
    if (chapter.ministry_excerpt && String(chapter.ministry_excerpt).trim()) {
      html += link('zs', '职事');
    }
    html += '<button type="button" id="cx-search-btn" class="nav-link" title="搜索">🔍</button>';
    html += '</div>';
    html += buildBottomControlBar();
    return html;
  }

  function buildChapterHeader(chapter) {
    return '<div class="header header--chapter">' +
      '<h2 class="chapter-title">第' + chapter.number + '篇 ' + escText(chapter.title) + '</h2>' +
      '</div>';
  }

  function buildFooter(training) {
    if (!training) return '';
    return '<div class="footer"><p>' + escText(training.year + '-' + training.season) + '</p></div>';
  }

  // ── 纲目递归（cv 视图 + 晨读 outline）─────────────────────────────────

  /* ctx-box：用可变对象在递归渲染中传播上下文，避免父节点识别出的书卷/章无法传给子节点 */
  function toCtxBox(ctx) {
    if (ctx && typeof ctx === 'object' && 'val' in ctx) return ctx; // 已是 box
    return { val: (typeof ctx === 'string' ? ctx : '') };
  }
  function scanCtxBox(text, box) {
    if (!win.CXRef || !win.CXRef.scanCtx) return;
    var next = win.CXRef.scanCtx(text, box.val);
    if (next) box.val = next;
  }

  function renderOutlineSection(sec, depth, parentId, defaultCollapsed, idPrefix, ctx) {
    parentId = parentId || '';
    idPrefix = idPrefix || '';
    var box = toCtxBox(ctx);
    var sectionId = idPrefix + (parentId ? (parentId + '-' + sec.level) : sec.level);
    var hasChildren = sec.children && sec.children.length > 0;
    var lvCls = outlineLevelClass(sec.level);
    var titleKey = sec.level + '\u3000' + sec.title;
    // 若有子节点：前缀单独渲染为可点击 span，标题用 wrapRefs
    var titleHtml;
    if (hasChildren) {
      var subId = 'subsection-' + sectionId;
      titleHtml = '<span class="outline-lvl-toggle' + (defaultCollapsed ? '' : ' expanded') +
        '" data-toggle-for="' + escAttr(subId) + '" onclick="toggleSection(\'' + escAttr(subId) + '\')">' +
        escText(sec.level) + '</span>\u3000' + wrapRefs(sec.title, box.val);
    } else {
      titleHtml = wrapRefs(titleKey, box.val);
    }
    scanCtxBox(titleKey, box);

    var html = '<div class="section" id="section-' + escAttr(sectionId) + '" data-level="' + depth + '">';
    html += '<div class="outline-item ' + lvCls + '">';
    html += titleHtml;
    html += '</div>';
    if (sec.content && sec.content.length) {
      html += '<div class="outline-node-content">';
      for (var ci = 0; ci < sec.content.length; ci++) {
        html += '<div class="outline-content-text">' + wrapRefs(sec.content[ci], box.val) + '</div>';
        scanCtxBox(sec.content[ci], box);
      }
      html += '</div>';
    }

    if (hasChildren) {
      var disp = defaultCollapsed ? 'none' : 'block';
      html += '<div class="subsections" id="subsection-' + escAttr(sectionId) +
              '" data-parent-level="' + depth + '" style="display: ' + disp + ';">';
      for (var i = 0; i < sec.children.length; i++) {
        html += renderOutlineSection(sec.children[i], depth + 1, sectionId, defaultCollapsed, '', box);
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── 听抄递归（h 视图）— 与 message.html macro 一致 ─────────────────

  function renderMessageSection(sec, depth, ctx) {
    var box = toCtxBox(ctx);
    var html = '<div class="section">';
    var titleKey = sec.level + '\u3000' + sec.title;
    html += '<div class="section-level' + depth + '">' + wrapRefs(titleKey, box.val) + '</div>';
    scanCtxBox(titleKey, box);
    if (sec.content && sec.content.length) {
      html += '<div class="section-content">';
      for (var i = 0; i < sec.content.length; i++) {
        html += '<p class="content-text">' + wrapRefs(sec.content[i], box.val) + '</p>';
        scanCtxBox(sec.content[i], box);
      }
      html += '</div>';
    }
    if (sec.children && sec.children.length) {
      html += '<div class="subsections">';
      for (var ci = 0; ci < sec.children.length; ci++) {
        html += renderMessageSection(sec.children[ci], depth + 1, box);
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // ── 详情递归（ts 视图）— 与 details.html macro 一致 ──────────────

  function renderDetailSection(sec, ctx) {
    var box = toCtxBox(ctx);
    var levelLen = (sec.level || '').length;
    var levelN = levelLen <= 4 ? levelLen : 4;
    if (levelN === 0) levelN = 1;
    var html = '<div class="section" id="section-' + escAttr(sec.level || '') + '">';
    if (sec.level || sec.title) {
      var titleKey = sec.level + '\u3000' + sec.title;
      html += '<div class="section-level' + levelN + '">' + wrapRefs(titleKey, box.val) + '</div>';
      scanCtxBox(titleKey, box);
    }
    if (sec.content && sec.content.length) {
      for (var i = 0; i < sec.content.length; i++) {
        html += '<div class="content-text">' + wrapRefs(sec.content[i], box.val) + '</div>';
        scanCtxBox(sec.content[i], box);
      }
    }
    if (sec.children && sec.children.length) {
      for (var ci = 0; ci < sec.children.length; ci++) {
        html += renderDetailSection(sec.children[ci], box);
      }
    }
    html += '</div>';
    return html;
  }

  // ── 视图: cv（纲目）────────────────────────────────────────────────────

  function renderCv(batchPath, chapter, training) {
    var nav = buildPageNavigation(batchPath, chapter, 'cv', training);
    var header = buildChapterHeader(chapter);

    var scriptureBlock = '';
    if (chapter.scripture) {
      var inner = buildScriptureBanner(chapter.scripture, chapter.scripture_verses);
      scriptureBlock = '<div class="scripture-section"><div class="scripture">读经：' + inner + '</div></div>';
    }

    var controls = '<div class="outline-level-controls">' +
      '<button class="level-btn" onclick="expandToLevel(1)" title="只显示大纲（一级）">大纲</button>' +
      '<button class="level-btn" onclick="expandToLevel(2)" title="显示大纲和中纲（一二级）">大中纲</button>' +
      '<button class="level-btn active" onclick="expandToLevel(4)" title="显示全部内容">全部</button>' +
      '</div>';

    var sections = '';
    var secs = chapter.outline_sections || [];
    var ctxBox = {val: chapter.scripture || ''};
    for (var i = 0; i < secs.length; i++) {
      sections += renderOutlineSection(secs[i], 1, '', false, '', ctxBox);
    }

    var html = '<div class="container">' +
      header +
      '<div class="content"><div class="outline-page">' +
      nav + scriptureBlock + controls +
      '<div class="outline-content">' + sections + '</div>' +
      '</div></div>' +
      buildFooter(training) +
      '</div>';

    setContent(html, 'cv', batchPath, chapter, training);
  }

  // ── 视图: h（听抄）────────────────────────────────────────────────────

  function renderH(batchPath, chapter, training) {
    // 无听抄内容时跳转 cv：
    // TXT 导入路径用 has_listen_block 判断（即使 pre 为空、message_content=[]，detail_sections 仍可有正文）
    // Python 路径直接依赖 message_content 非空
    var hasContent = (chapter.message_content && chapter.message_content.length) || chapter.has_listen_block;
    if (!hasContent) {
      if (win.CXRouter) win.CXRouter.navigateReplace(batchPath + '/' + chapter.number + '/cv');
      return;
    }
    var nav = buildPageNavigation(batchPath, chapter, 'h', training);
    var header = buildChapterHeader(chapter);

    var scriptureBlock = '';
    if (chapter.scripture) {
      var inner = buildScriptureBanner(chapter.scripture, chapter.scripture_verses);
      scriptureBlock = '<div class="scripture-section"><div class="scripture">读经：' + inner + '</div></div>';
    }

    var content = '';
    var msgs = chapter.message_content || [];
    var msgCtxBox = {val: chapter.scripture || ''};
    for (var mi = 0; mi < msgs.length; mi++) {
      content += '<p class="content-text">' + wrapRefs(msgs[mi], msgCtxBox.val) + '</p>';
      scanCtxBox(msgs[mi], msgCtxBox);
    }
    var detailSecs = chapter.detail_sections || [];
    for (var di = 0; di < detailSecs.length; di++) {
      content += renderMessageSection(detailSecs[di], 1, msgCtxBox.val);
    }

    var html = '<div class="container">' +
      header +
      '<div class="content"><div class="message-page">' +
      nav + scriptureBlock +
      '<div class="message-content">' + content + '</div>' +
      '</div></div>' +
      buildFooter(training) +
      '</div>';

    setContent(html, 'h', batchPath, chapter, training);
  }

  // ── 视图: ts（详情）────────────────────────────────────────────────────

  function renderTs(batchPath, chapter, training) {
    var nav = buildPageNavigation(batchPath, chapter, 'ts', training);
    var header = buildChapterHeader(chapter);
    var scriptureBlock = chapter.scripture
      ? '<div class="scripture">读经：' + buildScriptureBanner(chapter.scripture, chapter.scripture_verses) + '</div>'
      : '';

    var content = '';
    var secs = chapter.detail_sections || [];
    var tsCtxBox = {val: chapter.scripture || ''};
    for (var i = 0; i < secs.length; i++) {
      content += renderDetailSection(secs[i], tsCtxBox);
    }

    var html = '<div class="container">' +
      header +
      '<div class="content"><div class="details-page">' +
      nav + scriptureBlock +
      '<div class="details-content">' + content + '</div>' +
      '</div></div>' +
      buildFooter(training) +
      '</div>';

    setContent(html, 'ts', batchPath, chapter, training);
  }

  // ── 视图: sg（诗歌）────────────────────────────────────────────────────

  function renderSg(batchPath, chapter, training) {
    var nav = buildPageNavigation(batchPath, chapter, 'sg', training);
    var header = buildChapterHeader(chapter);
    var root = win.CX_ROOT || './';

    var inner = '';
    if (chapter.hymn_number) {
      inner = '<div class="hymn-info">' +
        '<h3>诗歌</h3>' +
        '<p class="hymn-number-display">' + escText(chapter.hymn_number) + '</p>';

      // 支持多图（hymn_images 优先，向后兼容 hymn_image）
      var images = (chapter.hymn_images && chapter.hymn_images.length)
        ? chapter.hymn_images
        : (chapter.hymn_image ? [chapter.hymn_image] : []);

      if (images.length > 1) {
        // 多图：直接上下堆叠显示
        inner += '<div class="hymn-images-stack">';
        for (var i = 0; i < images.length; i++) {
          var imgUrl = root + escAttr(batchPath) + '/' + escAttr(images[i]);
          var allUrls = images.map(function(p) { return escAttr(JSON.stringify(root + batchPath + '/' + p)); }).join(',');
          inner += '<div class="hymn-image">' +
            '<img src="' + imgUrl + '" alt="诗歌第' + (i + 1) + '页" class="hymn-img-clickable"' +
            ' onclick="window.openImageViewer&&openImageViewer(this.src,[' + allUrls + '],' + i + ')">' +
            '</div>';
        }
        inner += '<p class="click-hint">👆 点击图片放大查看</p>';
        inner += '</div>';
      } else if (images.length === 1) {
        var imgUrl = root + escAttr(batchPath) + '/' + escAttr(images[0]);
        inner += '<div class="hymn-image">' +
          '<img src="' + imgUrl + '" alt="诗歌内容" class="hymn-img-clickable" onclick="window.openImageViewer&&openImageViewer(this.src)">' +
          '<p class="click-hint">👆 点击图片放大查看</p>' +
          '</div>';
      }
      inner += '</div>';
    } else {
      inner = '<p class="no-content">暂无诗歌信息</p>';
    }
    inner += '<div class="hymn-note"><p>💡 本诗歌在原始文档中以图片格式存储，完整内容请查阅相应的诗歌本</p></div>';

    var html = '<div class="container">' +
      header +
      '<div class="content"><div class="hymn-page">' + nav + inner + '</div></div>' +
      buildFooter(training) +
      '</div>';

    setContent(html, 'sg', batchPath, chapter, training);
  }

  // ── 视图: zs（职事信息摘录）─ 按 \n\n 分段 ─────────────────────────

  function renderZs(batchPath, chapter, training) {
    var nav = buildPageNavigation(batchPath, chapter, 'zs', training);
    var header = buildChapterHeader(chapter);
    var scriptureBlock = chapter.scripture
      ? '<div class="scripture">读经：' + buildScriptureBanner(chapter.scripture, chapter.scripture_verses) + '</div>'
      : '';

    var content = '';
    var excerpt = chapter.ministry_excerpt || '';
    if (excerpt) {
      var paragraphs = excerpt.split(/\n\s*\n/);
      for (var i = 0; i < paragraphs.length; i++) {
        var p = paragraphs[i].trim();
        if (!p) continue;
        if (p.length < 30 && p.indexOf('\n') < 0) {
          content += '<h3 class="ministry-subtitle">' + escText(p) + '</h3>';
        } else {
          content += '<p class="content-text">' + wrapRefs(p, chapter.scripture) + '</p>';
        }
      }
    } else {
      content = '<p class="no-content">暂无职事信息摘录</p>';
    }

    var html = '<div class="container">' +
      header +
      '<div class="content"><div class="ministry-page">' +
      nav + scriptureBlock +
      '<div class="ministry-content">' + content + '</div>' +
      '</div></div>' +
      buildFooter(training) +
      '</div>';

    setContent(html, 'zs', batchPath, chapter, training);
  }

  // ── 视图: cx（晨读）────────────────────────────────────────────────────

  function renderCx(batchPath, chapter, training) {
    var nav = buildPageNavigation(batchPath, chapter, 'cx', training);
    var header = buildChapterHeader(chapter);
    var revivals = chapter.morning_revivals || [];

    if (!revivals.length) {
      if (win.CXRouter) win.CXRouter.navigateReplace(batchPath + '/' + chapter.number + '/cv');
      return;
    }

    var dayTabs = '';
    for (var di = 0; di < revivals.length; di++) {
      dayTabs += '<button class="day-link" data-day="' + di + '">' + escText(extractDay(revivals[di].day)) + '</button>';
    }

    var pages = '';
    for (var ri = 0; ri < revivals.length; ri++) {
      var rev = revivals[ri];
      var dayPrefix = 'day' + (ri + 1) + '-';
      var feedingRefs = rev.feeding_refs || [];

      var outlineHtml = '';
      if (rev.outline && rev.outline.length) {
        outlineHtml = '<div class="outline-section">';
        var cxOutlineBox = toCtxBox(chapter.scripture || '');
        for (var oi = 0; oi < rev.outline.length; oi++) {
          outlineHtml += renderOutlineSection(rev.outline[oi], 1, '', false, dayPrefix, cxOutlineBox);
        }
        outlineHtml += '</div>';
      }

      var feedingHtml = '';
      var hasFeeding = (rev.feeding_scriptures && rev.feeding_scriptures.length) || (rev.morning_feeding && rev.morning_feeding.length);
      var hasReading = rev.message_reading && rev.message_reading.length;
      if (hasFeeding) {
        feedingHtml = '<div class="feeding-section"><h4>晨兴喂养</h4>';
        var fs = rev.feeding_scriptures || [];
        for (var fi = 0; fi < fs.length; fi++) {
          var frefs = feedingRefs[fi] || '';
          if (frefs) {
            feedingHtml += '<div class="scripture-block-static" data-refs="' + escAttr(frefs) + '">' + escText(fs[fi]) + '</div>';
          } else {
            feedingHtml += '<div class="feeding-scripture">' + escText(fs[fi]) + '</div>';
          }
        }
        var mf = rev.morning_feeding || [];
        var mfBox = toCtxBox(chapter.scripture || '');
        for (var mfi = 0; mfi < mf.length; mfi++) {
          feedingHtml += '<p class="content-text">' + wrapRefs(mf[mfi], mfBox.val) + '</p>';
          scanCtxBox(mf[mfi], mfBox);
        }
        feedingHtml += '</div>';
      }

      var readingHtml = '';
      if (hasReading) {
        readingHtml = '<div class="reading-section"><h4>信息选读</h4>';
        var mr = rev.message_reading;
        var mrBox = toCtxBox(chapter.scripture || '');
        for (var mri = 0; mri < mr.length; mri++) {
          readingHtml += '<p class="content-text">' + wrapRefs(mr[mri], mrBox.val) + '</p>';
          scanCtxBox(mr[mri], mrBox);
        }
        readingHtml += '</div>';
      }

      var refReadHtml = '';
      if (rev.ref_reading && rev.ref_reading.length) {
        var validRefs = rev.ref_reading.filter(function(l){ return l.indexOf('参读') >= 0; });
        if (validRefs.length) {
          refReadHtml = '<p class="content-text">' + validRefs.map(escText).join('<br>') + '</p>';
        }
      }

      var sep = (hasFeeding || hasReading) ? '<div class="content-separator"></div>' : '';

      pages += '<div class="day-page" data-day="' + (ri + 1) + '" data-page="' + ri + '">' +
        outlineHtml + sep + feedingHtml + readingHtml + refReadHtml +
        '</div>';
    }

    var html = '<div class="container">' +
      header +
      '<div class="content">' +
      '<div class="morning-revival-page">' +
      nav +
      '<div class="day-navigation">' + dayTabs + '</div>' +
      '<div class="pages-container" data-total-pages="' + revivals.length + '">' +
      '<div class="pages-track">' + pages + '</div>' +
      '</div>' +
      '<div class="page-controls">' +
      '<button class="prev-btn" id="prevBtn"><span>←</span><span class="btn-text">上一天</span></button>' +
      '<span class="page-indicator" id="pageIndicator">1 / ' + revivals.length + '</span>' +
      '<button class="next-btn" id="nextBtn"><span class="btn-text">下一天</span><span>→</span></button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      buildFooter(training) +
      '</div>';

    setContent(html, 'cx', batchPath, chapter, training);

    var initialPage = currentWeekdayIdx();
    if (initialPage >= revivals.length) initialPage = 0;
    setTimeout(function(){ initDayPager(initialPage); }, 0);
  }

  // ── 天翻页（晨读）─ 与 morning_revival.html 内嵌脚本一致 ──────────

  function initDayPager(initialPage) {
    var container = document.querySelector('.pages-container');
    if (!container) return;
    var totalPages = parseInt(container.dataset.totalPages, 10) || 0;
    if (!totalPages) return;

    var track = container.querySelector('.pages-track');
    var pages = container.querySelectorAll('.day-page');
    var dayLinks = document.querySelectorAll('.day-link');
    var prevBtn = document.getElementById('prevBtn');
    var nextBtn = document.getElementById('nextBtn');
    var indicator = document.getElementById('pageIndicator');
    var currentPage = 0;

    function setTrack(pct, animate) {
      // 重置容器内 scrollTop/scrollLeft，防止浏览器在选中文字时隐式滚动 overflow:hidden 元素，
      // 导致顶部内容被裁剪（overflow:clip 也一起处理，兼容旧版本）
      container.scrollTop = 0;
      container.scrollLeft = 0;
      track.style.transition = animate ? 'transform .3s cubic-bezier(.25,.46,.45,.94)' : 'none';
      track.style.transform = 'translateX(' + pct + '%)';
    }

    function updateHeight() {
      var active = pages[currentPage];
      if (active) container.style.height = active.offsetHeight + 'px';
    }

    function showPage(idx, scroll) {
      if (idx < 0 || idx >= totalPages) return;
      if (win.CXSpeech && win.CXSpeech.cancel) try { win.CXSpeech.cancel(); } catch(e) {}
      currentPage = idx;
      setTrack(-currentPage * 100, true);
      // 每次翻页也重置各 day-page 的 scrollTop，防止浏览器跟随选区时把内容滚走
      pages.forEach(function(p) { p.scrollTop = 0; p.scrollLeft = 0; });
      pages.forEach(function(p, i){ p.classList.toggle('is-active', i === currentPage); });
      dayLinks.forEach(function(l, i){ l.classList.toggle('active', i === currentPage); });
      if (prevBtn) prevBtn.disabled = currentPage === 0;
      if (nextBtn) nextBtn.disabled = currentPage === totalPages - 1;
      if (indicator) indicator.textContent = (currentPage+1) + ' / ' + totalPages;
      setTimeout(updateHeight, 50);
      if (scroll === true) win.scrollTo({top:0,behavior:'smooth'});
    }

    if (prevBtn) prevBtn.addEventListener('click', function(){ if (currentPage > 0) showPage(currentPage - 1, true); });
    if (nextBtn) nextBtn.addEventListener('click', function(){ if (currentPage < totalPages - 1) showPage(currentPage + 1, true); });
    dayLinks.forEach(function(l, i){ l.addEventListener('click', function(){ showPage(i, true); }); });

    var touchStartX = 0, touchStartY = 0, touchStartTime = 0, isDragging = false, isHorizontal = null;
    container.addEventListener('touchstart', function(e){
      var sel = win.getSelection();
      if (sel && sel.toString().length > 0) { isDragging = false; return; }
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
      isDragging = true; isHorizontal = null;
      track.style.transition = 'none';
    }, {passive:true});

    container.addEventListener('touchmove', function(e){
      if (!isDragging) return;
      var dx = e.touches[0].clientX - touchStartX;
      var dy = e.touches[0].clientY - touchStartY;
      if (isHorizontal === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // 水平方向需达到垂直分量的 2 倍，避免斜向滑动误触发翻页
        isHorizontal = Math.abs(dx) >= 2 * Math.abs(dy);
      }
      if (!isHorizontal) { setTrack(-currentPage * 100, true); isDragging = false; return; }
      var pct = -currentPage * 100 + dx / container.offsetWidth * 100;
      if (currentPage === 0 && dx > 0) pct = dx / container.offsetWidth * 30;
      if (currentPage === totalPages - 1 && dx < 0) pct = -currentPage * 100 + dx / container.offsetWidth * 30;
      setTrack(pct, false);
    }, {passive:true});

    container.addEventListener('touchend', function(e){
      if (!isDragging) return;
      isDragging = false;
      if (isHorizontal !== true) { setTrack(-currentPage * 100, true); return; }
      var dx = e.changedTouches[0].clientX - touchStartX;
      var dt = Date.now() - touchStartTime;
      var vel = Math.abs(dx) / (dt || 1); // px/ms
      var ratio = Math.abs(dx) / container.offsetWidth;
      // 超过容器宽度 20% 或速度 > 0.3px/ms（快速轻扫）则翻页
      if ((ratio > 0.20 || vel > 0.3) && dx < 0 && currentPage < totalPages - 1) showPage(currentPage + 1, false);
      else if ((ratio > 0.20 || vel > 0.3) && dx > 0 && currentPage > 0) showPage(currentPage - 1, false);
      else setTrack(-currentPage * 100, true);
    });

    document.addEventListener('keydown', function(e){
      if (e.key === 'ArrowLeft' && prevBtn) prevBtn.click();
      else if (e.key === 'ArrowRight' && nextBtn) nextBtn.click();
    });

    showPage(initialPage || 0, false);
    win.addEventListener('resize', updateHeight);

    // ── 防止浏览器在选中文字时隐式滚动 overflow:hidden 容器 ──────────────
    // setTrack/showPage 已在翻页时重置，但静止阅读时选中文字也会触发隐式滚动。
    // 把容器和所有 day-page 的 scrollTop/Left 钉在 0，避免顶部内容被裁剪。
    function _lockScroll(el) {
      el.addEventListener('scroll', function () {
        if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
          el.scrollTop = 0;
          el.scrollLeft = 0;
        }
      }, { passive: true });
    }
    _lockScroll(container);
    pages.forEach(function (p) { _lockScroll(p); });
  }

  // ── 设置内容并初始化全部功能 ─────────────────────────────────────────

  function setContent(html, viewType, batchPath, chapter, training) {
    showApp();
    var app = getApp();
    rescueThemeBtn(); // 防止按钮随 innerHTML 替换被销毁

    // 提前读取 per-page 记忆滚动位置，在 innerHTML 设置前隐藏 app，
    // 避免"先渲染顶部 → 再跳到记忆位置"的视觉闪屏（cx 视图为分页器，无需记忆窗口滚动）
    var _preScroll = 0;
    if (viewType !== 'cx' && batchPath && chapter && chapter.number) {
      try {
        _preScroll = parseInt(localStorage.getItem('cx_scroll:' + batchPath + '/' + chapter.number + '/' + viewType) || '0', 10) || 0;
        // 向后兼容：听抄页兼容旧 cx_h_scroll key
        if (_preScroll === 0 && viewType === 'h') {
          _preScroll = parseInt(localStorage.getItem('cx_h_scroll:' + batchPath + '/' + chapter.number) || '0', 10) || 0;
        }
      } catch(e){}
    }
    // 冷启动兜底：若 per-page 键无记录，读取全局上次滚动位置
    var _restoreScroll = sessionStorage.getItem('cx_restore_scroll');
    var _savedScrollVal = _restoreScroll ? parseInt(localStorage.getItem('cx_last_scroll') || '0', 10) : 0;
    if (_preScroll === 0 && viewType !== 'cx' && _restoreScroll && _savedScrollVal > 0) {
      _preScroll = _savedScrollVal;
    }
    if (_preScroll > 0) {
      app.style.opacity = '0';
      app.style.transition = '';
    }

    app.innerHTML = html;

    try { if(window.Capacitor||window.navigator.standalone||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)){sessionStorage.setItem('cx_access','ok');} } catch(e) {}
    setMeta(training);
    document.title = '第' + (chapter ? chapter.number : '') + '篇 - ' + ({
      cv:'纲目', cx:'晨读', h:'听抄', ts:'详情', sg:'诗歌', zs:'职事信息'
    }[viewType] || '');

    win.CX_TRAINING_PATH = batchPath;  /* 告知 scripture-popup.js 当前训练路径，用于加载 scriptures-data.json */
    if (win.CXScripturePopup && win.CXScripturePopup.init) try { win.CXScripturePopup.init(); } catch(e){}
    if (win.CXFontControl && win.CXFontControl.apply) try { win.CXFontControl.apply(); } catch(e){}
    if (win.CXHighlight && win.CXHighlight.init) try { win.CXHighlight.init(); } catch(e){}
    else if (win.CXHighlight && win.CXHighlight.refresh) try { win.CXHighlight.refresh(); } catch(e){}

    initSearchBtn();
    relocateThemeBtn();
    initSpeechForView(viewType, chapter);

    // 消费冷启动恢复标记
    if (_restoreScroll) sessionStorage.removeItem('cx_restore_scroll');

    try {
      var _today = new Date().toISOString().slice(0, 10);
      localStorage.setItem('cx_last_page', win.location.href);
      localStorage.setItem('cx_last_page_date', _today);
      localStorage.setItem('cx_last_page_view', viewType || '');
      localStorage.setItem('cx_last_scroll', '0'); // 重置，等待滚动事件更新
      // 记录每篇的上次访问视图，供目录页恢复导航目标
      if (batchPath && chapter && chapter.number) {
        localStorage.setItem('cx_chapter_view:' + batchPath + '/' + chapter.number, viewType || '');
      }
    } catch(e){}

    // 设置 per-page 滚动保存监听（cx 视图为分页器，不记忆窗口滚动）
    _scrollPageKey = (viewType !== 'cx' && batchPath && chapter && chapter.number)
      ? ('cx_scroll:' + batchPath + '/' + chapter.number + '/' + viewType) : null;
    if (_scrollSaveTimer) { clearTimeout(_scrollSaveTimer); _scrollSaveTimer = null; }
    if (_scrollSaveHandler) {
      win.removeEventListener('scroll', _scrollSaveHandler);
      _scrollSaveHandler = null;
    }
    _scrollSaveHandler = function() {
      if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
      _scrollSaveTimer = setTimeout(function() {
        try {
          var _sy = String(win.scrollY || 0);
          localStorage.setItem('cx_last_scroll', _sy);
          if (_scrollPageKey) localStorage.setItem(_scrollPageKey, _sy);
        } catch(e){}
      }, 300);
    };
    win.addEventListener('scroll', _scrollSaveHandler, {passive: true});

    // 恢复滚动位置（除 cx 分页器外，所有视图从 per-page 键恢复；返回导航+冷启动均生效）
    if (viewType !== 'cx') {
      if (_preScroll > 0) {
        // 用双 RAF 代替固定延迟：保证 layout 完成后滚动，
        // 配合入口处的 opacity=0 实现"先定位再淡入"效果，彻底消除闪屏
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            try { win.scrollTo(0, _preScroll); } catch(e){}
            var _app = getApp();
            _app.style.transition = 'opacity 0.15s ease';
            _app.style.opacity = '';
            setTimeout(function() { try { _app.style.transition = ''; } catch(e){} }, 200);
          });
        });
      } else {
        // 无记忆位置：确保 opacity 已还原（防御性清理）
        app.style.opacity = '';
        app.style.transition = '';
      }
    }

    if (win.CXSearch && win.CXSearch.handleSearchTargetSPA) {
      setTimeout(function(){ try { win.CXSearch.handleSearchTargetSPA(); } catch(e){} }, 100);
    }
  }

  // ── TTS 初始化 ──────────────────────────────────────────────────────────

  function initSpeechForView(viewType, chapter) {
    function tryInit() {
      if (!win.CXSpeech || !win.CXSpeech.init) return false;
      var bar = document.getElementById('bottomControlBar');
      var btn = document.getElementById('playPauseBtn');
      if (!bar || !btn) return true;
      win.CXSpeech.init({ getText: buildGetText(viewType, chapter), getElements: buildGetElements(viewType, chapter) });
      return true;
    }
    if (!tryInit()) {
      var attempts = 0;
      var t = setInterval(function(){ if (tryInit() || ++attempts > 50) clearInterval(t); }, 100);
    }
  }

  function buildGetText(viewType, chapter) {
    return function() {
      function getCleanText(node) {
        var clone = node.cloneNode(true);
        var ignored = clone.querySelectorAll('button, .scripture-content, .verse-line, .scripture-ref');
        ignored.forEach(function(el){ el.remove(); });
        return clone.textContent.trim();
      }

      var text = '';
      var titleEl = document.querySelector('.chapter-title');
      if (titleEl) text += titleEl.textContent.trim() + '。';
      var scrEl = document.querySelector('.scripture');
      if (scrEl) text += scrEl.textContent.trim() + '。';

      if (viewType === 'cv') {
        document.querySelectorAll('.outline-item').forEach(function(el){
          var t = getCleanText(el); if (t) text += t + '。';
        });
      } else if (viewType === 'cx') {
        var active = document.querySelector('.day-page.is-active') || document.querySelector('.day-page');
        if (active) {
          // 纲目
          active.querySelectorAll('.outline-item').forEach(function(el){
            var t = getCleanText(el); if (t) text += t + '。';
          });
          // 晨兴喂养经文（scripture-block-static 由 speech.js 包装层已展开书名）
          var feedingSec = active.querySelector('.feeding-section');
          if (feedingSec) {
            feedingSec.querySelectorAll('.scripture-block-static').forEach(function(block){
              var clone = block.cloneNode(true);
              clone.querySelectorAll('sup').forEach(function(s){ s.remove(); });
              var t = clone.textContent.trim();
              if (t) text += t + '。';
            });
            feedingSec.querySelectorAll('.feeding-scripture').forEach(function(s){
              var t = s.textContent.trim();
              if (t) text += t + '。';
            });
          }
          // 喂养正文 + 信息选读（.content-text）
          active.querySelectorAll('.content-text').forEach(function(el){
            var t = getCleanText(el); if (t) text += t + '。';
          });
        }
      } else if (viewType === 'h') {
        var msg = document.querySelector('.message-content');
        if (msg) {
          msg.querySelectorAll(':scope > p.content-text').forEach(function(p){
            var t = getCleanText(p); if (t) text += t + '。';
          });
        }
        document.querySelectorAll('.section').forEach(function(sec){
          var lvl = sec.querySelector('[class^="section-level"]');
          if (lvl) { var t = getCleanText(lvl); if (t) text += t + '。'; }
          var content = sec.querySelector('.section-content');
          if (content) {
            content.querySelectorAll('.content-text').forEach(function(p){
              var t = getCleanText(p); if (t) text += t + '。';
            });
          }
        });
      } else if (viewType === 'ts' || viewType === 'zs') {
        document.querySelectorAll('.content-text').forEach(function(p){
          var t = getCleanText(p); if (t) text += t + '。';
        });
      }

      text = text
        .replace(/\s+/g, ' ')
        .replace(/[\r\n\t]/g, '')
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。、；：？！""''（）《》\s]/g, '')
        .trim();
      return text;
    };
  }

  // 与 buildGetText 遍历顺序严格一致，返回 [{el, textLen}] 供 speech.js 做段落高亮映射
  // textLen = 该元素在 fullText 中的估算字符数（含末尾的 '。'，误差 <5% 可接受）
  function buildGetElements(viewType, chapter) {
    return function() {
      // 估算单个节点在 fullText 中的字符数，与 getCleanText + safeText + cleanup 一致
      function elemLen(node) {
        var clone = node.cloneNode(true);
        clone.querySelectorAll('button, .scripture-content, .verse-line, .scripture-ref')
             .forEach(function(el){ el.remove(); });
        var t = clone.textContent.trim()
          .replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '')
          .replace(/\s+/g, ' ').replace(/[\r\n\t]/g, '')
          .replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。、；：？！""''（）《》\s]/g, '')
          .trim();
        return t.length + 1; // +1 for '。'
      }

      var segs = [];
      var titleEl = document.querySelector('.chapter-title');
      if (titleEl && titleEl.textContent.trim()) segs.push({el: titleEl, textLen: elemLen(titleEl)});
      var scrEl = document.querySelector('.scripture');
      if (scrEl && scrEl.textContent.trim()) segs.push({el: scrEl, textLen: elemLen(scrEl)});

      if (viewType === 'cv') {
        document.querySelectorAll('.outline-item').forEach(function(el){
          var len = elemLen(el); if (len > 1) segs.push({el: el, textLen: len});
        });
      } else if (viewType === 'cx') {
        var active = document.querySelector('.day-page.is-active') || document.querySelector('.day-page');
        if (active) {
          active.querySelectorAll('.outline-item').forEach(function(el){
            var len = elemLen(el); if (len > 1) segs.push({el: el, textLen: len});
          });
          var feedingSec = active.querySelector('.feeding-section');
          if (feedingSec) {
            feedingSec.querySelectorAll('.scripture-block-static').forEach(function(block){
              var clone = block.cloneNode(true);
              clone.querySelectorAll('sup').forEach(function(s){ s.remove(); });
              var t = clone.textContent.trim();
              if (t) segs.push({el: block, textLen: t.length + 1});
            });
            feedingSec.querySelectorAll('.feeding-scripture').forEach(function(s){
              var t = s.textContent.trim();
              if (t) segs.push({el: s, textLen: t.length + 1});
            });
          }
          active.querySelectorAll('.content-text').forEach(function(el){
            var len = elemLen(el); if (len > 1) segs.push({el: el, textLen: len});
          });
        }
      } else if (viewType === 'h') {
        var msg = document.querySelector('.message-content');
        if (msg) {
          msg.querySelectorAll(':scope > p.content-text').forEach(function(p){
            var len = elemLen(p); if (len > 1) segs.push({el: p, textLen: len});
          });
        }
        document.querySelectorAll('.section').forEach(function(sec){
          var lvl = sec.querySelector('[class^="section-level"]');
          if (lvl) { var len = elemLen(lvl); if (len > 1) segs.push({el: lvl, textLen: len}); }
          var content = sec.querySelector('.section-content');
          if (content) {
            content.querySelectorAll('.content-text').forEach(function(p){
              var len = elemLen(p); if (len > 1) segs.push({el: p, textLen: len});
            });
          }
        });
      } else if (viewType === 'ts' || viewType === 'zs') {
        document.querySelectorAll('.content-text').forEach(function(p){
          var len = elemLen(p); if (len > 1) segs.push({el: p, textLen: len});
        });
      }

      return segs;
    };
  }

  // ── 搜索按钮 ──────────────────────────────────────────────────────────

  function initSearchBtn() {
    // 当前可见容器内的搜索按钮（每次重渲染后都要绑定）
    var btns = document.querySelectorAll('#cx-search-btn');
    btns.forEach(function(btn){
      if (btn._cxSearchBound) return;
      btn._cxSearchBound = true;
      btn.addEventListener('click', function(e){
        if (e && e.preventDefault) e.preventDefault();
        if (win.CXSearch && win.CXSearch.open) win.CXSearch.open();
      });
    });
  }

  // ── 设置（主题切换）按钮重定位 ───────────────────────────────────────
  // theme-toggle.js 在 DOMContentLoaded 时把 .theme-toggle-btn 追加到首屏的 .container；
  // SPA 切换视图后，新的 .container 不含按钮 → 把现有按钮移动过来。
  // 若按钮尚未创建（初始加载即到子页），轮询重试。

  // 在 innerHTML 替换前调用：将按钮暂存到 body，防止随容器一起被销毁
  function rescueThemeBtn() {
    var btn = document.querySelector('.theme-toggle-btn');
    if (btn && btn.parentElement !== document.body) {
      document.body.appendChild(btn);
    }
  }

  function relocateThemeBtn(retry) {
    var btn = document.querySelector('.theme-toggle-btn');
    if (!btn) {
      if (retry === undefined) retry = 30;
      if (retry > 0) setTimeout(function(){ relocateThemeBtn(retry - 1); }, 100);
      return;
    }
    var app = document.getElementById('app');
    var home = document.getElementById('homeView');
    var visible = (app && app.style.display !== 'none') ? app : home;
    if (!visible) return;
    var container = visible.querySelector('.container');
    if (container && btn.parentElement !== container) {
      container.appendChild(btn);
    }
  }

  // ── 批次目录页 ──────────────────────────────────────────────────────────

  function renderBatchIndex(batchPath) {
    // 离开听抄等章节页前，丢弃还未提交的 scroll 防抖 timer，避免 scrollTo(0,0) 触发的 scroll
    // 事件在 300ms 后把 scrollY=0 写回 cx_h_scroll 键，覆盖用户的记忆位置
    if (_scrollSaveTimer) { clearTimeout(_scrollSaveTimer); _scrollSaveTimer = null; }
    if (_scrollSaveHandler) { win.removeEventListener('scroll', _scrollSaveHandler); _scrollSaveHandler = null; }
    _scrollPageKey = null;
    showApp();
    rescueThemeBtn();
    getApp().innerHTML = '<div class="home-status"><div class="home-status-icon">⏳</div>加载中...</div>';

    loadTraining(batchPath)
      .then(function(training) {
        try { if(window.Capacitor||window.navigator.standalone||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)){sessionStorage.setItem('cx_access','ok');} } catch(e){}
        setMeta(training);

        var subtitleLine ='<div class="subtitle">' + escText(training.year + '-' + training.season) + '</div>';

        var h1Text = training.subtitle || training.title;

        var navLinks = '<a href="javascript:void(0)" class="nav-link" title="返回主页" onclick="CXRouter.navigate(\'\')">返回主页</a>' +
          '<a href="javascript:void(0)" class="nav-link active" title="目录">目录</a>';
        if (training.mottos && training.mottos.length) {
          navLinks += '<a href="javascript:void(0)" class="nav-link" title="标语" onclick="CXRouter.navigate(\'' + escAttr(batchPath) + '/motto\')">标语</a>';
        }
        if (training.motto_song_image) {
          navLinks += '<a href="javascript:void(0)" class="nav-link" title="标语诗歌" onclick="CXRouter.navigate(\'' + escAttr(batchPath) + '/motto_song\')">标语诗歌</a>';
        }
        navLinks += '<button type="button" id="cx-search-btn" class="nav-link" title="搜索">🔍</button>';

        var tocItems = (training.chapters || []).map(function(ch) {
          var savedView = '';
          try { savedView = localStorage.getItem('cx_chapter_view:' + batchPath + '/' + ch.number) || ''; } catch(e){}
          var defView = savedView || ((ch.morning_revivals && ch.morning_revivals.length > 0) ? 'cx' : 'cv');
          return '<a href="javascript:void(0)" class="toc-item" onclick="CXRouter.navigate(\'' +
            escAttr(batchPath) + '/' + ch.number + '/' + defView + '\')" data-chapter="' + ch.number + '">' +
            '<span class="toc-num">第' + ch.number + '篇</span>' +
            '<span class="toc-title">' + escText(ch.title) + '</span>' +
            '</a>';
        }).join('');

        var html = '<div class="container">' +
          '<div class="header">' +
          '<h1>' + escText(h1Text) + '</h1>' +
          subtitleLine +
          '</div>' +
          '<div class="content"><div class="index-page">' +
          '<div class="page-navigation">' + navLinks + '</div>' +
          '<div class="toc-list">' + tocItems + '</div>' +
          '</div></div>' +
          buildFooter(training) +
          '</div>';

        rescueThemeBtn();
        getApp().innerHTML = html;
        document.title = training.title || '目录';
        initSearchBtn();
        relocateThemeBtn();
        try { localStorage.setItem('cx_last_page', win.location.href); } catch(e){}
        // 设置 per-page 滚动保存监听
        _scrollPageKey = 'cx_scroll:idx:' + batchPath;
        _scrollSaveHandler = function() {
          if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
          _scrollSaveTimer = setTimeout(function() {
            try { if (_scrollPageKey) localStorage.setItem(_scrollPageKey, String(win.scrollY || 0)); } catch(e){}
          }, 300);
        };
        win.addEventListener('scroll', _scrollSaveHandler, {passive: true});
        // 恢复滚动位置
        try {
          var _idxScroll = parseInt(localStorage.getItem('cx_scroll:idx:' + batchPath) || '0', 10);
          if (_idxScroll > 0) {
            requestAnimationFrame(function() { requestAnimationFrame(function() {
              try { win.scrollTo(0, _idxScroll); } catch(e){}
            }); });
          }
        } catch(e){}
      })
      .catch(function(err) {
        var isCapacitor = !!(win.Capacitor && win.Capacitor.isNativePlatform && win.Capacitor.isNativePlatform());
        var packHint = isCapacitor
          ? '<p style="font-size:13px;color:var(--text-secondary)">此训练可能需要下载历史资源包</p>' +
            '<button class="home-retry-btn" onclick="window.CXResourcePack&&CXResourcePack.showPacksDialog()">📦 下载历史资源</button>'
          : '';
        getApp().innerHTML = '<div class="home-status error"><div class="home-status-icon">❌</div><p>加载失败：' + escText(String(err)) + '</p><button class="home-retry-btn" onclick="location.reload()">重试</button>' + packHint + '</div>';
      });
  }

  function renderMotto(batchPath) {
    if (_scrollSaveTimer) { clearTimeout(_scrollSaveTimer); _scrollSaveTimer = null; }
    if (_scrollSaveHandler) { win.removeEventListener('scroll', _scrollSaveHandler); _scrollSaveHandler = null; }
    _scrollPageKey = null;
    showApp();
    rescueThemeBtn();
    loadTraining(batchPath).then(function(training) {
      var nav = '<div class="page-navigation">' +
        '<a href="javascript:void(0)" class="nav-link" title="返回主页" onclick="CXRouter.navigate(\'\')">返回主页</a>' +
        '<a href="javascript:void(0)" class="nav-link" title="目录" onclick="CXRouter.navigate(\'' + escAttr(batchPath) + '\')">目录</a>' +
        '<a href="javascript:void(0)" class="nav-link active" title="标语">标语</a>' +
        (training.motto_song_image ? '<a href="javascript:void(0)" class="nav-link" title="标语诗歌" onclick="CXRouter.navigate(\'' + escAttr(batchPath) + '/motto_song\')">标语诗歌</a>' : '') +
        '<button type="button" id="cx-search-btn" class="nav-link" title="搜索">🔍</button>' +
        '</div>';

      var paragraphs = '';
      var mottos = training.mottos || [];
      var lines = [];
      function flushPara() {
        if (!lines.length) return;
        paragraphs += '<div class="motto-paragraph">';
        for (var k = 0; k < lines.length; k++) {
          paragraphs += '<span class="motto-line">' + escText(lines[k]) + '</span>';
        }
        paragraphs += '</div>';
        lines = [];
      }
      for (var i = 0; i < mottos.length; i++) {
        var m = mottos[i];
        if (m === '###PARAGRAPH_SEPARATOR###') { flushPara(); }
        else { lines.push(m); }
      }
      flushPara();

      var subtitleLine = '<div class="subtitle">' + escText(training.year + '-' + training.season) + '</div>';
      var h1Text = training.subtitle || training.title;
      var html = '<div class="container"><div class="header"><h1>' + escText(h1Text) + '</h1>' + subtitleLine + '</div>' +
        '<div class="content"><div class="motto-page">' + nav +
        '<div class="motto-container">' + (paragraphs || '<div class="no-motto">本次训练暂无标语</div>') + '</div>' +
        '</div></div>' +
        buildFooter(training) +
        '</div>';
      rescueThemeBtn();
      getApp().innerHTML = html;
      try { if(window.Capacitor||window.navigator.standalone||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)){sessionStorage.setItem('cx_access','ok');} } catch(e){}
      document.title = '标语 - ' + (training.title || '');
      setMeta(training);
      initSearchBtn();
      relocateThemeBtn();
      // 设置 per-page 滚动保存监听
      _scrollPageKey = 'cx_scroll:motto:' + batchPath;
      _scrollSaveHandler = function() {
        if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
        _scrollSaveTimer = setTimeout(function() {
          try { if (_scrollPageKey) localStorage.setItem(_scrollPageKey, String(win.scrollY || 0)); } catch(e){}
        }, 300);
      };
      win.addEventListener('scroll', _scrollSaveHandler, {passive: true});
      try {
        var _mottoScroll = parseInt(localStorage.getItem('cx_scroll:motto:' + batchPath) || '0', 10);
        if (_mottoScroll > 0) {
          requestAnimationFrame(function() { requestAnimationFrame(function() {
            try { win.scrollTo(0, _mottoScroll); } catch(e){}
          }); });
        }
      } catch(e){}
    }).catch(function(err){
      var isCapacitor = !!(win.Capacitor && win.Capacitor.isNativePlatform && win.Capacitor.isNativePlatform());
      var packHint = isCapacitor
        ? '<p style="font-size:13px;color:var(--text-secondary)">此训练可能需要下载历史资源包</p>' +
          '<button class="home-retry-btn" onclick="window.CXResourcePack&&CXResourcePack.showPacksDialog()">📦 下载历史资源</button>'
        : '';
      getApp().innerHTML = '<div class="home-status error"><p>加载失败</p>' + packHint + '</div>';
    });
  }

  function renderMottoSong(batchPath) {
    if (_scrollSaveTimer) { clearTimeout(_scrollSaveTimer); _scrollSaveTimer = null; }
    if (_scrollSaveHandler) { win.removeEventListener('scroll', _scrollSaveHandler); _scrollSaveHandler = null; }
    _scrollPageKey = null;
    showApp();
    rescueThemeBtn();
    var root = win.CX_ROOT || './';
    loadTraining(batchPath).then(function(training) {
      var nav = '<div class="page-navigation">' +
        '<a href="javascript:void(0)" class="nav-link" title="返回主页" onclick="CXRouter.navigate(\'\')">返回主页</a>' +
        '<a href="javascript:void(0)" class="nav-link" title="目录" onclick="CXRouter.navigate(\'' + escAttr(batchPath) + '\')">目录</a>' +
        (training.mottos && training.mottos.length ? '<a href="javascript:void(0)" class="nav-link" title="标语" onclick="CXRouter.navigate(\'' + escAttr(batchPath) + '/motto\')">标语</a>' : '') +
        '<a href="javascript:void(0)" class="nav-link active" title="标语诗歌">标语诗歌</a>' +
        '<button type="button" id="cx-search-btn" class="nav-link" title="搜索">🔍</button>' +
        '</div>';

      var subtitleLine = '<div class="subtitle">' + escText(training.year + '-' + training.season) + '</div>';
      var h1Text = training.subtitle || training.title;

      // 支持多图（motto_song_images 优先，向后兼容 motto_song_image）
      var songImages = (training.motto_song_images && training.motto_song_images.length)
        ? training.motto_song_images
        : (training.motto_song_image ? [training.motto_song_image] : []);

      var imagesHtml = '';
      if (songImages.length > 1) {
        var allUrls = songImages.map(function(p) { return escAttr(JSON.stringify(root + batchPath + '/' + p)); }).join(',');
        for (var i = 0; i < songImages.length; i++) {
          var iUrl = root + escAttr(batchPath) + '/' + escAttr(songImages[i]);
          imagesHtml += '<div class="song-image-wrapper">' +
            '<img src="' + iUrl + '" alt="标语诗歌第' + (i + 1) + '页" class="song-image"' +
            ' onclick="window.openImageViewer&&openImageViewer(this.src,[' + allUrls + '],' + i + ')">' +
            '</div>';
        }
        imagesHtml += '<p class="click-hint">👆 点击图片放大查看</p>';
      } else if (songImages.length === 1) {
        var imgUrl = root + escAttr(batchPath) + '/' + escAttr(songImages[0]);
        imagesHtml = '<div class="song-image-wrapper">' +
          '<img src="' + imgUrl + '" alt="标语诗歌" class="song-image" onclick="window.openImageViewer&&openImageViewer(this.src)">' +
          '<p class="click-hint">👆 点击图片放大查看</p>' +
          '</div>';
      }

      var html = '<div class="container"><div class="header"><h1>' + escText(h1Text) + '</h1>' + subtitleLine + '</div>' +
        '<div class="content"><div class="song-page">' + nav +
        '<div class="song-container">' + imagesHtml + '</div></div></div>' +
        buildFooter(training) +
        '</div>';
      rescueThemeBtn();
      getApp().innerHTML = html;
      try { if(window.Capacitor||window.navigator.standalone||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)){sessionStorage.setItem('cx_access','ok');} } catch(e){}
      document.title = '标语诗歌 - ' + (training.title || '');
      setMeta(training);
      initSearchBtn();
      relocateThemeBtn();
      // 设置 per-page 滚动保存监听
      _scrollPageKey = 'cx_scroll:motto_song:' + batchPath;
      _scrollSaveHandler = function() {
        if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
        _scrollSaveTimer = setTimeout(function() {
          try { if (_scrollPageKey) localStorage.setItem(_scrollPageKey, String(win.scrollY || 0)); } catch(e){}
        }, 300);
      };
      win.addEventListener('scroll', _scrollSaveHandler, {passive: true});
      try {
        var _songScroll = parseInt(localStorage.getItem('cx_scroll:motto_song:' + batchPath) || '0', 10);
        if (_songScroll > 0) {
          requestAnimationFrame(function() { requestAnimationFrame(function() {
            try { win.scrollTo(0, _songScroll); } catch(e){}
          }); });
        }
      } catch(e){}
    }).catch(function(err){
      var isCapacitor = !!(win.Capacitor && win.Capacitor.isNativePlatform && win.Capacitor.isNativePlatform());
      var packHint = isCapacitor
        ? '<p style="font-size:13px;color:var(--text-secondary)">此训练可能需要下载历史资源包</p>' +
          '<button class="home-retry-btn" onclick="window.CXResourcePack&&CXResourcePack.showPacksDialog()">📦 下载历史资源</button>'
        : '';
      getApp().innerHTML = '<div class="home-status error"><p>加载失败</p>' + packHint + '</div>';
    });
  }

  function renderHome() {
    if (_scrollSaveTimer) { clearTimeout(_scrollSaveTimer); _scrollSaveTimer = null; }
    if (_scrollSaveHandler) { win.removeEventListener('scroll', _scrollSaveHandler); _scrollSaveHandler = null; }
    _scrollPageKey = 'cx_scroll:home';
    showHome();
    try { if(window.Capacitor||window.navigator.standalone||(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)){sessionStorage.setItem('cx_access','ok');} } catch(e) {}
    try { localStorage.setItem('cx_last_page', win.location.href); } catch(e) {}
    // 设置主页滚动保存监听
    _scrollSaveHandler = function() {
      if (_scrollSaveTimer) clearTimeout(_scrollSaveTimer);
      _scrollSaveTimer = setTimeout(function() {
        try { localStorage.setItem('cx_scroll:home', String(win.scrollY || 0)); } catch(e){}
      }, 300);
    };
    win.addEventListener('scroll', _scrollSaveHandler, {passive: true});
    // 恢复主页滚动位置
    // 注意：trainingsGrid 内容由异步 refreshHomeGrid() 填充，需在内容更新后再恢复；
    // 用 MutationObserver 监听 grid 子节点变化（内容加载完成时触发），同时保留 double RAF
    // 作为返回导航场景的立即兜底（grid 已预填充、高度充足时直接生效）。
    try {
      var _homeScroll = parseInt(localStorage.getItem('cx_scroll:home') || '0', 10);
      if (_homeScroll > 0) {
        var _homeObsActive = false;
        var _homeObs = null;
        var _doHomeScroll = function() {
          try { win.scrollTo(0, _homeScroll); } catch(e){}
        };
        // 立即尝试（返回导航场景：grid 已预填充，高度足够）
        requestAnimationFrame(function() { requestAnimationFrame(function() { _doHomeScroll(); }); });
        // MutationObserver：grid 内容更新后再次恢复（冷启动场景：grid 异步加载后修正位置）
        var _gridEl = document.getElementById('trainingsGrid');
        if (_gridEl && typeof MutationObserver !== 'undefined') {
          _homeObs = new MutationObserver(function() {
            if (_homeObs) { try { _homeObs.disconnect(); } catch(e){} _homeObs = null; }
            _doHomeScroll();
          });
          _homeObs.observe(_gridEl, { childList: true });
          // 2s 后若 grid 未触发变化则清理 observer（防止悬挂）
          setTimeout(function() {
            if (_homeObs) { try { _homeObs.disconnect(); } catch(e){} _homeObs = null; }
          }, 2000);
        }
      }
    } catch(e){}
    relocateThemeBtn();
  }

  // ── 章节视图分发 ────────────────────────────────────────────────────────

  function renderChapterView(batchPath, chNum, viewType) {
    showApp();
    rescueThemeBtn();
    getApp().innerHTML = '<div class="home-status"><div class="home-status-icon">⏳</div>加载中...</div>';
    loadTraining(batchPath)
      .then(function(training) {
        var chapter = null;
        var chapters = training.chapters || [];
        for (var i = 0; i < chapters.length; i++) {
          if (chapters[i].number === chNum) { chapter = chapters[i]; break; }
        }
        if (!chapter) {
          getApp().innerHTML = '<p class="no-content">未找到第' + chNum + '篇</p>';
          return;
        }
        if (viewType === 'cv') renderCv(batchPath, chapter, training);
        else if (viewType === 'cx') renderCx(batchPath, chapter, training);
        else if (viewType === 'h')  renderH(batchPath, chapter, training);
        else if (viewType === 'ts') renderTs(batchPath, chapter, training);
        else if (viewType === 'sg') renderSg(batchPath, chapter, training);
        else if (viewType === 'zs') renderZs(batchPath, chapter, training);
        else renderCv(batchPath, chapter, training);
      })
      .catch(function(err) {
        var isCapacitor = !!(win.Capacitor && win.Capacitor.isNativePlatform && win.Capacitor.isNativePlatform());
        var packHint = isCapacitor
          ? '<p style="font-size:13px;color:var(--text-secondary)">此训练可能需要下载历史资源包</p>' +
            '<button class="home-retry-btn" onclick="window.CXResourcePack&&CXResourcePack.showPacksDialog()">📦 下载历史资源</button>'
          : '';
        getApp().innerHTML = '<div class="home-status error"><p>加载失败：' + escText(String(err)) + '</p>' +
          '<button class="home-retry-btn" onclick="CXRouter.navigate(\'' + escAttr(batchPath+'/'+chNum+'/'+viewType) + '\')">重试</button>' + packHint + '</div>';
      });
  }

  win.CXRenderer = {
    renderHome: renderHome,
    renderBatchIndex: renderBatchIndex,
    renderChapterView: renderChapterView,
    renderMotto: renderMotto,
    renderMottoSong: renderMottoSong,
    extractRefs: extractRefs,
    outlineLevelClass: outlineLevelClass
  };

  // ── 退出/后台时立即保存滚动位置（跳过防抖，防止 300ms 内退出导致位置丢失）──────
  function flushScrollSave() {
    if (_scrollSaveTimer) { clearTimeout(_scrollSaveTimer); _scrollSaveTimer = null; }
    if (!_scrollPageKey) return;
    try {
      var _sy = String(win.scrollY || 0);
      localStorage.setItem(_scrollPageKey, _sy);
      localStorage.setItem('cx_last_scroll', _sy);
    } catch(e) {}
  }
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) flushScrollSave();
  });
  win.addEventListener('pagehide', flushScrollSave);   // iOS Safari / Capacitor
  win.addEventListener('beforeunload', flushScrollSave);

  // ── search.js 兼容补丁 ────────────────────────────────────────────────
  function patchSearch() {
    var s = win.CXSearch;
    if (!s || s._spaPatch) return;
    s._spaPatch = true;
    if (s.navigateTo) {
      s.navigateTo = function(entry, query) {
        try { sessionStorage.setItem('cx_search_target', JSON.stringify({
          url:       entry.url,
          pi:        entry.pi,
          selector:  entry.selector,
          query:     query,
          day_index: (typeof entry.day_index === 'number') ? entry.day_index : null
        })); } catch(e){}
        // 关闭弹框 UI；用 discard() 移除 backStack 栈顶但不 history.back() 也不 _skip++，
        // 再用 navigateReplace 将该历史条目原地替换为目标章节，保证 _skip=0，
        // 弹框的 history.back() 可正常被 backStack 消费。
        if (s._modal) s._modal.classList.remove('active');
        if (s._inBackStack) {
          if (win.CX && win.CX.backStack && win.CX.backStack.discard) win.CX.backStack.discard();
          s._inBackStack = false;
        }
        if (win.CXRouter) win.CXRouter.navigateReplace(entry.url);
      };
    }
    if (s._currentContext) {
      s._currentContext = function() {
        var path = win.CXRouter ? win.CXRouter.currentPath() : '';
        var parts = path.split('/').filter(Boolean);
        if (parts.length >= 3) return { trainingPath: parts[0], chapter: parseInt(parts[1],10) };
        if (parts.length === 1) return { trainingPath: parts[0], chapter: null };
        return null;
      };
    }
  }
  if (win.CXSearch) patchSearch();
  else {
    var siv = setInterval(function(){ if (win.CXSearch) { patchSearch(); clearInterval(siv); } }, 100);
    setTimeout(function(){ clearInterval(siv); }, 5000);
  }

}(window));
