# Kod imzalama / Code signing

## Durum

FlacSync'in Windows dosyaları **şu an imzasızdır**. Bu yüzden Windows SmartScreen indirilen
`FlacSync-Setup-x.y.z.exe` ve `FlacSync-x.y.z.exe` için "Windows bilgisayarınızı korudu /
Bilinmeyen yayımcı" uyarısı gösterir. Dosyalar zararlı değildir; uyarı yalnızca yayımcının
doğrulanmadığını ve dosyanın henüz yeterince indirilmediğini (itibar) belirtir.

Proje, açık kaynak projelere ücretsiz kod imzalama sertifikası sağlayan
[SignPath Foundation](https://signpath.org) programına başvurmayı hedefler. Onaylandığında
sürümler bu politikaya göre imzalanacaktır.

## VirusTotal taraması

Sürüm dosyaları [VirusTotal](https://www.virustotal.com)'te 70'e yakın antivirüs motoruyla taranır:

| Sürüm | Dosya | Sonuç |
|---|---|---|
| 1.3.0 | [FlacSync-Setup-1.3.0.exe](https://www.virustotal.com/gui/file/9902d2505495a75c704def1f0ce4dfbf58edc58300aa55af568ec372e96b713a) | **0 / 65** — hiçbir motor zararlı bulmadı |
| 1.3.0 | [FlacSync-1.3.0.exe](https://www.virustotal.com/gui/file/ee43fd07adf655b217c23d0756ea202d9dcf8c519e1deb9694a887cd02061a84) | Hiçbir motor zararlı bulmadı |

Depoya `VT_API_KEY` secret'ı eklenirse yeni sürümler GitHub Actions'ta otomatik taranır ve linkler
sürüm notlarına yazılır.

> VirusTotal temiz sonucu SmartScreen uyarısını **kaldırmaz**: SmartScreen dosyanın zararlı olup
> olmadığına değil, imzalı olup olmadığına ve ne kadar indirildiğine (itibar) bakar.

## SmartScreen uyarısını kaldırmak için (bakımcının yapacakları)

1. **SignPath Foundation'a başvur (ücretsiz):** [signpath.org/apply](https://signpath.org/apply) —
   depo: `furkibayashi/flacsync`, lisans MIT, imzalama politikası: bu dosya. Onaylanınca SignPath
   panelinden alınan değerleri depo ayarlarına ekle:
   - Secrets: `SIGNPATH_API_TOKEN`
   - Variables: `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`

   Release iş akışındaki imzalama adımı kendiliğinden devreye girer; sonraki sürümler imzalı çıkar.
   İmzalı dosyalar itibarı yayımcı (sertifika) üzerinden kazanır, her sürümde sıfırlanmaz.
2. **Hemen etkili ara çözüm — Microsoft'a gönder:** [Microsoft Security Intelligence dosya gönderimi](https://www.microsoft.com/en-us/wdsi/filesubmission)
   → "Software developer" → dosyayı yükle → "Incorrectly detected as malware/malicious" ya da
   "SmartScreen" seçeneği. İnceleme genelde 1–3 gün sürer ve o dosyanın uyarısını kaldırabilir.
3. Ücretli seçenek: Azure Trusted Signing (aylık ~10 $) ya da bir OV/EV kod imzalama sertifikası.

## İndirdiğin dosyayı doğrulama

Her sürümde `SHA256SUMS.txt` yayımlanır. PowerShell'de:

```powershell
Get-FileHash .\FlacSync-Setup-1.1.0.exe -Algorithm SHA256
```

Çıkan değer `SHA256SUMS.txt` içindekiyle aynı olmalıdır. Sürüm dosyaları yalnızca bu depodaki
kaynaktan, [GitHub Actions](.github/workflows/release.yml) üzerinde derlenir.

## İmzalama politikası (SignPath onayından sonra geçerli)

- **İmzalanan dosyalar:** Yalnızca bu depodaki kaynak koddan, GitHub Actions `Release` iş akışıyla
  derlenen Windows kurulumu ve portable exe. Yerel makinede derlenen dosyalar imzalanmaz.
- **Ekip ve roller:**
  - Yazarlar (committers): depoya yazma yetkisi olan geliştiriciler
  - İnceleyiciler (reviewers): `main` dalına gelen her değişikliği inceleyen bakımcılar
  - Onaylayıcı (approver): [@furkibayashi](https://github.com/furkibayashi) — her imzalama isteğini
    elle onaylar
- **Hesap güvenliği:** Tüm ekip üyeleri GitHub ve SignPath hesaplarında çok faktörlü kimlik
  doğrulama (MFA) kullanır.
- **Gizlilik:** FlacSync kullanıcı verisi toplamaz; telemetri yoktur. Uygulama yalnızca kullanıcının
  istediği arama ve indirme için Deezer, Apple (iTunes), Spotify (anahtar tanımlıysa) ve YouTube
  Music'e istek gönderir. Ayrıntılar: [README](README.md).

Ücretsiz kod imzalama SignPath.io tarafından, sertifika SignPath Foundation tarafından sağlanacaktır.

---

## English summary

FlacSync's Windows binaries are **currently unsigned**, so SmartScreen shows an "unknown publisher"
warning. Verify downloads with the published `SHA256SUMS.txt`. The project intends to apply to the
[SignPath Foundation](https://signpath.org) open-source code signing program; once approved, only
binaries built from this repository by the GitHub Actions `Release` workflow will be signed, each
signing request manually approved by the maintainer, with MFA required for all team members.
FlacSync collects no user data and has no telemetry.

VirusTotal: [Setup 1.3.0](https://www.virustotal.com/gui/file/9902d2505495a75c704def1f0ce4dfbf58edc58300aa55af568ec372e96b713a)
(0/65) · [Portable 1.3.0](https://www.virustotal.com/gui/file/ee43fd07adf655b217c23d0756ea202d9dcf8c519e1deb9694a887cd02061a84)
— no engine flags either file. A clean VirusTotal result does not remove the SmartScreen prompt;
only code signing (SignPath Foundation) and download reputation do.
