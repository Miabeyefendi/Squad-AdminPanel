# Squad admin komutları

Squad sunucusunun admin komutları: ne işe yarar, nasıl yazılır, `Admins.cfg` içinde hangi yetkiyi ister ve [Squad Admin Panel](../README_TR.md) içinde aynı işi hangi buton yapar.

[English](./ADMIN_COMMANDS.md) · **Türkçe**

Sözdizimi ve yetkiler Squad Wiki'nin [Server Administration](https://squad.fandom.com/wiki/Server_Administration) sayfasına göredir. Oyun güncellemelerle değişir: kendi sürümündeki komutları görmek için konsola `ListCommands 1` yaz.

## Admin komutu nasıl girilir

- **Oyun içinde:** konsolu aç ve komutu yaz. `Admins.cfg` içinde ilgili yetkin olmalı.
- **RCON ile:** bir RCON aracından gönder. RCON tam yetkilidir, parolasını kimseye verme.
- **Tarayıcıdan:** panelde aşağıda yazan butona bas, komutu SquadJS üzerinden panel gönderir.

`<Id>`, `ListPlayers` komutunun gösterdiği oyuncu numarasıdır. `<NameOrSteamId>` oyuncu adı ya da SteamID64 alır.

## Kick, ban ve uyarı

| Komut | Ne yapar | Yetki | Panelde |
|---|---|---|---|
| `AdminKick <NameOrSteamId> <Sebep>` | Oyuncuyu atar | `kick` | Oyuncu kartı, **Kick** |
| `AdminKickById <Id> <Sebep>` | Numarayla atar | `kick` | aynı |
| `AdminBan <NameOrSteamId> <Süre> <Sebep>` | Banlar. Süre: `0` kalıcı, `1d` 1 gün, `1M` 1 ay | `ban` | Oyuncu kartı, **Ban** (1 saat, 1 gün, 7 gün, 30 gün, kalıcı) |
| `AdminBanById <Id> <Süre> <Sebep>` | Numarayla banlar | `ban` | aynı |
| `AdminWarn <NameOrSteamId> <Sebep>` | Oyuncunun ekranına uyarı | `kick` | **Warn** ya da **Message** |
| `AdminWarnById <Id> <Sebep>` | Numarayla uyarır | `kick` | aynı |
| `AdminListDisconnectedPlayers` | Yeni çıkan oyuncular | `kick` | **Players & squads**, Recently left (bu komutla değil, panelin kendi logundan) |

## Squad, takım ve commander

| Komut | Ne yapar | Yetki | Panelde |
|---|---|---|---|
| `AdminForceTeamChange <NameOrSteamId>` | Karşı takıma geçirir | `forceteamchange` | **Move team** |
| `AdminForceTeamChangeById <Id>` | Numarayla geçirir | `forceteamchange` | aynı |
| `AdminRemovePlayerFromSquad <İsim>` | Squad'dan çıkarır | `kick` | **Remove from squad** |
| `AdminRemovePlayerFromSquadById <Id>` | Numarayla çıkarır | `kick` | aynı |
| `AdminDisbandSquad <1 ya da 2> <SquadNo>` | O takımdaki squad'ı dağıtır | `kick` | squad başlığında **Disband** ve kilitli squad kuralı; gerçek sunucuda denenmedi |
| `AdminDemoteCommander <İsim>` | Commander'ı düşürür | `kick` | Commander'ın oyuncu kartı, **Demote commander** (`ById` biçimini gönderir, gerçek sunucuda denenmedi) |

## Mesaj

| Komut | Ne yapar | Yetki | Panelde |
|---|---|---|---|
| `AdminBroadcast <Mesaj>` | Herkese duyuru | `chat` | **Send message**, Everyone |
| `ChatToAdmin <Mesaj>` | Admin chat (oyun içi) | `chat` | admin chat canlı chat'te görünür |

## Harita değiştirme ve maç kontrolü

| Komut | Ne yapar | Yetki | Panelde |
|---|---|---|---|
| `AdminChangeLayer <Layer>` | Haritayı hemen değiştirir | `changemap` | **Map**, Change now |
| `AdminSetNextLayer <Layer>` | Sıradaki haritayı ayarlar | `changemap` | **Map**, Set as next |
| `AdminEndMatch` | Maçı bitirir | `pause` | **End match** |
| `AdminRestartMatch` | Maçı yeniden başlatır | `pause` | **Restart match** |
| `AdminPauseMatch` / `AdminUnpauseMatch` | Duraklatır, devam ettirir | `pause` | panelde yok |

Layer adı harita, mod ve versiyonun birlikte yazılışıdır: `Narva_RAAS_v1`. Güncel sürümlerde arkasına faction yazılabilir; panelin harita ekranı bu satırı senin yerine kurar.

## Sunucu ayarları

| Komut | Ne yapar | Yetki | Panelde |
|---|---|---|---|
| `AdminSetMaxNumPlayers <Sayı>` | Oyuncu sınırı | `config` | **Server**, Player limits |
| `AdminSetPublicQueueLimit <Sayı>` | Sıra sınırı; `-1` sınırsız | `config` | **Server**, Player limits |
| `AdminSetServerPassword <Parola>` | Sunucu parolası, `""` ile kaldırılır | `private` | **Server**, Server password |
| `AdminSlomo <Hız>` | Oyun hızı, `1` normal | `cheat` | panelde yok |

## Yetki istemeyen komutlar

| Komut | Ne gösterir |
|---|---|
| `ListPlayers` | Oyuncular, numaraları ve kimlikleri |
| `ListSquads` | Squad'lar ve numaraları |
| `ShowNextMap` | Sıradaki harita |
| `ListCommands 1` | Sürümündeki tüm komutlar |
| `ListPermittedCommands 1` | Kullanabileceğin komutlar |

## Admins.cfg: admin nasıl eklenir

Dosya `SquadGame/ServerConfig/Admins.cfg`. Önce yetkileriyle bir grup yaz, sonra her admini SteamID64 ile ekle:

```
Group=Admin:changemap,balance,chat,kick,ban,cameraman,pause
Group=Moderator:changemap,chat,kick,ban

Admin=<SteamID64>:Admin
Admin=<SteamID64>:Moderator
```

Panelin hesapları ve yetkileri ayrıdır: tarayıcıda kimin ne yapabileceğini belirler. Panel `Admins.cfg` dosyasını değiştirmez.

## Admin kamera kontrolleri

Admin kamerası oyunun kendi özelliğidir ve `cameraman` yetkisi ister. Panelde kamera yoktur.

| Tuş | İşlev |
|---|---|
| `Shift` + `P` | Kamerayı aç, kapat |
| `W` `A` `S` `D`, fare | Hareket ve bakış |
| `Space` / `Ctrl` | Yukarı / aşağı |
| `1`, `2`, `3` ile fare tekeri | Uçuş hızı, görüş açısı, yavaşlama |
| `5` - `9` | Katmanlar: FOB ve rally, bölge, oyuncu dış çizgisi, oyuncu işaretleri, isimler |

---

**Squad Admin Panel**, yukarıdaki günlük komutları butona çeviren ücretsiz ve açık kaynak bir SquadJS eklentisidir: canlı skor tablosu, squad'lar ve chat, loglar, admin yetkileri. [Kurulum](./KURULUM_TR.md) · [Depo](https://github.com/Miabeyefendi/Squad-AdminPanel)

Bu resmi olmayan bir sayfadır, Offworld Industries ile bağlantısı yoktur.
