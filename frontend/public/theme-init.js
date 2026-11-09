// Tema, sayfa çizilmeden önce uygulanır (yanıp sönme olmasın). CSP satır içi betiğe izin vermediği için ayrı dosya.
(function () {
  try {
    var theme = localStorage.getItem('flacsync.theme');
    if (theme && theme !== 'night') document.documentElement.setAttribute('data-theme', theme);
    var style = localStorage.getItem('flacsync.style');
    if (style && style !== 'classic') document.documentElement.setAttribute('data-style', style);
  } catch (e) {
    /* depolama kapalı */
  }
})();
