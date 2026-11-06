# Katkı rehberi

FlacSync'e katkı verdiğin için teşekkürler! Hata bildirimi, öneri ve pull request'ler açıktır.

## Başlarken

```bash
npm install --ignore-scripts
npm run setup:binaries
npm run dev            # API :4000 + arayüz :5173
npm run desktop:dev    # masaüstü uygulaması
```

## Pull request öncesi

```bash
npm run typecheck
npm test
```

İkisi de temiz geçmeli. Yeni davranış eklerken (özellikle eşleştirme ve sıralama mantığında)
`backend/tests/` altına test ekle — gerçek dünyadan bir yanlış eşleşme örneği en iyi testtir.

## Kod düzeni

- **Backend:** TypeScript (strict, NodeNext). Platform başına bir sağlayıcı
  (`backend/src/services/metadata/providers/`); saf mantık (skorlama, sıralama, ayrıştırma) ayrı
  dosyalarda ve test edilebilir tutulur.
- **Frontend:** React + Tailwind CSS v4. Arayüzdeki her metin
  [`frontend/src/i18n/translations.ts`](frontend/src/i18n/translations.ts) içinde **hem Türkçe hem
  İngilizce** olmalı.
- **Hatalar:** Backend hataları `{ error: { code, message } }` döner; yeni bir hata kodu eklersen
  çevirisini de ekle.

## Yeni bir dil eklemek

`translations.ts` içine yeni sözlüğü ekleyip `LANGS` listesine kodunu yaz. TypeScript, eksik
anahtar bırakırsan derlemeyi durdurur.

## Kapsam dışı

DRM'li akışları (Spotify, Apple Music, Deezer, Tidal vb.) çözen, şifre kıran ya da hesap çerezleriyle
korumalı içeriğe erişen değişiklikler kabul edilmez.

## Lisans

Katkıların [MIT lisansı](LICENSE) altında dağıtılmayı kabul etmiş sayılır.
