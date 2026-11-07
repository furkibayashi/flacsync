# Kod imzalama / Code signing

## Durum

FlacSync'in Windows dosyaları **şu an imzasızdır**. Bu yüzden Windows SmartScreen indirilen
`FlacSync-Setup-x.y.z.exe` ve `FlacSync-x.y.z.exe` için "Windows bilgisayarınızı korudu /
Bilinmeyen yayımcı" uyarısı gösterir. Dosyalar zararlı değildir; uyarı yalnızca yayımcının
doğrulanmadığını ve dosyanın henüz yeterince indirilmediğini (itibar) belirtir.

Proje, açık kaynak projelere ücretsiz kod imzalama sertifikası sağlayan
[SignPath Foundation](https://signpath.org) programına başvurmayı hedefler. Onaylandığında
sürümler bu politikaya göre imzalanacaktır.

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
