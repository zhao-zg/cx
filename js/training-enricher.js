/*!
 * training-enricher.js — 晨兴 feeding_refs / context 富化
 *
 * 依赖: ref-detector.js（window.CXRef）必须先于本脚本加载。
 *
 * 暴露: window.CXEnricher
 *   .enrichChapter(chapter)       — 富化单章晨兴字段（原位修改）
 *   .enrichTrainings(trainings)   — 批量富化训练数组（原位修改）
 *
 * 构建脚本（build-trainings-json.js）通过 require() 同样可用。
 */
(function (win) {
  'use strict';

  /**
   * 富化单章晨兴数据：计算 feeding_refs / morning_feeding_contexts / message_reading_contexts。
   * 镜像 Python 的 _enrich_chapter_feeding_refs / _enrich_section_contexts。
   * 原位修改 chapter 对象。
   */
  function enrichChapter(chapter) {
    var ref = win.CXRef;
    if (!ref) return;

    var expandCnRefs = ref.expandCnRefs;
    var scanCtx      = ref.scanCtx;
    var scripture    = chapter.scripture || '';
    var revivals     = chapter.morning_revivals || [];

    for (var ri = 0; ri < revivals.length; ri++) {
      var rev = revivals[ri];
      var ctxStr;

      // ── feeding_refs ─────────────────────────────────────────────────────
      var feedScrips = rev.feeding_scriptures || [];
      ctxStr = scripture;
      rev.feeding_refs = feedScrips.map(function (text) {
        var m = (text || '').trim().match(/^(\S+)/);
        var refPart = m ? m[1].replace(/[，、；。：:,;)）\]]+$/, '') : '';
        var ctxM = ctxStr.match(/^([^\d:]+)(\d+):(\d+)/);
        var defBook = ctxM ? ctxM[1] : '';
        var defCh   = ctxM ? parseInt(ctxM[2], 10) : 0;
        var refs = expandCnRefs(refPart, defBook, defCh);
        if (refs.length > 0) {
          var lr = refs[refs.length - 1].replace(/[上中下]$/, '');
          var lm = lr.match(/^([^\d:]+)(\d+):(\d+)/);
          if (lm) ctxStr = lm[1] + lm[2] + ':' + lm[3];
        }
        return refs.join(',');
      });

      // ── morning_feeding_contexts ─────────────────────────────────────────
      var mf = rev.morning_feeding || [];
      ctxStr = scripture;
      rev.morning_feeding_contexts = mf.map(function (para) {
        var c = ctxStr;
        ctxStr = scanCtx(para, ctxStr) || ctxStr;
        return c;
      });

      // ── message_reading_contexts ─────────────────────────────────────────
      var mr = rev.message_reading || [];
      ctxStr = scripture;
      rev.message_reading_contexts = mr.map(function (para) {
        var c = ctxStr;
        ctxStr = scanCtx(para, ctxStr) || ctxStr;
        return c;
      });
    }
  }

  /** 批量富化训练数组（原位修改每个 training.chapters）。 */
  function enrichTrainings(trainings) {
    for (var i = 0; i < trainings.length; i++) {
      var chapters = trainings[i].chapters || [];
      for (var j = 0; j < chapters.length; j++) {
        enrichChapter(chapters[j]);
      }
    }
  }

  win.CXEnricher = { enrichChapter: enrichChapter, enrichTrainings: enrichTrainings };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : {}));
