// Masaüstü kabuğunun (menü, tepsi, bildirimler, iletişim pencereleri) metinleri.
// Dil, arayüzden 'flacsync:desktop-prefs' ile gelir; gelene kadar işletim sisteminin dili kullanılır.
import { EventEmitter } from 'node:events';

export type DesktopLang = 'tr' | 'en' | 'de' | 'es' | 'fr' | 'ru';
export const DESKTOP_LANGS: readonly DesktopLang[] = ['tr', 'en', 'de', 'es', 'fr', 'ru'];

const tr = {
  saved: 'Kaydedildi',
  savedMany: '{n} dosya kaydedildi',
  clipTitle: 'Müzik linki kopyalandı',
  clipBody: '{link}\nİndirmek için tıkla.',
  trayHint: 'Tepside çalışmaya devam ediyor. Tamamen kapatmak için tepsi simgesine sağ tıklayıp Çıkış’ı seçin.',
  ytdlpUpdated: 'yt-dlp güncellendi ({v}).',
  ytdlpUpdatedRetry: 'yt-dlp güncellendi ({v}); {n} indirme yeniden deneniyor.',
  paused: 'duraklatıldı',
  pause: 'Duraklat',
  play: 'Çal',
  next: 'Sonraki',
  prev: 'Önceki',
  showApp: "{app}'i göster",
  mini: 'Mini oynatıcı',
  miniClose: 'Mini oynatıcıyı kapat',
  quit: 'Çıkış',
  file: 'Dosya',
  openSaved: 'Kaydedilenler klasörünü aç',
  settingsFile: 'Ayarlar ve API anahtarları…',
  restart: 'Yeniden başlat (ayarları uygula)',
  tools: 'Araçlar',
  checkUpdates: 'Güncellemeleri denetle…',
  settings: 'Ayarlar',
  updateYtdlp: "yt-dlp'yi güncelle",
  openLog: 'Log dosyasını aç',
  reload: 'Sayfayı yenile',
  devtools: 'Geliştirici araçları',
  help: 'Yardım',
  licenses: 'Lisanslar ve üçüncü taraf bildirimleri',
  about: '{app} {v} hakkında',
  view: 'Görünüm',
  zoomIn: 'Yakınlaştır',
  zoomOut: 'Uzaklaştır',
  resetZoom: 'Varsayılan boyut',
  fullscreen: 'Tam ekran',
  saveAs: 'Farklı kaydet',
  pickMusicFolder: 'Müzik klasörü seç',
  downloadFolder: 'İndirme klasörü',
};

export type DesktopKey = keyof typeof tr;

const en: Record<DesktopKey, string> = {
  saved: 'Saved',
  savedMany: '{n} files saved',
  clipTitle: 'Music link copied',
  clipBody: '{link}\nClick to download.',
  trayHint: 'Still running in the tray. To quit completely, right-click the tray icon and choose Quit.',
  ytdlpUpdated: 'yt-dlp updated ({v}).',
  ytdlpUpdatedRetry: 'yt-dlp updated ({v}); retrying {n} downloads.',
  paused: 'paused',
  pause: 'Pause',
  play: 'Play',
  next: 'Next',
  prev: 'Previous',
  showApp: 'Show {app}',
  mini: 'Mini player',
  miniClose: 'Close mini player',
  quit: 'Quit',
  file: 'File',
  openSaved: 'Open saved files folder',
  settingsFile: 'Settings and API keys…',
  restart: 'Restart (apply settings)',
  tools: 'Tools',
  checkUpdates: 'Check for updates…',
  settings: 'Settings',
  updateYtdlp: 'Update yt-dlp',
  openLog: 'Open log file',
  reload: 'Reload page',
  devtools: 'Developer tools',
  help: 'Help',
  licenses: 'Licenses and third-party notices',
  about: 'About {app} {v}',
  view: 'View',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Actual size',
  fullscreen: 'Full screen',
  saveAs: 'Save as',
  pickMusicFolder: 'Choose a music folder',
  downloadFolder: 'Download folder',
};

const de: Record<DesktopKey, string> = {
  saved: 'Gespeichert',
  savedMany: '{n} Dateien gespeichert',
  clipTitle: 'Musiklink kopiert',
  clipBody: '{link}\nZum Herunterladen klicken.',
  trayHint: 'Läuft im Infobereich weiter. Zum vollständigen Beenden mit der rechten Maustaste auf das Symbol klicken und „Beenden“ wählen.',
  ytdlpUpdated: 'yt-dlp aktualisiert ({v}).',
  ytdlpUpdatedRetry: 'yt-dlp aktualisiert ({v}); {n} Downloads werden erneut versucht.',
  paused: 'pausiert',
  pause: 'Pause',
  play: 'Abspielen',
  next: 'Weiter',
  prev: 'Zurück',
  showApp: '{app} anzeigen',
  mini: 'Mini-Player',
  miniClose: 'Mini-Player schließen',
  quit: 'Beenden',
  file: 'Datei',
  openSaved: 'Ordner mit gespeicherten Dateien öffnen',
  settingsFile: 'Einstellungen und API-Schlüssel…',
  restart: 'Neu starten (Einstellungen übernehmen)',
  tools: 'Werkzeuge',
  checkUpdates: 'Nach Updates suchen…',
  settings: 'Einstellungen',
  updateYtdlp: 'yt-dlp aktualisieren',
  openLog: 'Protokolldatei öffnen',
  reload: 'Seite neu laden',
  devtools: 'Entwicklertools',
  help: 'Hilfe',
  licenses: 'Lizenzen und Hinweise Dritter',
  about: 'Über {app} {v}',
  view: 'Ansicht',
  zoomIn: 'Vergrößern',
  zoomOut: 'Verkleinern',
  resetZoom: 'Originalgröße',
  fullscreen: 'Vollbild',
  saveAs: 'Speichern unter',
  pickMusicFolder: 'Musikordner wählen',
  downloadFolder: 'Download-Ordner',
};

const es: Record<DesktopKey, string> = {
  saved: 'Guardado',
  savedMany: '{n} archivos guardados',
  clipTitle: 'Enlace de música copiado',
  clipBody: '{link}\nHaz clic para descargar.',
  trayHint: 'Sigue ejecutándose en la bandeja. Para salir del todo, haz clic derecho en el icono y elige Salir.',
  ytdlpUpdated: 'yt-dlp actualizado ({v}).',
  ytdlpUpdatedRetry: 'yt-dlp actualizado ({v}); reintentando {n} descargas.',
  paused: 'en pausa',
  pause: 'Pausar',
  play: 'Reproducir',
  next: 'Siguiente',
  prev: 'Anterior',
  showApp: 'Mostrar {app}',
  mini: 'Minirreproductor',
  miniClose: 'Cerrar minirreproductor',
  quit: 'Salir',
  file: 'Archivo',
  openSaved: 'Abrir carpeta de archivos guardados',
  settingsFile: 'Ajustes y claves de API…',
  restart: 'Reiniciar (aplicar ajustes)',
  tools: 'Herramientas',
  checkUpdates: 'Buscar actualizaciones…',
  settings: 'Ajustes',
  updateYtdlp: 'Actualizar yt-dlp',
  openLog: 'Abrir archivo de registro',
  reload: 'Recargar página',
  devtools: 'Herramientas de desarrollo',
  help: 'Ayuda',
  licenses: 'Licencias y avisos de terceros',
  about: 'Acerca de {app} {v}',
  view: 'Ver',
  zoomIn: 'Acercar',
  zoomOut: 'Alejar',
  resetZoom: 'Tamaño real',
  fullscreen: 'Pantalla completa',
  saveAs: 'Guardar como',
  pickMusicFolder: 'Elegir carpeta de música',
  downloadFolder: 'Carpeta de descargas',
};

const fr: Record<DesktopKey, string> = {
  saved: 'Enregistré',
  savedMany: '{n} fichiers enregistrés',
  clipTitle: 'Lien musical copié',
  clipBody: '{link}\nCliquez pour télécharger.',
  trayHint: 'Toujours actif dans la zone de notification. Pour quitter complètement, faites un clic droit sur l’icône et choisissez Quitter.',
  ytdlpUpdated: 'yt-dlp mis à jour ({v}).',
  ytdlpUpdatedRetry: 'yt-dlp mis à jour ({v}) ; nouvelle tentative pour {n} téléchargements.',
  paused: 'en pause',
  pause: 'Pause',
  play: 'Lire',
  next: 'Suivant',
  prev: 'Précédent',
  showApp: 'Afficher {app}',
  mini: 'Mini-lecteur',
  miniClose: 'Fermer le mini-lecteur',
  quit: 'Quitter',
  file: 'Fichier',
  openSaved: 'Ouvrir le dossier des fichiers enregistrés',
  settingsFile: 'Paramètres et clés API…',
  restart: 'Redémarrer (appliquer les paramètres)',
  tools: 'Outils',
  checkUpdates: 'Rechercher des mises à jour…',
  settings: 'Paramètres',
  updateYtdlp: 'Mettre à jour yt-dlp',
  openLog: 'Ouvrir le fichier journal',
  reload: 'Recharger la page',
  devtools: 'Outils de développement',
  help: 'Aide',
  licenses: 'Licences et mentions tierces',
  about: 'À propos de {app} {v}',
  view: 'Affichage',
  zoomIn: 'Zoom avant',
  zoomOut: 'Zoom arrière',
  resetZoom: 'Taille réelle',
  fullscreen: 'Plein écran',
  saveAs: 'Enregistrer sous',
  pickMusicFolder: 'Choisir un dossier de musique',
  downloadFolder: 'Dossier de téléchargement',
};

const ru: Record<DesktopKey, string> = {
  saved: 'Сохранено',
  savedMany: 'Сохранено файлов: {n}',
  clipTitle: 'Ссылка на музыку скопирована',
  clipBody: '{link}\nНажмите, чтобы скачать.',
  trayHint: 'Приложение продолжает работать в трее. Чтобы закрыть его полностью, щёлкните значок правой кнопкой и выберите «Выход».',
  ytdlpUpdated: 'yt-dlp обновлён ({v}).',
  ytdlpUpdatedRetry: 'yt-dlp обновлён ({v}); повторная попытка для загрузок: {n}.',
  paused: 'пауза',
  pause: 'Пауза',
  play: 'Играть',
  next: 'Следующий',
  prev: 'Предыдущий',
  showApp: 'Показать {app}',
  mini: 'Мини-плеер',
  miniClose: 'Закрыть мини-плеер',
  quit: 'Выход',
  file: 'Файл',
  openSaved: 'Открыть папку сохранённых файлов',
  settingsFile: 'Настройки и ключи API…',
  restart: 'Перезапустить (применить настройки)',
  tools: 'Инструменты',
  checkUpdates: 'Проверить обновления…',
  settings: 'Настройки',
  updateYtdlp: 'Обновить yt-dlp',
  openLog: 'Открыть файл журнала',
  reload: 'Перезагрузить страницу',
  devtools: 'Инструменты разработчика',
  help: 'Справка',
  licenses: 'Лицензии и уведомления третьих сторон',
  about: 'О программе {app} {v}',
  view: 'Вид',
  zoomIn: 'Увеличить',
  zoomOut: 'Уменьшить',
  resetZoom: 'Исходный размер',
  fullscreen: 'Полноэкранный режим',
  saveAs: 'Сохранить как',
  pickMusicFolder: 'Выберите папку с музыкой',
  downloadFolder: 'Папка загрузок',
};

const STRINGS: Record<DesktopLang, Record<DesktopKey, string>> = { tr, en, de, es, fr, ru };

/** "tr-TR", "en-US", "de" … → desteklenen dil (yoksa İngilizce) */
export function toDesktopLang(locale: string | null | undefined): DesktopLang {
  const base = (locale ?? '').toLowerCase().split(/[-_]/)[0] as DesktopLang;
  return DESKTOP_LANGS.includes(base) ? base : 'en';
}

let current: DesktopLang = 'tr';
const events = new EventEmitter();

export function getDesktopLang(): DesktopLang {
  return current;
}

/** Dili değiştirir; değiştiyse dinleyicilere (menü, tepsi) haber verir */
export function setDesktopLang(lang: unknown): void {
  if (typeof lang !== 'string' || !DESKTOP_LANGS.includes(lang as DesktopLang) || lang === current) return;
  current = lang as DesktopLang;
  events.emit('change', current);
}

export function onDesktopLangChange(listener: (lang: DesktopLang) => void): () => void {
  events.on('change', listener);
  return () => events.off('change', listener);
}

export function dt(key: DesktopKey, vars: Record<string, string | number> = {}, lang: DesktopLang = current): string {
  const text = STRINGS[lang][key] ?? tr[key];
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
