<div align="center">

<img src="./assets/banner.png" width="92%" alt="Squad Admin Panel: free and open source web admin panel for Squad servers">

# Squad Admin Panel

**Panel de administración y herramienta RCON, gratuita y de código abierto, para servidores dedicados de Squad. Funciona como plugin de SquadJS: expulsa, banea, avisa y cambia el mapa desde el navegador sin escribir comandos de admin, con marcador en vivo, escuadras y chat, permisos, registros y equilibrio de equipos (Smart Shuffle).**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-A78BFA?style=for-the-badge&logo=gnu&logoColor=white)](./LICENSE)
[![Version](https://img.shields.io/github/v/release/Miabeyefendi/Squad-AdminPanel?style=for-the-badge&color=F59E0B&label=version)](https://github.com/Miabeyefendi/Squad-AdminPanel/releases/latest)
[![Platform](https://img.shields.io/badge/SquadJS_plugin-1E293B?style=for-the-badge&logo=nodedotjs&logoColor=white)](#-instalación)
[![Status](https://img.shields.io/badge/status-active-22C55E?style=for-the-badge)](#-hoja-de-ruta)
[![Author](https://img.shields.io/badge/by-Miabeyefendi-0EA5E9?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Miabeyefendi)

[English](./README.md) · [Türkçe](./README_TR.md) · **Español** · [简体中文](./README_ZH.md) · [Русский](./README_RU.md)

[Instalar](#-instalación) · [Funciones](#-lo-más-destacado) · [Inicio rápido](#-inicio-rápido) · [Tutorial (inglés)](./docs/SETUP.md) · [Cambios](./CHANGELOG.md)

<a href="https://github.com/Miabeyefendi/Squad-AdminPanel/releases/latest">
  <img src="./assets/btn-download.svg" height="52" alt="Descargar la última versión">
</a>
<a href="./docs/SETUP.md">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/btn-tutorial-dark.svg">
    <img src="./assets/btn-tutorial.svg" height="52" alt="Leer la guía de instalación">
  </picture>
</a>

<img src="./screenshots/overview-dark.png" width="92%" alt="Resumen del panel: mapa actual, tickets de los equipos, jugadores que piden un admin y comandantes">

</div>

> **Todavía no se ha probado en una partida con jugadores.** Probado con pruebas automáticas, con SquadJS real contra un juego simulado y por RCON real en un servidor Squad v10.6.3 vacío (una versión anterior).

---

## 🎬 En acción

<div align="center">
  <img src="./screenshots/demo.gif" width="92%" alt="Recorrido animado por Squad Admin Panel: resumen, marcador, escuadras y chat, ficha de jugador, mapas, Smart Shuffle, plugins, permisos e historial">
  <br/>
  <sub><b>Recorrido por el panel</b> · nueve pantallas, datos de demo</sub>
</div>

---

## ✨ Lo más destacado

- **Marcador en vivo** - los dos equipos lado a lado: bajas, derribos, muertes, K/D, reanimaciones, fuego amigo, daño y número de escuadra
- **Jugadores y escuadras** - listas junto al chat en vivo y mensaje privado en pantalla a un jugador
- **Acciones de admin** - avisar, expulsar, banear, cambiar de equipo, sacar de la escuadra, siempre con confirmación
- **Control de mapas** - mapa, modo, versión, facciones y unidades; siguiente capa o cambio inmediato
- **Smart Shuffle incluido** - equilibrio de equipos con 11 ajustes predefinidos, sin reiniciar
- **Permisos** - dueño, admin, moderador sénior y júnior, comprobados en el servidor
- **Historial y registros** - avisos, expulsiones, baneos y notas que sobreviven a los reinicios; exportación CSV
- **Reglas automáticas** - todas desactivadas al principio
- **Gestor de plugins de SquadJS** - activa y configura otros plugins desde el navegador
- **Autoalojado** - sin cuentas ni nube, sin paquetes npm adicionales, datos cifrados

---

## 📦 Instalación

### Requisitos

| | |
|---|---|
| Servidor Squad | Con RCON activado, o alojado con RCON y registros por FTP o SFTP |
| [SquadJS](https://github.com/Team-Silver-Sphere/SquadJS) | Última versión, probado con 4.1.0 |
| Node.js | 18 o superior. El panel se probó con Node 24 y 26, no con 18 |
| Navegador | Chrome, Edge o Firefox actual |

### Creado con

![JavaScript](https://img.shields.io/badge/JavaScript-1E293B?style=for-the-badge&logo=javascript&logoColor=A78BFA)
![Node.js](https://img.shields.io/badge/Node.js-1E293B?style=for-the-badge&logo=nodedotjs&logoColor=A78BFA)

### Instalar

1. Descarga `Squad-AdminPanel-v1.0.0.zip` de la [página de versiones](https://github.com/Miabeyefendi/Squad-AdminPanel/releases/latest).
2. Extrae `admin-panel.js` y la carpeta `admin-panel` en `squad-server/plugins/` de SquadJS.
3. Añade a la lista `plugins` de `config.json`:

   ```json
   { "plugin": "AdminPanel", "enabled": true, "port": 8170 }
   ```

4. Reinicia SquadJS. Debe aparecer `Admin panel on http://127.0.0.1:8170`.

<details>
<summary><b>Sobre el archivo de la versión</b></summary>

El zip es una copia de `src/squadjs/` (tag `v1.0.0`) con `LICENSE` y `NOTICE` dentro de `admin-panel/`. No hay compilación ni código minificado.

SHA-256 de `Squad-AdminPanel-v1.0.0.zip`:

```
804c8b6210586f9fe7dad42c4ddf0527a5a22f91e4a699e141de704c67c47af5
```

</details>

---

## 🚀 Inicio rápido

1. **En la máquina donde corre SquadJS**, abre `http://127.0.0.1:8170`.
2. Entra con `admin` / `admin`; el panel se abre. Un aviso permanece arriba hasta que pongas tu contraseña en **My account**.
3. Hazlo **antes** de poner un proxy o túnel delante del panel.

El acceso remoto se explica en el [tutorial](./docs/SETUP.md#remote-access-and-more-admins).

---

## 🖼️ Capturas

Nombres y cifras son de la demo. Las imágenes de mapas y facciones de estas capturas no vienen en la descarga: se añadieron en la carpeta de imágenes del panel (ver Créditos). Sin ellas el panel dibuja las suyas.

<table>
<tr>
  <td align="center" width="50%">
    <img src="./screenshots/scoreboard-dark.png" width="100%" alt="Squad scoreboard with both teams side by side, commander strips, squad numbers and match statistics"/><br/>
    <sub><b>Marcador</b> · columnas fijas</sub>
  </td>
  <td align="center" width="50%">
    <img src="./screenshots/players-and-chat-light.png" width="100%" alt="Squad lists of both teams next to the live in-game chat"/><br/>
    <sub><b>Jugadores y chat</b> · responde a uno</sub>
  </td>
</tr>
<tr>
  <td align="center" width="50%">
    <img src="./screenshots/map-picker-light.png" width="100%" alt="Squad map picker with map cards, mode, version and faction choice"/><br/>
    <sub><b>Mapas</b> · siguiente o ahora</sub>
  </td>
  <td align="center" width="50%">
    <img src="./screenshots/smart-shuffle-dark.png" width="100%" alt="Smart Shuffle team balance controls, switches and presets"/><br/>
    <sub><b>Smart Shuffle</b> · equilibrio sin reiniciar</sub>
  </td>
</tr>
<tr>
  <td align="center" width="50%">
    <img src="./screenshots/staff-permissions-dark.png" width="100%" alt="Staff page with admin accounts and a permission table"/><br/>
    <sub><b>Permisos</b> · qué puede cada admin</sub>
  </td>
  <td align="center" width="50%">
    <img src="./screenshots/plugins-light.png" width="100%" alt="SquadJS plugin manager with the plugin list and its settings"/><br/>
    <sub><b>Plugins</b> · ajustes como formulario</sub>
  </td>
</tr>
<tr>
  <td align="center" width="50%">
    <img src="./screenshots/player-records-dark.png" width="100%" alt="Timeline of warnings, kicks, bans and notes on players"/><br/>
    <sub><b>Historial</b> · avisos, expulsiones, baneos y notas</sub>
  </td>
  <td align="center" width="50%">
    <img src="./screenshots/automatic-rules-light.png" width="100%" alt="Automatic server rules with plain language summaries"/><br/>
    <sub><b>Reglas</b> · cada una dice qué hará</sub>
  </td>
</tr>
<tr>
  <td align="center" width="50%"><img src="./screenshots/player-card-dark.png" width="100%" alt="Player card with match numbers, warning history, notes and the kick and ban buttons"/><br/><sub><b>Ficha de jugador</b> · historial, notas, acciones</sub></td>
  <td align="center" width="50%"><img src="./screenshots/overview-light.png" width="100%" alt="Overview page in the light theme"/><br/><sub><b>Tema claro</b> · sigue al sistema</sub></td>
</tr>
<tr>
  <td align="center" width="50%"><img src="./screenshots/logs-dark.png" width="100%" alt="Server logs: kills with weapon, filtered by period, with CSV export"/><br/><sub><b>Registros</b> · cualquier periodo, CSV</sub></td>
  <td align="center" width="50%"><img src="./screenshots/delete-records-dark.png" width="100%" alt="Deleting records: warning banner and a preview of what would be removed"/><br/><sub><b>Borrado seguro</b> · vista previa primero</sub></td>
</tr>
<tr>
  <td align="center" width="50%"><img src="./screenshots/smart-shuffle-settings-dark.png" width="100%" alt="Smart Shuffle settings grouped by topic"/><br/><sub><b>Ajustes de Shuffle</b> · grupo a grupo</sub></td>
  <td align="center" width="50%"><img src="./screenshots/ranks-dark.png" width="100%" alt="Default permissions of admin, senior mod and junior mod side by side"/><br/><sub><b>Rangos</b> · permisos lado a lado</sub></td>
</tr>
<tr>
  <td align="center" width="50%"><img src="./screenshots/phone-overview-dark.png" width="55%" alt="The overview page on a phone"/><br/><sub><b>En el móvil</b> · resumen</sub></td>
  <td align="center" width="50%"><img src="./screenshots/phone-players-dark.png" width="55%" alt="Squad lists on a phone"/><br/><sub><b>En el móvil</b> · escuadras</sub></td>
</tr>
</table>

---

## ⚙️ Configuración

Los ajustes van en la línea `AdminPanel` de `config.json`. **No pongas contraseñas ahí:** SquadJS envía las opciones de los plugins a su propio servicio. Todas las opciones están en el [tutorial](./docs/SETUP.md#️-configuration-reference).

| Clave | Por defecto | Qué hace |
|---|---|---|
| `port` | `8170` | Puerto del panel |
| `host` | `127.0.0.1` | No lo cambies; usa proxy o túnel |
| `allowedHosts` | `[]` | Nombres de host adicionales |
| `secureCookie`, `trustProxy` | `false` | Actívalos tras un proxy HTTPS en la misma máquina |
| `retentionDays` | `90` | Días que se guardan los registros, 0 para siempre |
| `dataDir` | `./admin-panel-data` | Cuentas, historial, reglas y registros, cifrados |

---

## 📖 Documentación

- [**Comandos de admin de Squad**](./docs/ADMIN_COMMANDS.md) (inglés)
- [**Tutorial**](./docs/SETUP.md) (inglés)
- [**Cambios**](./CHANGELOG.md)
- [**Contribuir**](./CONTRIBUTING.md)
- [**Seguridad**](./SECURITY.md)

---

## 🧭 Hoja de ruta

- [ ] Pruebas en una partida real con jugadores
- [ ] Acceso remoto más sencillo y código de instalación en lugar de la primera cuenta `admin`
- [ ] Límites de expulsiones y baneos por cuenta

Nada de esto es una promesa.

---

## ❓ Preguntas frecuentes

<details>
<summary><b>¿Puedo usar los comandos de admin de Squad desde el navegador?</b></summary>

Sí, los del día a día: expulsar, banear, avisar, anunciar, cambiar de equipo, sacar de la escuadra, cambiar de mapa, siguiente capa y terminar o reiniciar la partida. Véase la [referencia de comandos](./docs/ADMIN_COMMANDS.md) (en inglés).

</details>

<details>
<summary><b>¿Necesito BattleMetrics u otro servicio RCON?</b></summary>

No. El panel corre en tu servidor y habla con el juego mediante SquadJS. No copia ningún servicio de pago: por ejemplo, no tiene listas de baneos compartidas entre comunidades.

</details>

<details>
<summary><b>¿Edita Admins.cfg o tiene cámara de admin?</b></summary>

No. Las cuentas del panel son independientes de `Admins.cfg` y la cámara de admin es parte del juego. La [referencia](./docs/ADMIN_COMMANDS.md#adminscfg-how-to-add-an-admin) explica ambas.

</details>

<details>
<summary><b>¿Es realmente gratis?</b></summary>

Sí, es código abierto bajo AGPL-3.0.

</details>

<details>
<summary><b>¿Por qué no hay puntuación ni ping?</b></summary>

Squad no los envía por RCON ni los escribe en el registro.

</details>

<details>
<summary><b>¿Cómo sabe quién es el comandante?</b></summary>

La lista de jugadores no lo indica. El panel toma al líder de la escuadra "Command Squad". Cualquiera puede usar ese nombre; si hay dos en un equipo cuenta el número menor y el panel avisa. Sin confirmar en una partida real.

</details>

<details>
<summary><b>¿Qué no está probado?</b></summary>

Las acciones sobre jugadores reales, disolver escuadras y las cifras de daño en una partida real.

</details>

---

## 🤝 Contribuir

Lee [CONTRIBUTING.md](./CONTRIBUTING.md) y [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

<div align="center">
<a href="https://github.com/Miabeyefendi/Squad-AdminPanel/issues/new?template=bug_report.yml">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/btn-report-bug-dark.svg">
    <img src="./assets/btn-report-bug.svg" height="52" alt="Informar de un error">
  </picture>
</a>
<a href="https://github.com/Miabeyefendi/Squad-AdminPanel/stargazers">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/btn-star-dark.svg">
    <img src="./assets/btn-star.svg" height="52" alt="Dar una estrella">
  </picture>
</a>
</div>

---

## 🙏 Créditos

- [**SquadJS**](https://github.com/Team-Silver-Sphere/SquadJS) de Team Silver Sphere (Boost Software License), la base donde corre el plugin.
- [**Smart Shuffle**](https://github.com/Miabeyefendi/Squad-SmartShuffle), mi plugin de equilibrio, incluido con su LICENSE y NOTICE.
- Imágenes de las capturas: mapas de [Squad Wiki Pipeline](https://github.com/Squad-Wiki/squad-wiki-pipeline-map-data) (CC BY-SA 4.0, redimensionados) y banderas de [SquadCalc](https://github.com/sh4rkman/SquadCalc). El contenido del juego Squad pertenece a Offworld Industries. Imágenes de paisaje de la partida en curso y mapas cenitales de Black Coast, Harju, Pacific Proving Grounds y Sanxian: [Squad Wiki](https://squad.fandom.com/wiki/Maps) (redimensionadas, algunas recortadas a 16:9).

---

## 🛡️ Seguridad

- Contraseñas guardadas solo como hash scrypt con sal; los intentos fallidos se bloquean.
- Datos cifrados con AES-256-GCM.
- **Límite importante:** quien pueda leer y cambiar archivos en tu servidor puede tomar el panel. No des el acceso del servidor a moderadores.

Para vulnerabilidades, sigue [SECURITY.md](./SECURITY.md).

---

## 📜 Licencia

**GNU AGPL-3.0** con los términos adicionales de [NOTICE](./NOTICE). Puedes usarlo, modificarlo y ganar dinero con él si mantienes el código fuente completo bajo AGPL-3.0, también en uso por red (sección 13), y conservas la atribución. Para un producto cerrado se necesita una licencia comercial escrita (NOTICE, sección 8).

### Atribución (obligatoria)

> **Miabeyefendi (Mustafa Ihsan Albayrak)** - https://github.com/Miabeyefendi

### Descargo

Se ofrece "tal cual", sin garantía y bajo tu propio riesgo. Es una herramienta no oficial, sin relación con Offworld Industries ni con los autores de SquadJS. Véanse [LICENSE](./LICENSE) y [NOTICE](./NOTICE).

---

## 📬 Contacto

- GitHub: [@miabeyefendi](https://github.com/Miabeyefendi)

<div align="center">
<br/>
<img src="./assets/divider.svg" width="100%" height="3" alt="">
<br/>
<sub>Built by <b><a href="https://github.com/Miabeyefendi">Miabeyefendi</a></b></sub>
</div>
