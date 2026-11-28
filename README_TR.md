<div align="center">

<img src="./assets/banner.png" width="92%" alt="Squad Admin Panel: free and open source web admin panel for Squad servers">

# Squad Admin Panel

**Squad dedicated sunucuları için ücretsiz, açık kaynak admin paneli ve RCON aracı. SquadJS eklentisi olarak çalışır: admin komutu yazmadan tarayıcıdan kick, ban, uyarı ve harita değiştirme; canlı skor tablosu, squad'lar ve chat, admin yetkileri, sunucu logları ve takım dengeleme (Smart Shuffle).**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-A78BFA?style=for-the-badge&logo=gnu&logoColor=white)](./LICENSE)
[![Version](https://img.shields.io/github/v/release/Miabeyefendi/Squad-AdminPanel?style=for-the-badge&color=F59E0B&label=version)](https://github.com/Miabeyefendi/Squad-AdminPanel/releases/latest)
[![Platform](https://img.shields.io/badge/SquadJS_plugin-1E293B?style=for-the-badge&logo=nodedotjs&logoColor=white)](#-kurulum)
[![Status](https://img.shields.io/badge/status-active-22C55E?style=for-the-badge)](#-yol-haritası)
[![Author](https://img.shields.io/badge/by-Miabeyefendi-0EA5E9?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Miabeyefendi)

[English](./README.md) · **Türkçe** · [Español](./README_ES.md) · [简体中文](./README_ZH.md) · [Русский](./README_RU.md)

[Kurulum](#-kurulum) · [Özellikler](#-öne-çıkanlar) · [Hızlı başlangıç](#-hızlı-başlangıç) · [Adım adım rehber](./docs/KURULUM_TR.md) · [Değişiklikler](./CHANGELOG.md)

<a href="https://github.com/Miabeyefendi/Squad-AdminPanel/releases/latest">
  <img src="./assets/btn-download.svg" height="52" alt="Son sürümü indir">
</a>
<a href="./docs/KURULUM_TR.md">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/btn-tutorial-dark.svg">
    <img src="./assets/btn-tutorial.svg" height="52" alt="Kurulum rehberini oku">
  </picture>
</a>

<img src="./screenshots/overview-dark.png" width="92%" alt="Squad Admin Panel genel bakış: oynanan harita, takım biletleri, admin bekleyen oyuncular ve commander'lar">

</div>

> **Oyunculu gerçek maçta henüz denenmedi.** Otomatik testlerle, gerçek SquadJS ve sahte oyunla, bir de boş bir Squad v10.6.3 sunucusunda gerçek RCON ile (daha eski bir yapı) denendi. İlk kick ve banları oyunda kontrol et.

**Hiç bilmiyorsan:** [adım adım Türkçe rehber](./docs/KURULUM_TR.md) sıfırdan anlatır.

---

## 🎬 İş başında

<div align="center">
  <img src="./screenshots/demo.gif" width="92%" alt="Squad Admin Panel hareketli tur: genel bakış, skor tablosu, kill feed, squad ve chat, oyuncu kartı, harita, Smart Shuffle, eklentiler, yetkiler ve kayıtlar">
  <br/>
  <sub><b>Panel turu</b> · on bir ekran, demo verisi</sub>
</div>

---

## ✨ Öne çıkanlar

- **Canlı skor tablosu** - iki takım yan yana: kill, down, ölüm, K/D, revive, teamkill, hasar, squad numaraları
- **Kill Feed** - kim kimi hangi silahla ve ne kadar hasarla vurdu, düşürdü, öldürdü; oyuncu başına down başına isabet, tek isabetle down, en yüksek hasar ve 60 saniyedeki down sayısı, hileci incelemek için. Sunucu logunda ıskalanan mermi yoktur, bu yüzden accuracy gösterilmez
- **Hızlı işlemler** - genel bakışta komutanların altında tek sütun: mesajlar, squad'sız oyunculara ve kiti olmayan squad liderlerine hatırlatma, sıradaki harita, shuffle, maçı yeniden başlatma ve bitirme
- **Oyuncular ve squad'lar** - squad listesi yanında canlı chat, tek oyuncuya ekranda özel mesaj
- **Admin işlemleri** - uyarı, kick, ban (1 saatten kalıcıya), takım değiştirme, squad'dan çıkarma, tek ya da toplu, hep onaylı
- **Harita kontrolü** - harita, mod, versiyon, faction ve birim seçimi, sıradaki harita ya da hemen değiştirme
- **Smart Shuffle dahil** - 11 hazır ayar ve tüm ayarlarla takım dengeleme, yeniden başlatmadan
- **Admin yetkileri** - sunucu sahibi, admin, senior mod, junior mod, hesap bazında yetki, sunucuda denetlenir
- **Kayıtlar ve loglar** - yeniden başlatmada silinmeyen uyarı, kick, ban, not; chat, kill, teamkill logları, CSV
- **Otomatik kurallar** - teamkill, squad'sız oyuncu, kitsiz SL, küçük kilitli squad, chat ve isim filtresi, hepsi kapalı gelir
- **SquadJS eklenti yöneticisi** - diğer eklentileri tarayıcıdan aç, kapat, ayarla
- **Sunucu sayfası** - oyuncu sınırı, sıra sınırı ve sunucu parolası, otomatik duyurular, tek yönlü Discord bildirimleri (ban, kick, `!admin` çağrısı), varsayılan olarak kapalı
- **Yeni çıkan oyuncular** - son 30 dakikada çıkanlar teamkill ve sicilleriyle listelenir, yine banlanabilir; commander düşürme ve squad dağıtma butonları
- **Beş dil** - English, Türkçe, Deutsch, Русский ve 中文, sağ üstteki bayraktan seçilir; eklenti ayar adları eklentinin yazdığı gibi kalır
- **Kendi sunucunda** - hesap yok, bulut yok, ek npm paketi yok; şifreli veri ve deneme-yanılma koruması

---

## 📦 Kurulum

### Gerekenler

| | |
|---|---|
| Squad sunucusu | RCON açık dedicated sunucu, ya da RCON'a ve FTP/SFTP ile loglara erişilen hosting |
| [SquadJS](https://github.com/Team-Silver-Sphere/SquadJS) | Son sürüm, 4.1.0 ile denendi |
| Node.js | 18 ya da daha yeni. Panel Node 24 ve 26 ile denendi, 18 ile denenmedi |
| Tarayıcı | Güncel Chrome, Edge ya da Firefox |

### Kullanılanlar

![JavaScript](https://img.shields.io/badge/JavaScript-1E293B?style=for-the-badge&logo=javascript&logoColor=A78BFA)
![Node.js](https://img.shields.io/badge/Node.js-1E293B?style=for-the-badge&logo=nodedotjs&logoColor=A78BFA)

### Kur

1. [Sürüm sayfasından](https://github.com/Miabeyefendi/Squad-AdminPanel/releases/latest) `Squad-AdminPanel-v1.2.0.zip` dosyasını indir.
2. İçindeki `admin-panel.js` ve `admin-panel` klasörünü SquadJS'in `squad-server/plugins/` klasörüne çıkar.
3. `config.json` içindeki `plugins` listesine ekle:

   ```json
   { "plugin": "AdminPanel", "enabled": true, "port": 8170 }
   ```

4. SquadJS'i yeniden başlat. `Admin panel on http://127.0.0.1:8170` yazmalı.

<details>
<summary><b>Sürüm dosyası hakkında</b></summary>

Zip, bu depodaki `src/squadjs/` (tag `v1.2.0`) klasörünün düz kopyasıdır, `admin-panel/` içine `LICENSE` ve `NOTICE` eklenmiştir. Derleme, küçültme ya da paketleme yoktur.

`Squad-AdminPanel-v1.2.0.zip` SHA-256:

```
faff271ea4f371e48d5c7626aa981aa441e9bc56da46818c21008577bc615734
```

</details>

---

## 🚀 Hızlı başlangıç

1. **SquadJS'in çalıştığı bilgisayarda** `http://127.0.0.1:8170` adresini aç.
2. `admin` / `admin` ile gir, panel açılır. **My account** altından kendi parolanı koyana kadar üstte bir uyarı durur.
3. Panelin önüne proxy ya da tünel koymadan **önce** parolayı değiştir. Parola `admin` / `admin` iken yalnızca sunucunun kendisinden çalışır.

Başka bilgisayardan ya da birden fazla admin için: [uzaktan giriş](./docs/KURULUM_TR.md#başka-adminlerin-ve-uzaktan-giriş).

---

## 🖼️ Ekran görüntüleri

İsim ve sayılar demodandır. Görüntülerdeki harita ve faction resimleri indirmeye dahil değildir: panelin resim klasörüne sonradan eklenmiştir (bkz. Emeği geçenler). Onlar yoksa panel kendi çizimlerini gösterir.

<table>
<tr>
  <td align="center" width="50%"><img src="./screenshots/killfeed-shooter-dark.png" width="100%" alt="Tek oyuncu seçili Kill Feed: down başına isabet, tek isabetle down, silahlar ve her down"/><br/><sub><b>Hileci tespiti</b> · tek vuranın sayıları ve çatışmaları</sub></td>
  <td align="center" width="50%"><img src="./screenshots/killfeed-dark.png" width="100%" alt="Kill Feed: her down ve kill için vuran, vurulan, silah, hasar ve isabet sayısı"/><br/><sub><b>Kill Feed</b> · kim kimi neyle düşürdü</sub></td>
</tr>
<tr>
  <td align="center" width="50%">
    <img src="./screenshots/scoreboard-dark.png" width="100%" alt="Squad scoreboard with both teams side by side, commander strips, squad numbers and match statistics"/><br/>
    <sub><b>Skor tablosu</b> · sabit sütunlar</sub>
  </td>
  <td align="center" width="50%">
    <img src="./screenshots/players-and-chat-light.png" width="100%" alt="Squad lists of both teams next to the live in-game chat"/><br/>
    <sub><b>Oyuncular ve chat</b> · tek kişiye yanıt</sub>
  </td>
</tr>
<tr>
  <td align="center" width="50%">
    <img src="./screenshots/map-picker-light.png" width="100%" alt="Squad map picker with map cards, mode, version and faction choice"/><br/>
    <sub><b>Harita</b> · sıradaki ya da hemen</sub>
  </td>
  <td align="center" width="50%">
    <img src="./screenshots/smart-shuffle-dark.png" width="100%" alt="Smart Shuffle team balance controls, switches and presets"/><br/>
    <sub><b>Smart Shuffle</b> · yeniden başlatmadan denge</sub>
  </td>
</tr>
<tr>
  <td align="center" width="50%">
    <img src="./screenshots/staff-permissions-dark.png" width="100%" alt="Staff page with admin accounts and a permission table"/><br/>
    <sub><b>Yetkiler</b> · kim ne yapabilir</sub>
  </td>
  <td align="center" width="50%">
    <img src="./screenshots/plugins-light.png" width="100%" alt="SquadJS plugin manager with the plugin list and its settings"/><br/>
    <sub><b>Eklentiler</b> · ayarlar form olur</sub>
  </td>
</tr>
<tr>
  <td align="center" width="50%">
    <img src="./screenshots/player-records-dark.png" width="100%" alt="Timeline of warnings, kicks, bans and notes on players"/><br/>
    <sub><b>Kayıtlar</b> · her uyarı, kick, ban ve not</sub>
  </td>
  <td align="center" width="50%">
    <img src="./screenshots/automatic-rules-light.png" width="100%" alt="Automatic server rules with plain language summaries"/><br/>
    <sub><b>Kurallar</b> · her biri ne yapacağını söyler</sub>
  </td>
</tr>
<tr>
  <td align="center" width="50%"><img src="./screenshots/player-card-dark.png" width="100%" alt="Player card with match numbers, warning history, notes and the kick and ban buttons"/><br/><sub><b>Oyuncu kartı</b> · geçmiş, not, işlemler</sub></td>
  <td align="center" width="50%"><img src="./screenshots/overview-light.png" width="100%" alt="Overview page in the light theme"/><br/><sub><b>Açık tema</b> · sisteme uyar</sub></td>
</tr>
<tr>
  <td align="center" width="50%"><img src="./screenshots/logs-dark.png" width="100%" alt="Server logs: kills with weapon, filtered by period, with CSV export"/><br/><sub><b>Loglar</b> · her dönem, CSV</sub></td>
  <td align="center" width="50%"><img src="./screenshots/delete-records-dark.png" width="100%" alt="Deleting records: warning banner and a preview of what would be removed"/><br/><sub><b>Güvenli silme</b> · önce önizleme</sub></td>
</tr>
<tr>
  <td align="center" width="50%"><img src="./screenshots/smart-shuffle-settings-dark.png" width="100%" alt="Smart Shuffle settings grouped by topic"/><br/><sub><b>Shuffle ayarları</b> · grup grup</sub></td>
  <td align="center" width="50%"><img src="./screenshots/ranks-dark.png" width="100%" alt="Default permissions of admin, senior mod and junior mod side by side"/><br/><sub><b>Rütbeler</b> · hazır yetkiler yan yana</sub></td>
</tr>
<tr>
  <td align="center" width="50%"><img src="./screenshots/killfeed-players-dark.png" width="100%" alt="Tek isabetle down sayısına göre sıralı Kill Feed oyuncu tablosu"/><br/><sub><b>Vuranlar</b> · her sayıya göre sırala</sub></td>
  <td align="center" width="50%"><img src="./screenshots/server-light.png" width="100%" alt="Solda ayar listesi, sağda seçilen ayar olan sunucu sayfası"/><br/><sub><b>Sunucu</b> · sınırlar, parola, duyurular</sub></td>
</tr>
<tr>
  <td align="center" width="50%"><img src="./screenshots/phone-overview-dark.png" width="55%" alt="The overview page on a phone"/><br/><sub><b>Telefonda</b> · genel bakış</sub></td>
  <td align="center" width="50%"><img src="./screenshots/phone-players-dark.png" width="55%" alt="Squad lists on a phone"/><br/><sub><b>Telefonda</b> · squad'lar</sub></td>
</tr>
</table>

---

## ⚙️ Ayarlar

Panel ayarları `config.json` içindeki `AdminPanel` satırındadır. **Oraya parola yazma:** SquadJS eklenti ayarlarını kendi sunucusuna gönderir. Tüm ayarlar [rehberde](./docs/KURULUM_TR.md#️-ayarlar).

| Ayar | Hazır değer | Ne yapar |
|---|---|---|
| `port` | `8170` | Panelin portu |
| `host` | `127.0.0.1` | Değiştirme; uzaktan erişim için proxy ya da tünel kullan |
| `allowedHosts` | `[]` | Panelin cevap verdiği ek alan adları |
| `secureCookie`, `trustProxy` | `false` | Aynı bilgisayardaki HTTPS proxy arkasında aç |
| `retentionDays` | `90` | Logların tutulduğu gün, 0 sonsuza kadar |
| `dataDir` | `./admin-panel-data` | Hesaplar, kayıtlar, kurallar ve loglar, şifreli |

---

## 📖 Belgeler

- [**Squad admin komutları**](./docs/ADMIN_KOMUTLARI_TR.md) - kick, ban, uyarı, harita değiştirme, Admins.cfg ve admin kamera tuşları
- [**Rehber**](./docs/KURULUM_TR.md) - sıfırdan kurulum, her sayfa, her ayar, sorun giderme
- [**Değişiklikler**](./CHANGELOG.md)
- [**Katkı**](./CONTRIBUTING.md)
- [**Güvenlik**](./SECURITY.md)

---

## 🧭 Yol haritası

- [ ] Oyunculu gerçek maçta test
- [ ] Daha kolay uzaktan giriş ve ilk `admin` hesabı yerine kurulum kodu
- [ ] Bir hesabın kısa sürede atabileceği kick ve ban sayısına sınır

Hiçbiri söz değildir. Bu kişisel bir proje.

---

## ❓ SSS

<details>
<summary><b>Squad admin komutlarını tarayıcıdan kullanabilir miyim?</b></summary>

Günlük olanları evet: kick, ban, uyarı, duyuru, takım değiştirme, squad'dan çıkarma, harita değiştirme, sıradaki harita, maçı bitirme ve yeniden başlatma. Hangi butonun hangi komutu gönderdiği [Squad admin komutları](./docs/ADMIN_KOMUTLARI_TR.md) sayfasında.

</details>

<details>
<summary><b>BattleMetrics ya da başka bir RCON servisi gerekli mi?</b></summary>

Hayır. Panel kendi sunucunda çalışır, oyunla SquadJS üzerinden konuşur. Ücretli bir servisin kopyası değildir: örneğin topluluklar arası ortak ban listesi yoktur.

</details>

<details>
<summary><b>Admins.cfg dosyasını değiştiriyor mu, admin kamerası var mı?</b></summary>

Hayır. Panel hesapları `Admins.cfg`'den ayrıdır, admin kamerası da oyunun kendi özelliğidir. İkisi de [komut sayfasında](./docs/ADMIN_KOMUTLARI_TR.md#adminscfg-admin-nasıl-eklenir) anlatılıyor.

</details>

<details>
<summary><b>Gerçekten ücretsiz mi?</b></summary>

Evet. AGPL-3.0 açık kaynak, ücretli sürüm ve hesap yok.

</details>

<details>
<summary><b>Skor tablosunda neden puan ve ping yok?</b></summary>

Squad bunları ne RCON ile ne logda veriyor.

</details>

<details>
<summary><b>Commander nasıl anlaşılıyor?</b></summary>

Oyuncu listesinde commander bilgisi yok. Panel "Command Squad" adlı squad'ın liderini commander sayar. Bu adı herkes kullanabilir; aynı takımda iki tane varsa küçük numaralı sayılır ve panel uyarır. Gerçek maçta henüz doğrulanmadı.

</details>

<details>
<summary><b>Neler henüz denenmedi?</b></summary>

Uyarı, kick, ban, takım değiştirme ve squad'dan çıkarma gerçek oyuncuya karşı denenmedi. Squad dağıtma gerçek sunucuda çalıştırılmadı. Hasar sayısı gerçek maç loguyla karşılaştırılmadı. 1.1.0 ile gelen ve gerçek oyun sunucusunda henüz denenmeyenler: commander düşürme, butonla squad dağıtma, çıkmış oyuncuyu banlama, oyuncu ve sıra sınırı, sunucu parolası. Gerçek bir Discord kanalına henüz mesaj gönderilmedi. 1.2.0 ile gelenler: Kill Feed yalnızca emüle edilmiş oyun logu gördü; silah adları ve sayıları gerçek bir maçla henüz karşılaştırılmadı. İki hatırlatma butonu gerçek oyunculara henüz ulaşmadı.

</details>

---

## 🤝 Katkı

Katkılar açıktır. Önce [CONTRIBUTING.md](./CONTRIBUTING.md) ve [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) dosyalarını oku.

<div align="center">
<a href="https://github.com/Miabeyefendi/Squad-AdminPanel/issues/new?template=bug_report.yml">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/btn-report-bug-dark.svg">
    <img src="./assets/btn-report-bug.svg" height="52" alt="Hata bildir">
  </picture>
</a>
<a href="https://github.com/Miabeyefendi/Squad-AdminPanel/stargazers">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/btn-star-dark.svg">
    <img src="./assets/btn-star.svg" height="52" alt="Depoya yıldız ver">
  </picture>
</a>
</div>

---

## 🙏 Emeği geçenler

- [**SquadJS**](https://github.com/Team-Silver-Sphere/SquadJS), Team Silver Sphere (Boost Software License) - eklentinin içinde çalıştığı altyapı; RCON, log okuma ve layer listesi ondan gelir.
- [**Smart Shuffle**](https://github.com/Miabeyefendi/Squad-SmartShuffle) - kendi takım dengeleme eklentim, `admin-panel/smart-shuffle/` içinde kendi LICENSE ve NOTICE dosyalarıyla.
- Ekran görüntülerindeki resimler: harita görselleri [Squad Wiki Pipeline](https://github.com/Squad-Wiki/squad-wiki-pipeline-map-data) (CC BY-SA 4.0, küçültülmüş), faction bayrakları [SquadCalc](https://github.com/sh4rkman/SquadCalc). Squad oyun içeriği Offworld Industries'e aittir. Oynanan maçın manzara görselleri ile Black Coast, Harju, Pacific Proving Grounds ve Sanxian üstten haritaları: [Squad Wiki](https://squad.fandom.com/wiki/Maps) (küçültülmüş, bazıları 16:9 kırpılmış).

---

## 🛡️ Güvenlik

- Parolalar yalnızca tuzlanmış scrypt özeti olarak saklanır; yanlış denemeler artan süreyle engellenir.
- Hesaplar, kayıtlar, kurallar ve loglar AES-256-GCM ile şifrelidir.
- Sıkı Content-Security-Policy, siteler arası istek reddi, host adı kontrolü, RCON ve `config.json`'a giden her değerin denetimi.
- **Bilmen gereken sınır:** sunucundaki dosyaları okuyup değiştirebilen biri paneli ele geçirebilir. Sunucu parolanı koru ve moderatörlere verme.

Açık bulursan herkese açık issue açma, [SECURITY.md](./SECURITY.md) dosyasını izle.

---

## 📜 Lisans

**GNU Affero General Public License v3.0 (AGPL-3.0)** ve [NOTICE](./NOTICE) dosyasındaki ek şartlar. Kısaca:

- Tüm kaynak kodu AGPL-3.0 altında açık tuttuğun (barındırılan ve ağ üzerinden kullanım dahil, Bölüm 13) ve aşağıdaki atfı koruduğun sürece kullanabilir, değiştirebilir, dağıtabilir, hatta para kazanabilirsin.
- Kapalı kaynak ürün ya da kapalı SaaS için **ayrı yazılı ticari lisans** gerekir. Bkz. [NOTICE](./NOTICE), Bölüm 8.

### Atıf (zorunlu)

> **Miabeyefendi (Mustafa İhsan Albayrak)** - https://github.com/Miabeyefendi

### Sorumluluk reddi

Yazılım "olduğu gibi", garanti olmadan sunulur. Kullanım tamamen kendi riskindedir. Bu resmi olmayan bir araçtır; Offworld Industries ya da SquadJS yazarlarıyla bağlantılı veya onlar tarafından onaylı değildir. Ayrıntılar [LICENSE](./LICENSE) ve [NOTICE](./NOTICE) dosyalarında.

---

## 📬 İletişim

- GitHub: [@miabeyefendi](https://github.com/Miabeyefendi)
- Ticari lisans için GitHub profilimden ulaş.

<div align="center">
<br/>
<img src="./assets/divider.svg" width="100%" height="3" alt="">
<br/>
<sub>Built by <b><a href="https://github.com/Miabeyefendi">Miabeyefendi</a></b></sub>
</div>
