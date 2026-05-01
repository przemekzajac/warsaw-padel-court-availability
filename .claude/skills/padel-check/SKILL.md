---
name: padel-check
description: Sprawdza dostępność kortów padlowych w 6 warszawskich klubach na 5 najbliższych dni roboczych i wysyła raport mailem przez Resend.
allowed-tools:
  - Read
  - Bash
  - mcp__playwright__browser_navigate
  - mcp__playwright__browser_wait_for
  - mcp__playwright__browser_snapshot
  - mcp__playwright__browser_evaluate
  - mcp__playwright__browser_click
  - mcp__playwright__browser_type
  - mcp__playwright__browser_press_key
  - mcp__playwright__browser_close
---

# Padel availability check — Warszawa

Jesteś agentem zbierającym dostępność kortów padlowych. Wykonaj zadanie autonomicznie. **Finalna akcja zawsze wymagana: wysyłka maila przez Resend API.**

## Kolejność operacji

1. Wyznacz daty (krok 1)
2. Załaduj kluby (krok 2)
3. **Login do kluby.org (krok 2.5)** — wymagane, grafiki widoczne tylko dla zalogowanych
4. Scrape (krok 3)
5. Filtr okien + agregacja (krok 4)
6. Render markdown (krok 5)
7. Wyślij email (krok 6) — **zawsze, niezależnie od wyniku**

## Wymagane env vars

| Zmienna | Opis |
|---|---|
| `RESEND_API_KEY` | Klucz API z resend.com |
| `MAIL_TO` | Adres odbiorcy raportu |
| `MAIL_FROM` | Adres nadawcy (np. `onboarding@resend.dev`) |
| `KLUBY_USERNAME` | Login na kluby.org (email lub nick) |
| `KLUBY_PASSWORD` | Hasło na kluby.org |

---

## Krok 1 — Wyznacz 5 dni roboczych

1. Pobierz dziś: `TZ=Europe/Warsaw date +%Y-%m-%d`. Pobierz rok: `TZ=Europe/Warsaw date +%Y`.
2. Read `.claude/skills/padel-check/holidays.md` — wyciągnij listę stałych świąt i algorytm Computus.
3. Oblicz Wielkanoc dla bieżącego roku (Anonymous Gregorian). Najprościej: jednolinijkowiec node:
   ```
   node -e 'const Y=Number(process.argv[1]); const a=Y%19,b=Math.floor(Y/100),c=Y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1; const d0=new Date(Date.UTC(Y,mo-1,da)); const fmt=x=>x.toISOString().slice(0,10); const off=n=>{const x=new Date(d0); x.setUTCDate(x.getUTCDate()+n); return fmt(x)}; console.log(JSON.stringify({easter:fmt(d0), monday:off(1), pentecost:off(49), corpus:off(60)}))' "$YEAR"
   ```
4. Zbiór świąt: stałe (`MM-DD` → `YYYY-MM-DD` z `$YEAR`) + 4 daty ruchome z punktu 3.
5. Iteruj `today, today+1, today+2, ...` aż uzbierasz **5 dat** spełniających:
   - dzień tygodnia ∈ {pn, wt, śr, czw, pt}
   - data ∉ świąt
6. Zapisz listę 5 dat ISO (`YYYY-MM-DD`). Zapamiętaj też dzisiejszą datę dla nagłówka raportu.

---

## Krok 2 — Załaduj kluby

Read `.claude/skills/padel-check/clubs.json`. Dla każdego klubu masz `key`, `displayName`, `group` (`kluby` | `playtomic`), `urlTemplate` (placeholder `{date}`).

---

## Krok 2.5 — Login do kluby.org

**Wymagane** — kluby.org pokazuje grafik rezerwacji **tylko zalogowanym** użytkownikom (anonimowi widzą stronę bez tabeli). Login wykonaj **raz** na początku, sesja Playwright zachowa cookie dla wszystkich kolejnych nawigacji.

Wymagane env vars: `KLUBY_USERNAME`, `KLUBY_PASSWORD`. Jeśli któraś brakuje — pomiń login, oznacz wszystkie 4 kluby × 5 dat z grupy `kluby` jako `notChecked` z reason `"missing kluby.org credentials"` i przejdź do Kroku 3 (Playtomic nadal może być scrape'owany).

### Procedura

1. `mcp__playwright__browser_navigate(url="https://kluby.org/login")`. Jeśli redirect wskazuje że jest inna ścieżka loginu (np. `/users/sign_in`, `/zaloguj`) — podążaj za redirectem. Jeśli login jest modalem na homepage zamiast osobną stroną: navigate do `https://kluby.org/`, potem `mcp__playwright__browser_click` na link/przycisk z tekstem "Zaloguj" / "Zaloguj się" / "Login".
2. `mcp__playwright__browser_snapshot()` — zidentyfikuj formularz logowania.
3. Znajdź pole loginu/emaila — szukaj inputa z labelem/placeholderem zawierającym jedno z: `email`, `e-mail`, `login`, `nazwa użytkownika`, `username`. `mcp__playwright__browser_type(element, ref, text=$KLUBY_USERNAME)`.
4. **Wpisz hasło przez DOM injection (NIE `browser_type`).** `browser_type` z parametrem `text="$KLUBY_PASSWORD"` wpisze do inputa literalny string `"$KLUBY_PASSWORD"` zamiast wartości env var — w obecnym MCP nie ma interpolacji. Zamiast tego:
   - Zapisz hasło do pliku tymczasowego: `printf '%s' "$KLUBY_PASSWORD" > /tmp/.kluby_pwd` (plik nigdy nie idzie do repo / maila).
   - Odczytaj wartość przez `Read` lub `Bash cat`, podstaw do JS poniżej i odpal jednym `mcp__playwright__browser_evaluate(function=...)`:
     ```js
     () => {
       const el = document.querySelector('input[type="password"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(el, '<HASŁO_TUTAJ>');
       el.dispatchEvent(new Event('input', { bubbles: true }));
       el.dispatchEvent(new Event('change', { bubbles: true }));
     }
     ```
   - Native value setter + ręczne `input`/`change` eventy są wymagane, bo React/Vue formy filtrują naiwne `el.value = ...`. Po wykonaniu: `rm /tmp/.kluby_pwd`.
5. Submit — kliknij przycisk z tekstem `Zaloguj`, `Zaloguj się`, `Sign in`, `Log in`, lub `mcp__playwright__browser_press_key(key="Enter")` w polu hasła.
6. `mcp__playwright__browser_wait_for(time=2)`.
7. `mcp__playwright__browser_snapshot()` — zweryfikuj sukces. Heurystyki sukcesu:
   - URL przestaje zawierać `/login`
   - W snapshocie widać element wskazujący zalogowanego usera (np. link "Wyloguj", "Moje konto", inicjały / avatar usera, sekcja `nav` z user menu)
   - Brak komunikatu błędu typu `Nieprawidłowy login`, `Invalid credentials`
8. Jeśli sukces → przejdź do Kroku 3.
9. Jeśli login się nie udał (komunikat błędu, formularz nadal widoczny po 2s): oznacz wszystkie 4 kluby × 5 dat z grupy `kluby` jako `notChecked` z reason `"login failed: <krótki opis>"`. Idź dalej do Kroku 3 dla samych klubów Playtomic. **Bez retry loginu** — albo działa za pierwszym razem, albo poddajemy się.

**Bezpieczeństwo:** nie loguj wartości `$KLUBY_PASSWORD` ani snapshotów strony logowania zawierających pole hasła do żadnego outputu (stdout, mail, treść JS w `browser_evaluate` cytowana w odpowiedzi). Plik `/tmp/.kluby_pwd` musi zostać usunięty po użyciu. Jeśli musisz zacytować błąd loginu w mailu — tylko krótki opis bez zrzutu DOM.

---

## Krok 3 — Scrape

### Inicjalizacja parserów (raz, na początku kroku)

Read oba pliki parserów raz i trzymaj treść w pamięci jako stringi `KLUBY_JS` i `PLAYTOMIC_JS`:

- `Read .claude/skills/padel-check/parse-kluby.js` → `KLUBY_JS`
- `Read .claude/skills/padel-check/parse-playtomic.js` → `PLAYTOMIC_JS`

Każdy plik to **jedna funkcja arrow** (`() => { ... }`) zawierająca pełną logikę ekstrakcji wolnych okien dla danej grupy klubów. Jej treść zostanie przekazana 1:1 jako parametr `function` do `mcp__playwright__browser_evaluate`. Nie modyfikuj treści — funkcje są starannie wyważone (rowspan, AM/PM, dominance pruning) i każda zmiana to ryzyko regresji.

### Browser install fallback

Pierwszy `mcp__playwright__browser_navigate` po starcie sesji może zwrócić błąd `Browser 'chrome-for-testing' is not installed`. Wtedy odpal `npx -y @playwright/mcp install-browser chrome-for-testing` przez `Bash` i powtórz nawigację. Setup script routine'a powinien to robić wcześniej, ale obsłuż awaryjnie.

### Pętla scrape

Sesja Chromium już aktywna od Kroku 2.5 (lub od pierwszego navigate, jeśli login został pominięty).

Iteruj sekwencyjnie po `(klub × data)` = 30 par. **Bez równoległości** — pojedyncza instancja browsera w MCP.

**Skip:** pomiń pary już oznaczone jako `notChecked` w Kroku 2.5 (kluby.org bez sukcesu loginu).

Dla każdej pary:

1. URL = `urlTemplate` z podstawioną `{date}`.
2. `mcp__playwright__browser_navigate(url=URL)`.
3. `mcp__playwright__browser_wait_for(time=2)` (kluby.org) lub `time=3` (Playtomic SPA potrzebuje dłuższej hydratacji).
4. `mcp__playwright__browser_evaluate(function=KLUBY_JS)` dla `group=="kluby"` lub `function=PLAYTOMIC_JS` dla `group=="playtomic"`.
5. Wynik jest tablicą okien:
   - `kluby`: `{ courtName, start, end, durationMin }`
   - `playtomic`: `{ start, end, durationMin, numCourts }` (już po dominance pruning, see parse-playtomic.js)
6. Jeśli wynik ma kształt `{ error: "..." }` (np. `"no grafik table (not logged in?)"`) lub jest pustą tablicą przy błędzie nawigacji → dopisz wpis do `notChecked` w postaci `{ club: displayName, date, reason }` i przejdź dalej. **Bez retry.**
7. Pusta tablica `[]` z poprawnie załadowanej strony oznacza po prostu brak wolnych okien ≥90 min — to NIE jest błąd, NIE dopisuj do `notChecked`.

Po wszystkich parach: `mcp__playwright__browser_close()` żeby zwolnić zasoby.

### Co robią parsery (referencja)

**`parse-kluby.js`** — odnajduje `table.table-grafik` (oraz floating header `floatThead-table`), buduje 2D grid honorujący `rowspan`/`colspan`, dla każdego kortu i zakresu 17:00–22:30 znajduje wszystkie ciągłe sekwencje wolnych komórek (`Rezerwuj`) i zwraca okna ≥90 min, `end` przycięte do 23:00. Jeśli tabela nie istnieje (najczęściej: brak loginu) → `{ error: ... }`.

**`parse-playtomic.js`** — odnajduje `details.group/slot`, parsuje czas startu (AM/PM), liczbę dostępnych kortów (`N options`) i wszystkie sub-czasy trwania (`•60 min`, `•90 min`, ...). Filtruje do `start ∈ [17:00, 23:00)` i przyciętego `durationMin ≥ 90`. Następnie aplikuje **dominance pruning per start**: dla danej godziny startu zostawia okno tylko wtedy, gdy oferuje *więcej* kortów niż każde dłuższe okno z tej samej godziny — eliminuje informacyjnie redundantne wpisy (np. `17:00–18:30 (1.5h, 3 korty)` znika, jeśli istnieje `17:00–19:00 (2h, 3 korty)`).

---

## Krok 4 — Filtr okien + agregacja

Parsery z Kroku 3 już:
- filtrują `durationMin ≥ 90`,
- przycinają `end` do 23:00,
- (Playtomic) wykonują dominance pruning per start.

Tutaj zostaje tylko **agregacja per klub × data**, dająca jednolite wpisy raportu `{ klub, data, start, end, durationMin, courtsCount }`:

- **`group == "kluby"`** — wynik parsera to lista okien per kort (`{ courtName, start, end, durationMin }`). Group by `(start, end)` w obrębie pary `(klub, data)`, `courtsCount = liczba kortów w grupie`. Rozdzielne okna na tym samym korcie traktuj jak osobne wpisy.
- **`group == "playtomic"`** — wynik parsera to już lista `{ start, end, durationMin, numCourts }` po pruning. Mapuj 1:1 na `courtsCount = numCourts`. Bez dalszej agregacji.

---

## Krok 5 — Render markdown

### Sortowanie
- Sekcje per klub — alfabetycznie po `displayName`.
- W sekcji: po dacie ↑, potem po `start` ↑, potem po `durationMin` ↑.

### Mapowanie dni tygodnia (PL)
`Mon→poniedziałek, Tue→wtorek, Wed→środa, Thu→czwartek, Fri→piątek`.

### Format wpisu
```
- DD.MM.YYYY (dzień_tygodnia), HH:MM–HH:MM (Xh / X.5h) — N kort{ów} woln{e/y/ych}
```

Polska odmiana liczebników:
- `1 kort wolny`
- `2/3/4 korty wolne`
- `5+ kortów wolnych`
- (uwaga: dla 12, 13, 14: `12/13/14 kortów wolnych`; dla 22/23/24: `22/23/24 korty wolne`. Reguła: jednostki 2/3/4 ALE NIE dziesiątki 12/13/14)

Format długości: `1.5h`, `2h`, `2.5h`, `3h`, ... (jeśli całkowita liczba godzin → bez ułamka; inaczej `.5h`).

### Szablon — są wolne sloty

```markdown
# Dostępność kortów padlowych — {today_iso}

Sprawdzono dni: {date1_pl}, {date2_pl}, {date3_pl}, {date4_pl}, {date5_pl}

## {Display Name 1}
- {entry}
- {entry}

## {Display Name 2}
- {entry}

## ⚠️ Nie sprawdzono
- {Klub} ({DD.MM.YYYY}) — {reason}
```

Format `{dateN_pl}`: `DD.MM.YYYY`.

### Szablon — brak slotów (gdy wszystkie kluby zwróciły 0 wpisów po agregacji)

```markdown
# Dostępność kortów padlowych — {today_iso}

Sprawdzono dni: {date1_pl}, {date2_pl}, {date3_pl}, {date4_pl}, {date5_pl}

W najbliższych 5 dniach roboczych żaden warszawski klub padlowy nie ma wolnego kortu w godzinach 17:00–23:00 na min. 1.5h gry.
```

### Sekcja "⚠️ Nie sprawdzono"

Dodaj **tylko gdy `notChecked` jest niepusta**. Pomiń całkowicie jeśli wszystko zostało sprawdzone.

Jeśli **wszystkie** kluby × wszystkie daty są w `notChecked` → raport zawiera tylko nagłówek + sekcję "Nie sprawdzono" (mail jest sygnałem że agent działał, ale scraping padł).

---

## Krok 6 — Wyślij email (Resend)

**Wysyłaj zawsze**, niezależnie od wyniku.

```bash
BODY_FILE=$(mktemp)
echo '<markdown raportu>' > "$BODY_FILE"
PAYLOAD=$(jq -n --arg from "$MAIL_FROM" --arg to "$MAIL_TO" --rawfile body "$BODY_FILE" \
  '{from: $from, to: [$to], subject: "Padel - wolne korty WWA", text: $body}')
curl -fsS -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
```

Jeśli `jq` niedostępne — zbuduj JSON ręcznie z escapowaniem (np. `node -e 'process.stdout.write(JSON.stringify({...}))'`).

**Subject:** dokładnie `Padel - wolne korty WWA`. Bez daty, bez emoji, bez liczników. Sztywny ciąg.

**Body:** czysty markdown raportu z kroku 5. Pierwszy znak = `#` z nagłówka. Bez preambuł ("Cześć", "Pozdrawiam"), bez załączników, bez CC/BCC.

**Retry:** jednokrotny. Jeśli `curl` zwróci kod ≥500 lub network error → odczekaj 5 sekund i powtórz raz. Jeśli drugi raz fail → zakończ z kodem błędu (logi routine pokażą problem w UI).

**Po wysłaniu zakończ.** Nie generuj dodatkowego outputu w stdout poza krótkim potwierdzeniem typu `Email sent.` Raport jest dostarczony mailem.

---

## Ograniczenia

- **Bez retry dla scrapowania.** Jeden strzał na (klub, dzień). Niepowodzenie → wpis w `notChecked`.
- **Bez logowania** do serwisów. Nie zakładaj kont, nie klikaj "Zarezerwuj", nie autoryzuj transakcji.
- **Tylko odczyt grafiku.** Żadnej interakcji z formularzami.
- **Email priorytet.** Jeśli zbliżasz się do limitu turn / budżetu, **przerwij scrape, złóż raport z tym co masz, dodaj resztę do `notChecked` i mimo to wyślij email.**
