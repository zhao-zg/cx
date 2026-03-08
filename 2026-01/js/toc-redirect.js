// 根据星期几决定跳转目标
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var dayOfWeek = new Date().getDay(); // 0=周日, 1=周一, ..., 6=周六
    var dayAnchors = ['', 'day1', 'day2', 'day3', 'day4', 'day5', 'day6']; // 周一到周六

    var tocItems = document.querySelectorAll('.toc-item');
    tocItems.forEach(function (item) {
      var chapterNum = item.getAttribute('data-chapter');

      if (dayOfWeek === 0) {
        // 周日：跳转到纲目页
        item.href = chapterNum + '_cv.htm';
      } else {
        // 周一到周六：跳转到晨兴页对应的天
        item.href = chapterNum + '_cx.htm#' + dayAnchors[dayOfWeek];
      }
    });
  });
})();
