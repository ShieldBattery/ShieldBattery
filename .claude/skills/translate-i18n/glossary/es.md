# Spanish translation glossary (es)

Per-language term decisions for `es`. Read alongside the common [glossary.md](../glossary.md) (how to use the
glossary and `terms/`, brand/proper nouns, register, general rules) and look terms up with
`pnpm run i18n terms es <query>`. Add new decisions here, under the right heading.

### es
- **Common action buttons:** Stop (playback)→**Detener**, Hide→**Ocultar**,
  Reveal (masked information)→**Mostrar**, Join (channel/league/lobby)→**Unirse**.
  Use infinitives for action labels, consistent with Aceptar, Guardar, and Cancelar.
- **Clear (action) → Borrar**, **Clear filters → Borrar filtros** for consistent filter and
  notification actions. "Claro" expresses clarity or agreement, not clearing. "Limpiar filtros"
  is also idiomatic; use "Borrar filtros" consistently in this UI. Reset→**Restablecer** for
  restoring settings or defaults.
- Register: informal **tú** (matches the existing file: Introduce, Selecciona, tu instalación).
- **news post → noticia** (Noticia creada, Crear noticia); required-field validation follows the
  in-file "Introduce …" imperative style. Statuses agree with feminine "noticia"
  (Publicada/Programada/Creada/Editada).
- **link → enlace** in new strings (dominant in-file: 5× enlace vs 2× link; matches
  "Copiar enlace a la liga").
- Team sizes use the **`1x1` / `2x2` / `3x3`** format (the `x` convention, per the term export).
- Map names kept in recognized English forms: **Fastest, Hunters, Big Game Hunters, BGH** (the export
  keeps "Fastest" English).
- In-file term renderings to match: matchmaking→Emparejamiento, map pool→Grupo de mapas, queue→cola,
  ladder→escalera, veto→vetar/vetado, ban→banear, kick→expulsar, unrated→Sin clasificar.
  Lobby removal dialogs: titles **Expulsado/Baneado del lobby**, bodies "Te expulsaron/banearon de
  {{lobbyName}}". **slot actions → Acciones del espacio** (old MT had "tragamonedas", a slot machine).
- **Replay library terms:** replay→replay (loanword, in-file), **playlist→playlist** (loanword,
  feminine: la playlist; Spotify-style), **bookmark/Bookmarked→marcador/Marcadores** (Añadir
  marcador/Quitar marcador; the replay bookmark — kept distinct from a map's favorite),
  **library→biblioteca**, game (a played match)→partida, **spoiler-free→Sin spoilers**.
- **Lobby terms:** lobby→lobby (loanword, masculine: el lobby, lleno), **bench (waiting members) →
  banquillo** (the sports substitutes' bench), observer (spectator)→observador,
  host (person)→anfitrión, slot→espacio ("Espacios libres"; slot rows use Abierto/Cerrado).
- **color override(s) → reemplazo (de colores)** (noun; verb reemplazar). On/Off mode options use
  Activado/Desactivado. Color scheme→esquema de colores.
- **video → video** (sin tilde, LatAm form; matches the in-file settings "Video" title).
- **Recycle Bin → Papelera de reciclaje** (the Windows name). **resolve (game results) →
  resolver**; Disputed status chip → En disputa; Manually resolved chip → Resolución manual
  (noun form dodges the juego/partida gender clash).
- **Home (nav) → Inicio** (fixed from old MT "Hogar"); social Chat tab label → **Chat** (noun, not
  "Charlar").
- **join code → código** (Introducir código / Introduce este código; no qualifier needed — context
  carries it). **the app (desktop client) → la app** (feminine: instalada). Buttons use the
  infinitive (Introducir código), inline prompts use tú imperative (Introduce este código).
- Old MT rendered slot as "ranura" in the lobby strings — fixed to **espacio** (Espacios,
  Abrir/Cerrar espacio). Watch for "ranura" resurfacing.
- **Game defaults preset (first-run dialog / Settings › Game › Defaults):** Recommended→**Recomendado**,
  Legacy→**Clásico** everywhere (starting fog option, unit limit, preset; the old MT "Legado" means a
  bequest and was replaced), preset→preajuste, Defaults page→**Predeterminados**, starting fog→**niebla inicial**, drag
  pan→**arrastre de cámara** (in-file), Settings nav→**Ajustes** (never "Configuración" in paths).
- **Chat commands:** whisper→susurro/susurrar, /me action line→acción, aliases→alias, channel/lobby/whisper
  surfaces→canales/lobbies/susurros; mute channel→**Silenciar canal**; "only you" gutter→**solo tú**.
- **Chat command lines:** `/help` descriptions are third-person present ("Bloquea a un usuario: …");
  result lines addressed to the invoker use tú preterite ("Bloqueaste a X."); errors keep the
  "No se pudo …: {{errorMessage}}" shape. online/offline→**conectado/desconectado** (never "en
  línea"); presence words active/idle/offline→**activo/ausente/desconectado**. friend
  request→solicitud de amistad, unfriend→quitar de tus amigos, unblock→desbloquear, unban→desbanear.
- **Server-settled outcome lines** (`/flip`, `/roll`, `/8ball`, `/quote`) render right after a bare
  username, so they are subject-less third-person verbs: "lanza una moneda: …", "saca {{value}}
  (1-{{max}})", "le pregunta a la bola 8 \"…\"", "cita a <unidad>: \"…\"" (no article — units are
  mixed gender). 8-ball→**bola 8**; heads/tails→**cara/cruz**; answers follow the classic Spanish
  toy wordings and stay short (uppercase nowrap chip).
- **Unit names come from the es term export** (`pnpm run i18n terms es <Unit>`): **VCE** for SCV,
  Médica, Zelot, Dragún, Portanaves, Ánima, … — don't keep the English names.
- **Key names in keyboard/screen-reader text:** Space→**la barra espaciadora** (never "Espacio",
  which is the slot noun), Escape→Escape, arrow keys→las flechas.
- **Lobby room:** unit limit→**Límite de unidades** (values Ampliado / Clásico); the "Teams" stat
  label→**Equipos**; computer player→computadora; "once it regroups"→"cuando todos vuelvan al
  lobby". Series: one game→**partida**, the tiny chip `G{{number}}`→**P{{number}}**, the in-progress
  chip→**En curso** (siblings Pendiente / Iniciando). The arrival card's seat line is third person
  and verb-initial like `seatedOn` "ocupa {{seat}}" → observer arrival = "ocupa un espacio de
  observador". Hold buttons spell out the verb: "Mantén pulsado para empezar". "ready reset"→"se
  reinició el estado de listo".
- **reply (message) → responder** ("Respondiendo a X" / "Dejar de responder"); distinct from `/r`,
  which answers a whisper.
- **User card:** "{{count}} partidas · {{wins}}–{{losses}}"; Unranked/Unrated→**Sin clasificar**
  everywhere (the old "Sin rango" was folded in); Profile button→**Perfil**; the profile stat label
  Record→**Victorias/derrotas** (not "Registro").
- **Plurals:** the `many` form takes **de** before the noun ("{{count}} de partidas"); when no noun
  follows the count, `many` equals `other` ("y {{count}} más").
- **Day divider (`messaging.newDayMessage`) is just the date** ("<2>{{day}}</2>"): it renders
  between two rules, so "Día cambiado a" was redundant. The channel-join divider is "Te uniste a
  <2><0></0></2>" (the old MT dropped the "a").
- **Availability (user status):** Online/Away/Do not disturb→**Conectado / Ausente / No molestar**;
  picker label→Disponibilidad; "status"→estado.
- **Matchmaking match→partido** (in-file ~10×: Partido encontrado, Buscando un partido); a played
  game→partida. Don't put both in one sentence or dialog: the match-canceled dialog says "partido"
  throughout, even for "the game couldn't start".
- **User card emblem label** Unranked→**Sin rango** (60px box; "Sin clasificar" truncates there).
  Elsewhere Unranked stays Sin clasificar. "Hosted by <1></1>"→**Anfitrión: <1></1>**.
- **Private channels:** private channel→**canal privado**, invite link→**enlace de invitación**,
  channel owner→**propietario del canal** (matches /topic; the older ban error says dueño),
  channel moderator→**moderador del canal**, member→**miembro**. Chat display modes
  Classic/Cozy→**Clásico / Cómodo** (Discord's Spanish "Cómodo" for Cozy).
- **Rollback netcode:** rollback→**rollback** (loanword, el rollback; Equilibrio del rollback);
  scale ends Más fluido/Más reactivo; value marker Recommended→**Recomendado**.
- **/quote unit lines use the SC:R Latin American dub** (the game's `esMX` speech, Argentine cast),
  not the Castilian redub (`esES`, which says Soldado / Espectro / vosotros). The text was
  transcribed from the game's own speech files and the radio-filtered lines checked by ear (the dub
  keeps the English radio jargon reversed or verbatim: Adelante, ComTac / ComNav configurada /
  MilSpec ED-209 en línea). Khalani
  phrases stay Khalani in the dub. **Chat transcript** scope tags **(TODOS) / (EQUIPO)**;
  transcript→transcripción; review (of a disputed game)→**revisión** (Solicitar revisión, Descartar
  solicitud). Map queue→**cola de mapas**, Up next→**A continuación**, Then→Después; lock
  alliances→**Bloquear alianzas**.
- **Post-game commends** (Dota 2 terms): commend→**Elogiar** / elogio(s) (Elogios: N), report
  button→**Reportar**.
- **Event mode** (lobby option that turns off replay-affecting fixes)→**Modo evento**; banner value
  On→Activado; Advanced (form section)→**Avanzado**. Game bugs→**bugs** (in-file loanword).
- **Explainer articles** (`matchmaking.explainer.*`, `ladder.explainer.*`): the ladder
  is **clasificatoria** (the page title), MMR is written **MMR** with "índice de emparejamiento"
  glossed once, placement games→**partidas de posicionamiento** (in-file), bonus pool→**bono
  acumulado**, catch-up bonus→**bono de recuperación**, grinding→**farmear**. The example players
  (Arbiter, Reaver, …) stay in English: they're names in an English image.
- **In-game UI (`game.json`, observer/replay HUD + tier-2 dialogs):** observer (spectator)→observador,
  replay→replay / the matchup-bar tag Replay vs live→**En vivo**, spoiler-free→Sin spoilers,
  matchup→**Enfrentamiento**, expansion (a new base)→Expansión, workers→trabajadores,
  idle workers→**{{count}} inac.** (the chip is 46 px; "inact." already elides),
  kills→eliminaciones (e/p in the cramped k/l columns), drop (removing a stuck peer)→**expulsar**
  (matches kick; the countdown is "Expulsar: {{time}}" so the name column keeps its width), an
  unclean netstat departure→Caído vs a deliberate one→Salió, relay→relay, buffer→buffer, a network
  turn→turno. Race chips: **T / Z / P / A** (Aleatoria). Dock preset names must differ in their
  *first* letter — the collapsed dock shows only that letter (Mínimo / Estándar / Analista).
- **Observer team cards / graphs:** minerals column→**Min.** (mirrors the in-file "Efic."
  abbreviation), gas→Gas, supply→**Suministros** (~82 px in the 96 px column), control
  groups→**Grupos de control**, the grouped graph titles are "{{series}} por equipo" /
  "{{series}} por jugador", team name→**Equipo {{number}}** (matches `game.teamName.number`).

- **Game menu / disconnect dialog (`game.json`):** the menu's buttons are Volver a la partida /
  Opciones / Alianzas + Mensajes (two half-width plates on one row, each opening SC:R's own dialog) /
  Salir de la partida (a player holds it: **"Mantén pulsado para salir"**), inside a 344 px plate in
  tracked caps. Victory/defeat card: Victoria / Derrota, Unidades producidas / eliminadas /
  perdidas, Minerales / Gas extraídos (SC:R's "extraer"), APM promedio, Seguir jugando.
  Long app chip labels are shortened in game where the row can't hold them (color overrides: En
  todas partes / Solo en el minimapa / Desactivado; TR24: Retraso de entrada TR24 Low). Abandoning from the disconnect notice is **abandonar**; its 300 px hold plate draws its
  label uncropped, so the usual "Mantén pulsado para abandonar" overruns it and the button is
  **"Mantén pulsado: abandonar"**. The roster's state column is 150 px and set lowercase like its
  siblings: conectado / no responde / reconectando… {{time}} / expulsión pedida.
  teammate→**compañero** (84 px tag).

- **Log in (`auth.login.logIn`) → Entrar**: it labels the app-bar button, where "Iniciar sesión"
  overflowed at phone widths; titles keep the full "Inicia sesión en ShieldBattery".
- **Licenses page:** open source→**código abierto**, license notices→avisos de licencia, release build→**compilación de lanzamiento**. The lobby ready toggle (rail) keeps the header's **Listo / No estoy listo**; the heart Support button→**Apoyar** (donations, not help).
- **skin → aspecto** (Blizzard's Spanish term; the old MT "máscara" was fixed), preorder→**Preventa**
  (LatAm; "Hacer un pedido" was place-an-order MT).
- **Discord activity:** activity→actividad, Ranked {{mode}}→Clasificatoria {{mode}} (matches
  `game.gameSource.ranked`); Discord's own buttons are named as Discord shows them (Unirse / Pedir
  unirse). The Battle.net settings page: Battle.net features→"pasar al comportamiento de Battle.net".
- **Platform rules (`rules.*`):** barcode (an unreadable `IIllIlI`-style name)→**barcode** (community loanword: los barcodes), a player’s name→**nombre**, type (on a keyboard)→**teclear** ("escribir a mano" means handwriting).

- **Account emails (`--ns email`) and recovery forms:** login name→**nombre de inicio de sesión**, display name→**nombre para mostrar** (the settings labels), username→**nombre de usuario**. Account settings→**ajustes de la cuenta**. Same informal tú as the app. The sign-off "gl hf gogogo" stays as it is.
- **Map collections (`maps.collections.*`):** collection→**colección** (feminine: Privada / Pública / Guardada / Tuya), **Starred keeps the favorites word → Favoritos** (the star icon already reads as "favorito"; "Destacados" would read as featured), Staff picks / Staff pick→**Selección del staff**, ladder pool→**grupo de mapas de clasificatoria** (card title "{{mode}}: grupo de mapas", mode first so a truncated card still shows which pool it is), save (someone's collection)→Guardar, Move up/down→**Mover arriba / Mover abajo** (never "Subir", which is upload).
- **Map browser (`maps.*`):** compare views are short segmented labels: Dividir / Deslizador / Fundido / Parpadeo / Resaltar / Restar. delist→**retirar del catálogo**, a map (what players pick)→**mapa**, a file (one upload of it)→**archivo**, the Default file→**predeterminado** (Comparar con el predeterminado, Usar el predeterminado); never "familia" / "versión" for these, staff→**el staff**, report to staff→**reporte**, Melee/UMS lens→Melee / UMS (in-file game type), the Your maps tab→Tus mapas (buttons say "mis mapas"), On this PC→**En este PC**, upload→subir. map maker (the map's original author, who owns its page; never "propietario" / "dueño")→**creador** (Ahora eres el creador de este mapa), a claim (a request to be recorded as a map's maker)→**solicitud** (Solicitud enviada al staff), "I made this map"→Hice este mapa.

