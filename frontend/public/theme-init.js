// Tema, sayfa çizilmeden önce uygulanır (yanıp sönme olmasın). CSP satır içi betiğe izin vermediği için ayrı dosya.
(function () {
  try {
    var theme = localStorage.getItem('flacsync.theme');
    if (theme && theme !== 'night') document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    /* depolama kapalı */
  }
})();
