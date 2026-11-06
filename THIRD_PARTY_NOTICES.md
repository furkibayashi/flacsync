# Üçüncü taraf bileşenler / Third-party components

FlacSync'in kendi kaynak kodu [MIT lisansı](LICENSE) ile dağıtılır. Windows kurulumu ve
portable sürüm, aşağıdaki **ayrı programları** kendi lisanslarıyla birlikte içerir. Bu
programlar FlacSync koduna bağlanmaz (link edilmez); FlacSync onları ayrı süreç olarak çalıştırır.

FlacSync's own source code is distributed under the [MIT License](LICENSE). The Windows installer
and portable build bundle the following **separate programs** under their own licenses. They are
not linked into FlacSync; FlacSync runs them as separate processes.

| Bileşen / Component | Lisans / License | Kaynak / Source |
|---|---|---|
| **FFmpeg** 6.1.1 (`ffmpeg.exe`, gyan.dev "essentials" build, via [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)) | GPL-3.0-or-later | https://github.com/FFmpeg/FFmpeg/commit/e38092ef93 · build: https://www.gyan.dev/ffmpeg/builds/ |
| **yt-dlp** (`yt-dlp.exe`, via [`yt-dlp-exec`](https://github.com/microlinkhq/youtube-dl-exec)) | The Unlicense (bundled Python runtime and libraries under their own licenses) | https://github.com/yt-dlp/yt-dlp |
| **Electron** (Chromium, Node.js) | MIT (Chromium components: see `LICENSES.chromium.html` in the install folder) | https://github.com/electron/electron |

FFmpeg'in tam lisans metni ve derleme yapılandırması kurulum klasöründe
`resources/licenses/ffmpeg/` altında bulunur. GPL kapsamında FFmpeg'in kaynak koduna yukarıdaki
bağlantıdan ulaşabilirsiniz.

The full FFmpeg license text and build configuration are included in the install folder under
`resources/licenses/ffmpeg/`. The corresponding FFmpeg source code is available at the link above.

## npm bağımlılıkları / npm dependencies

Uygulama paketine gömülen JavaScript kütüphaneleri (express, axios, zod, pino, node-id3,
fluent-ffmpeg, yazl, React, lucide-react ve diğerleri) MIT, ISC, BSD veya Apache-2.0 gibi izin
verici lisanslara sahiptir. Tam liste için:

The JavaScript libraries bundled into the app (express, axios, zod, pino, node-id3, fluent-ffmpeg,
yazl, React, lucide-react and others) use permissive licenses such as MIT, ISC, BSD or Apache-2.0.
For the full list:

```bash
npx license-checker --production --summary
```
