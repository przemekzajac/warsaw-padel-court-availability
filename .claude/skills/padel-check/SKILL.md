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
4. Scrape (krok 3) — najpierw 4 kluby z grupy `kluby`, potem 2 z grupy `playtomic`
5. Union okien + filtr (krok 4)
6. Sanity check 30 par (krok 4.5)
7. Render markdown (krok 5)
8. Wyślij email (krok 6) — **zawsze, niezależnie od wyniku**

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

**Zbuduj listę 30 par do przetworzenia:** kartezjański produkt `clubs × dates`. Zapisz jako `allPairs[]`. Zainicjalizuj `processedPairs = new Set()` — będziesz dopisywał do niego po każdej parze (sukces lub fail). Ten zbiór posłuży w Kroku 4.5 do wykrycia cichych pominięć.

---

## Krok 2.5 — Login do kluby.org

**Wymagane** — kluby.org pokazuje grafik rezerwacji **tylko zalogowanym** użytkownikom (anonimowi widzą stronę bez tabeli). Login wykonaj **raz** na początku, sesja Playwright zachowa cookie dla wszystkich kolejnych nawigacji.

Wymagane env vars: `KLUBY_USERNAME`, `KLUBY_PASSWORD`. Jeśli któraś brakuje — pomiń login, oznacz wszystkie 4 kluby × 5 dat z grupy `kluby` jako `notChecked` z reason `"missing kluby.org credentials"`, dopisz każdą z tych 20 par do `processedPairs`, i przejdź do Kroku 3 (Playtomic nadal może być scrape'owany).

### Procedura

1. `mcp__playwright__browser_navigate(url="https://kluby.org/login")`. Jeśli redirect wskazuje że jest inna ścieżka loginu (np. `/users/sign_in`, `/zaloguj`) — podążaj za redirectem. Jeśli login jest modalem na homepage zamiast osobną stroną: navigate do `https://kluby.org/`, potem `mcp__playwright__browser_click` na link/przycisk z tekstem "Zaloguj" / "Zaloguj się" / "Login".
2. `mcp__playwright__browser_snapshot()` — zidentyfikuj formularz logowania.
3. Znajdź pole loginu/emaila — szukaj inputa z labelem/placeholderem zawierającym jedno z: `email`, `e-mail`, `login`, `nazwa użytkownika`, `username`. `mcp__playwright__browser_type(element, ref, text=$KLUBY_USERNAME)`.
4. Znajdź pole hasła — input typu `password` lub label zawierający `hasło`, `password`. `mcp__playwright__browser_type(element, ref, text=$KLUBY_PASSWORD)`.
5. Submit — kliknij przycisk z tekstem `Zaloguj`, `Zaloguj się`, `Sign in`, `Log in`, lub `mcp__playwright__browser_press_key(key="Enter")` w polu hasła.
6. `mcp__playwright__browser_wait_for(time=2)`.
7. `mcp__playwright__browser_snapshot()` — zweryfikuj sukces. Heurystyki sukcesu:
   - URL przestaje zawierać `/login`
   - W snapshocie widać element wskazujący zalogowanego usera (np. link "Wyloguj", "Moje konto", inicjały / avatar usera, sekcja `nav` z user menu)
   - Brak komunikatu błędu typu `Nieprawidłowy login`, `Invalid credentials`
8. Jeśli sukces → przejdź do Kroku 3.
9. Jeśli login się nie udał (komunikat błędu, formularz nadal widoczny po 2s): oznacz wszystkie 4 kluby × 5 dat z grupy `kluby` jako `notChecked` z konkretnym reason (np. `"login failed: Nieprawidłowy login"` jeśli widzisz taki komunikat, lub `"login failed: form still visible after submit"` jeśli zgadujesz). Dopisz każdą z tych 20 par do `processedPairs`. Idź dalej do Kroku 3 dla samych klubów Playtomic. **Bez retry loginu.**

**Bezpieczeństwo:** nie loguj wartości `$KLUBY_PASSWORD` ani snapshotów strony logowania zawierających pole hasła do żadnego outputu (stdout, mail, raport). Komunikat błędu w mailu może zawierać tekst widoczny dla anonimowego usera (np. "Nieprawidłowy login"), ale **nie** zrzutu DOM ani wpisanej wartości pola.

---

## Krok 3 — Scrape

Inicjalizacja: brak — sesja Chromium już aktywna od Kroku 2.5 (lub od pierwszego navigate, jeśli login pominięty).

**Kolejność iteracji:**
1. Najpierw wszystkie pary z grupy `kluby` (4 kluby × 5 dat = 20 par) — sesja jest świeżo zalogowana, cookie ważne.
2. Potem wszystkie pary z grupy `playtomic` (2 × 5 = 10 par) — Playtomic nie wymaga loginu.

Sekwencyjnie. **Bez równoległości.** Pomijaj pary już oznaczone jako `notChecked` w Kroku 2.5.

Dla każdej pary `(klub, data)`:

1. URL = `urlTemplate` z podstawioną `{date}`.
2. `mcp__playwright__browser_navigate(url=URL)`.
3. `mcp__playwright__browser_wait_for(time=2)`.
4. `mcp__playwright__browser_snapshot()`.
5. Przeparsuj snapshot wg reguł poniżej. Wynik = lista **surowych wolnych odcinków** dla tej pary, jeden element per kort: `rawSlots = [{ start: "HH:MM", end: "HH:MM" }, ...]`. **Każdy odcinek ciągły na danym korcie = jeden element.** Bez filtra długości na tym etapie. Bez agregacji. **Nie generuj wariantów co 30 min — zachowuj surowe maksymalne ciągłe odcinki per kort.**
6. Zapisz `clubFreeSlots[clubKey][date] = rawSlots`. Dopisz `(clubKey, date)` do `processedPairs`.
7. Przy błędzie / pustym snapshocie / 4xx / 5xx / Cloudflare / brak tabeli grafiku: dopisz wpis do `notChecked` z **konkretnym reason** (zobacz niżej). Dopisz `(clubKey, date)` do `processedPairs` mimo błędu. **Bez retry.**

Po wszystkich parach: `mcp__playwright__browser_close()`.

### Konkretne `reason` dla `notChecked`

**Nie używaj generycznego "SSL certificate error" jeśli nie widzisz tego dosłownie w tool output.** Sprawdź dokładny tekst błędu i opisz co naprawdę zaszło. Akceptowalne wzorce:

- `"HTTP 404"`, `"HTTP 502"`, `"HTTP 503"` — gdy navigate zwraca status z kodu odpowiedzi
- `"navigation timeout after 30s"` — gdy wait_for się nie kończy
- `"snapshot empty"` — gdy snapshot to pusty `body`
- `"court table missing"` — strona załadowana ale nie ma elementu z grafikiem
- `"no Rezerwuj cells found"` — tabela jest, ale wszystkie komórki zajęte (uwaga: to NIE jest błąd — to oznacza 0 wolnych slotów; w takim wypadku **nie** dodawaj do `notChecked`, dodaj `clubFreeSlots[clubKey][date] = []`)
- `"redirect to login"` — sesja kluby.org wygasła w trakcie scrape
- `"ERR_CERT_AUTHORITY_INVALID"` lub konkretny błąd z Chromium — gdy faktycznie cert się posypał (cytuj dosłownie z tool output)
- `"login failed: <komunikat>"` — z Kroku 2.5
- `"missing kluby.org credentials"` — z Kroku 2.5

### Reguły parsowania

#### Filtr kortów singlowych (wspólny dla obu grup)

**Pomijaj korty oznaczone jako singlowe** — gracz interesuje się tylko kortami deblowymi (do gry 2v2).

Kort jest singlowy, jeśli jego nazwa / nagłówek kolumny / `aria-label` zawiera (case-insensitive) podciąg `singl`. Pasuje do wszystkich form: `single`, `Single`, `SINGLES`, `singiel`, `Singla`, `Kort singlowy`, `Pole singlowe`, `padel single`, itd. Polski rdzeń `singl-` i angielski `singl-` mają wspólny prefix, więc jedno sprawdzenie wystarczy.

Jeśli nazwa kortu pasuje do tego wzorca → **w ogóle nie generuj `rawSlots` dla tego kortu**. Jego dostępność nie wchodzi do unionu w Kroku 4.

#### Grupa `kluby` (kluby.org)

Tabela grafiku: kolumny = korty (nagłówki kolumn = nazwy kortów), wiersze = sloty 30-min (godziny od ~07:00 do ~23:00).

- Komórka z **tekstem "Rezerwuj"** lub linkiem o tekście "Rezerwuj" = kort wolny w tym 30-min slocie.
- Komórka pusta / z imieniem rezerwującego / "Zarezerwowane" = zajęte.

Dla każdej kolumny (kortu):
1. Wybierz wiersze z godzinami startu w zakresie 17:00–22:30 (ostatni 30-min slot kończy się o 23:00).
2. Znajdź **wszystkie maksymalne ciągłe sekwencje** wolnych komórek (rozłączne ze sobą).
3. Dla każdej takiej sekwencji: `start` = godzina pierwszej wolnej komórki, `end` = `start` + 30·n minut.
4. Dopisz każdy taki odcinek do `rawSlots` dla tego kortu. **Bez filtra długości** — krótsze niż 30 min nie wystąpią z konstrukcji, krótsze niż 1.5h zostaną zfiltrowane w Kroku 4 po zrobieniu unionu.

Przykład: kort wolny 17:00–18:30 i 21:00–23:00 (rozłączne) → dopisz dwa odcinki: `{start:"17:00", end:"18:30"}` i `{start:"21:00", end:"23:00"}`.

#### Grupa `playtomic` (playtomic.com)

Playtomic to React SPA — snapshot zawiera siatkę dostępności jako lista przycisków/komórek z aria-label opisującym godzinę i status.

- Każda komórka = jeden slot na konkretnym korcie o konkretnej godzinie.
- Wolny slot: `aria-label` typu "X minut" / "Book" / nie-disabled, klasa CSS bez modyfikatora `unavailable`/`occupied`.
- Zajęty: aria-disabled, klasa zawierająca `unavailable` lub brak interakcji.
- Granularność zwykle 30 lub 60 minut zależnie od klubu.

**Strategia parsowania (snapshot accessibility tree):**

1. Zidentyfikuj nazwy kortów (nagłówki wierszy lub `aria-label` całej linii: "Court 1", "Pista 1").
2. Dla każdego kortu wyciągnij listę wolnych godzin startu (przyciski "book" / "available").
3. Posortuj godziny rosnąco. Filtruj do startu ∈ [17:00, 22:30] (granularność 30) lub [17:00, 22:00] (granularność 60).
4. Wykryj granularność: jeśli różnice między kolejnymi dostępnymi slotami to wielokrotność 30 min — granularność 30; jeśli 60 — 60.
5. Znajdź **wszystkie maksymalne ciągłe sekwencje** dostępnych slotów (kolejne starty oddalone o `granularność`).
6. Dla każdej sekwencji: `start` = pierwszy slot, `end` = ostatni slot + granularność. Jeśli `end > 23:00` → przytnij do 23:00.
7. Dopisz każdy odcinek do `rawSlots` dla tego kortu. **Bez filtra długości.**

**Awaryjnie**, jeśli accessibility snapshot nie pozwala odróżnić wolnych od zajętych: użyj `mcp__playwright__browser_evaluate` z funkcją która zwróci listę kortów + dostępnych godzin czytając DOM bezpośrednio (np. `document.querySelectorAll('[data-testid="time-slot"]')`).

---

## Krok 4 — Union okien + filtr

Cel: pokazać **kiedy w klubie jest jakikolwiek wolny kort**, łącząc okna ze wszystkich kortów. Nie raportujemy ile kortów jest wolnych ani na którym konkretnie korcie — wystarczy info "tu się da zagrać".

Dla każdej pary `(klub, data)` dla której `clubFreeSlots[klub][data]` istnieje (czyli pary nie-błędne):

1. **Zbierz wszystkie odcinki ze wszystkich kortów w jeden zbiór:** `allSlots = clubFreeSlots[klub][data]` (już jest płaską listą `{start, end}`).
2. **Przytnij do okna 17:00–23:00:** dla każdego odcinka `start = max(start, 17:00)`, `end = min(end, 23:00)`. Odrzuć odcinki gdzie `start ≥ end` po przycięciu.
3. **Sortuj po `start` rosnąco.**
4. **Sklejaj overlap + dotyk** (touch-touch też się skleja):
   - Inicjalizuj `merged = [allSlots[0]]`.
   - Dla każdego kolejnego `s = allSlots[i]`: jeśli `s.start ≤ merged.last.end` → `merged.last.end = max(merged.last.end, s.end)`. Inaczej → `merged.push(s)`.
   - Wynik: lista rozłącznych ciągłych fragmentów unionu.
5. **Filtruj fragmenty unionu**: zostaw tylko te z `(end - start) ≥ 90 minut`.
6. Zapisz wynik jako `clubReportSlots[klub][data] = [{start, end, durationMin}, ...]` (każdy fragment = jeden wpis raportu).

### Przykłady

**Sklejanie overlap:**
- Kort A: 17:00–19:00, Kort B: 18:00–20:00 → union: `[17:00–20:00]` → 1 wpis `17:00–20:00 (3h)`.

**Sklejanie touch-touch:**
- Kort A: 17:00–19:00, Kort B: 19:00–20:00 → union: `[17:00–20:00]` → 1 wpis `17:00–20:00 (3h)`.

**Luki = osobne wpisy:**
- Kort A: 17:00–19:00, Kort B: 21:00–23:00 → union: `[17:00–19:00, 21:00–23:00]` → 2 wpisy: `17:00–19:00 (2h)` i `21:00–23:00 (2h)`.

**Filtr <1.5h po unionie:**
- Kort A: 17:00–17:30, Kort B: 22:30–23:00 → union: `[17:00–17:30, 22:30–23:00]` (rozłączne, każdy 30 min < 1.5h) → 0 wpisów dla tej pary.

**Krótkie odcinki sklejone w długi:**
- Kort A: 17:00–18:00 (1h, <1.5h sam w sobie), Kort B: 17:30–19:00 (1.5h) → union: `[17:00–19:00]` (sklejone overlap) → 1 wpis `17:00–19:00 (2h)`.

### Co NIE robimy

- **Nie generujemy wariantów slotów co 30 min.** Z fragmentu unionu 17:00–23:00 (6h) **JEDEN wpis**, nie 19 wariantów (17:00–18:30, 17:00–19:00, 17:30–19:00, ...).
- **Nie podajemy liczby kortów ani ich nazw** w wpisach. Format wpisu nie zawiera "N kortów wolne".
- **Nie deduplikujemy między kortami "ręcznie"** — union robi to za nas.

---

## Krok 4.5 — Sanity check 30 par

Po wyjściu z pętli scrape: zweryfikuj inwariant **`processedPairs.size == 30`**.

Wyznacz `missingPairs = allPairs - processedPairs`. Jeśli niepuste:

1. Dla każdej `(klub, data)` w `missingPairs`: dopisz do `notChecked` z reason `"silently skipped — investigate"`.
2. Loguj fakt skipa do stdout (jednolinijkowo, bez wrażliwych danych): `WARN: <N> pairs silently skipped: <lista>`.

Ten check chroni przed cichym pominięciem klubu (np. agent zapomniał o jednym z 6 klubów lub przerwał pętlę bez awareness).

---

## Krok 5 — Render markdown

### Sortowanie
- Sekcje per klub — alfabetycznie po `displayName`.
- W sekcji: po dacie ↑, potem po `start` ↑.

### Mapowanie dni tygodnia (PL)
`Mon→poniedziałek, Tue→wtorek, Wed→środa, Thu→czwartek, Fri→piątek`.

### Format wpisu

```
- DD.MM.YYYY (dzień_tygodnia), HH:MM–HH:MM (Xh)
```

Format długości: `1.5h`, `2h`, `2.5h`, `3h`, ... (jeśli całkowita liczba godzin → bez ułamka; inaczej `.5h`).

Bez liczby kortów. Bez nazw kortów. Wystarczy info że w tym przedziale jakiś kort jest wolny.

### Klub bez wolnych slotów

Jeśli klub ma `clubReportSlots[klub]` puste dla wszystkich 5 dat (i nie wszystkie 5 dat klubu są w `notChecked`) — **pomiń sekcję klubu w mailu**. Brak sekcji = brak wolnych kortów, czytelne dla odbiorcy.

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
- {Klub} ({DD.MM.YYYY}) — {konkretny reason}
```

Format `{dateN_pl}`: `DD.MM.YYYY`.

### Szablon — brak slotów (gdy żaden klub nie ma wolnych okien po unionie + filtrze)

```markdown
# Dostępność kortów padlowych — {today_iso}

Sprawdzono dni: {date1_pl}, {date2_pl}, {date3_pl}, {date4_pl}, {date5_pl}

W najbliższych 5 dniach roboczych żaden warszawski klub padlowy nie ma wolnego kortu w godzinach 17:00–23:00 na min. 1.5h gry.
```

### Sekcja "⚠️ Nie sprawdzono"

Dodaj **tylko gdy `notChecked` jest niepusta**. Pomiń całkowicie jeśli wszystko sprawdzone.

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

- **Bez retry dla scrapowania.** Jeden strzał na (klub, dzień). Niepowodzenie → wpis w `notChecked` z konkretnym reason.
- **Bez logowania** do serwisów rezerwacyjnych (poza kluby.org auth). Nie zakładaj kont, nie klikaj "Zarezerwuj".
- **Tylko odczyt grafiku.** Żadnej interakcji z formularzami rezerwacji.
- **Email priorytet.** Jeśli zbliżasz się do limitu turn / budżetu, przerwij scrape, **uzupełnij processedPairs do 30** (resztę do `notChecked` z reason `"budget exceeded — not attempted"`), złóż raport, wyślij email.
