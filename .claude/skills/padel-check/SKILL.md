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

Wymagane env vars: `KLUBY_USERNAME`, `KLUBY_PASSWORD`. Jeśli któraś brakuje — pomiń login, oznacz wszystkie kluby z grupy `kluby` × 5 dat (zwykle 3 kluby = 15 par) jako `notChecked` z reason `"missing kluby.org credentials"`, dopisz każdą z tych par do `processedPairs`, i przejdź do Kroku 3 (Playtomic nadal może być scrape'owany).

### Procedura

**0. Odczytaj env vars do konkretnych wartości** (przed jakąkolwiek interakcją z formularzem). `mcp__playwright__browser_type` **NIE** wykonuje shell expansion — jeśli przekażesz literalny string `"$KLUBY_USERNAME"` lub `"${KLUBY_USERNAME}"` jako wartość pola `text`, to dokładnie taki literał trafi do pola loginu, login się nie powiedzie. Najpierw odczytaj wartości przez Bash:

```bash
printenv KLUBY_USERNAME
printenv KLUBY_PASSWORD
```

Output zawierający rzeczywiste wartości (np. `padel@example.com` i hasło) zapamiętaj w kontekście. W kolejnych wywołaniach `browser_type` przekazuj **te konkretne stringi** jako `text`, nie placeholdery.

1. `mcp__playwright__browser_navigate(url="https://kluby.org/login")`. Jeśli redirect wskazuje że jest inna ścieżka loginu (np. `/users/sign_in`, `/zaloguj`) — podążaj za redirectem. Jeśli login jest modalem na homepage zamiast osobną stroną: navigate do `https://kluby.org/`, potem `mcp__playwright__browser_click` na link/przycisk z tekstem "Zaloguj" / "Zaloguj się" / "Login".
2. `mcp__playwright__browser_snapshot()` — zidentyfikuj formularz logowania.
3. Znajdź pole loginu/emaila — szukaj inputa z labelem/placeholderem zawierającym jedno z: `email`, `e-mail`, `login`, `nazwa użytkownika`, `username`. `mcp__playwright__browser_type(element, ref, text=<wartość KLUBY_USERNAME odczytana w kroku 0>)`.
4. Znajdź pole hasła — input typu `password` lub label zawierający `hasło`, `password`. `mcp__playwright__browser_type(element, ref, text=<wartość KLUBY_PASSWORD odczytana w kroku 0>)`.
5. Submit — kliknij przycisk z tekstem `Zaloguj`, `Zaloguj się`, `Sign in`, `Log in`, lub `mcp__playwright__browser_press_key(key="Enter")` w polu hasła.
6. `mcp__playwright__browser_wait_for(time=2)`.
7. `mcp__playwright__browser_snapshot()` — zweryfikuj sukces. Heurystyki sukcesu:
   - URL przestaje zawierać `/login`
   - W snapshocie widać element wskazujący zalogowanego usera (np. link "Wyloguj", "Moje konto", inicjały / avatar usera, sekcja `nav` z user menu)
   - Brak komunikatu błędu typu `Nieprawidłowy login`, `Invalid credentials`
8. Jeśli sukces → przejdź do Kroku 3.
9. Jeśli login się nie udał (komunikat błędu, formularz nadal widoczny po 2s): oznacz wszystkie kluby z grupy `kluby` × 5 dat (zwykle 3 kluby = 15 par) jako `notChecked` z konkretnym reason (np. `"login failed: Nieprawidłowy login"` jeśli widzisz taki komunikat, lub `"login failed: form still visible after submit"` jeśli zgadujesz). Dopisz każdą z tych par do `processedPairs`. Idź dalej do Kroku 3 dla klubów Playtomic. **Bez retry loginu.**

**Bezpieczeństwo:**
- Wartość `KLUBY_PASSWORD` **musi** trafić do tool call'a `browser_type` (inaczej login nie zadziała) — będzie widoczna w logu run'u Routine. Logi runów widzi tylko właściciel konta Claude Code on the web — to akceptowalna powierzchnia dla użytkownika single-tenant.
- `KLUBY_PASSWORD` **nie** może trafić do: maila wysyłanego do `MAIL_TO`, raportu HTML/text, do stdout poza tool call'em, do commit'ów w repo, do żadnego pliku zapisywanego na dysk.
- Nie cytuj snapshotów strony logowania zawierających pole hasła w mailu ani w raporcie. Komunikat błędu w mailu może zawierać tekst widoczny dla anonimowego usera (np. "Nieprawidłowy login"), ale nie zrzutu DOM ani wpisanej wartości pola.

---

## Krok 3 — Scrape

Inicjalizacja: brak — sesja Chromium już aktywna od Kroku 2.5 (lub od pierwszego navigate, jeśli login pominięty).

**Kolejność iteracji:**
1. Najpierw wszystkie pary z grupy `kluby` (zwykle 3 kluby × 5 dat = 15 par) — sesja jest świeżo zalogowana, cookie ważne.
2. Potem wszystkie pary z grupy `playtomic` (zwykle 3 × 5 = 15 par) — Playtomic nie wymaga loginu.

(Suma zawsze = liczba klubów w `clubs.json` × 5 dat. Konkretne liczby per grupa wynikają z `clubs.json` i mogą się zmieniać gdy klub przechodzi między systemami rezerwacji.)

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

**Pomijaj korty oznaczone jako singlowe** — gracz interesuje się tylko kortami deblowymi (do gry 2v2). Stosuj **dwie warstwy filtrowania**, niezależnie:

**Warstwa 1 — explicit `skipCourts` z `clubs.json`** (deterministyczne):

Niektóre kluby są w `clubs.json` z polem `skipCourts: [...]`. To są **znane** korty singlowe które ten klub nie oznacza w widocznym DOM-ie. Przy parsowaniu danego klubu pomiń każdy kort którego nazwa pasuje **word-boundary case-insensitive** do dowolnego elementu z `skipCourts`.

**Krytyczne — używaj `\b...\b` regex, NIE substring `.includes()`.** Substring match daje fałszywe pozytywy: `"kort 11".includes("kort 1") === true` powodowałoby wykluczenie deblowego `kort 1` w klubie z `skipCourts: ["kort 11"]`. Word boundary rozwiązuje to: `/\bkort 1\b/i.test("kort 11") === false` (cyfra `1` nie jest na granicy słowa, bo następna cyfra `1` przedłuża "słowo").

Implementacja w `browser_evaluate`:

```js
function shouldSkipCourt(courtName, skipCourts) {
  return skipCourts.some(item => {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(courtName);
  });
}
// shouldSkipCourt("kort 11", ["kort 10", "kort 11"]) → true   (poprawnie skipuje)
// shouldSkipCourt("kort 1",  ["kort 10", "kort 11"]) → false  (poprawnie zachowuje)
// shouldSkipCourt("Court 11", ["Court 11"])         → true   (case-insensitive)
```

Przykład: `interpadel-warszawa` ma `skipCourts: ["kort 10", "kort 11"]`. Poprawnie odrzuci `"kort 10"` i `"kort 11"`, ale **zachowa** `"kort 1"`, `"kort 2"`, ..., `"kort 9"` (wszystkie deblowe).

**Warstwa 2 — heurystyka DOM** (catch-all):

Niezależnie od `skipCourts`, pomiń kort jeśli **jakikolwiek** z poniższych tekstów (case-insensitive) zawiera podciąg `singl`:
- nazwa / nagłówek kolumny / nagłówek wiersza
- `aria-label` na korcie lub jego rodzicu/rodzeństwie
- atrybuty `data-*` (np. `data-court-type="singles"`)
- tooltip / `<title>` / opis pod nazwą
- klasy CSS na kontenerze kortu (np. `class="court court--singles"`)

`/singl/i` łapie polskie i angielskie formy: `single`, `Single`, `SINGLES`, `singiel`, `Singla`, `Kort singlowy`, `Pole singlowe`. Polski rdzeń `singl-` i angielski `singl-` mają wspólny prefix.

Jeśli kort pasuje do **dowolnej** warstwy → **w ogóle nie generuj `rawSlots` dla tego kortu**. Nie wchodzi do unionu w Kroku 4. Jeśli nie jesteś pewny — odrzuć (false positive jest bezpieczniejszy niż fałszywe okno z singlowego kortu).

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

### Implementation notes — selektory zaobserwowane w runach

Konkretne selektory wypracowane podczas wcześniejszych runów. **Używaj jako pierwszego strzału** zamiast eksperymentowania od zera. Jeśli przestaną działać (redesign strony) — wróć do heurystyki ze snapshotu i zaktualizuj tę sekcję.

#### kluby.org — DOM jest stabilny, parsuj przez `browser_evaluate`

Strona ma kilka tabel — **grafik to `document.querySelectorAll('table')[3]`**, a header z nazwami kortów to **`[2]`** (osobne tabele dla nagłówka i body, dlatego `<thead>` w `[3]` może być pusty).

Idź wprost do `mcp__playwright__browser_evaluate`, nie marnuj turn na snapshot:

```js
// w browser_evaluate:
const headerTable = document.querySelectorAll('table')[2];
const bodyTable = document.querySelectorAll('table')[3];
const courtNames = [...headerTable.querySelectorAll('th')]
  .map(th => th.textContent.trim())
  .filter(Boolean);
const rows = [...bodyTable.querySelectorAll('tr')];
// rows[i] to slot 30-min; pierwsza komórka to godzina, kolejne to korty
// kolejność kortów odpowiada courtNames
```

- Komórki z **linkiem o tekście "Rezerwuj"** (zwykle `<a>Rezerwuj</a>`) = wolne.
- Komórki bez "Rezerwuj" (puste, "Zarezerwowane", imię i nazwisko) = zajęte.
- **Rowspan**: rezerwacje 1h+ używają `rowspan=2` lub więcej. Komórka rezerwacji w wierszu N "zajmuje" też wiersze N+1, N+2 dla swojego kortu, mimo że w nich fizycznie nie ma `<td>`. Uwzględnij to przy mapowaniu komórek na sloty czasowe (np. trzymaj `nextFreeRow[courtIdx]` i przeskakuj wierze pokryte rowspanem).

#### Playtomic — sloty w `<details class="group/slot">`

Dostępne sloty są w **`<details class="group/slot">`**. Każdy `<details>` reprezentuje pojedynczą godzinę startu na konkretnym korcie i zawiera:
- `<summary>` z godziną startu (np. `"20:00"`),
- listę opcji czasu trwania w treści (zwykle `60` / `90` / `120` min — zależnie od dostępności kolejnych slotów).

```js
const slots = [...document.querySelectorAll('details.group\\/slot')];
// dla każdego: court name (z najbliższego rodzica/aria), start time (z summary),
// available durations (z linków/przycisków wewnątrz)
```

- **Filtr singla**: korty z nagłówkiem / `aria-label` typu `"kort N Singiel"` — pomijaj (zgodnie z regułą `/singl/i` z sekcji "Filtr kortów singlowych").
- **Strategia długości**: dla każdego dostępnego startu na korcie weź **maksymalny czas trwania** dostępny w tym `<details>`. To wyznacza koniec slotu. Przykład: start `20:00` z opcjami `60/90/120` → slot `20:00–22:00`.
- Jeśli w `<details>` jest tylko jedna opcja (np. tylko `60` min) — to zwykle oznacza brak ciągłości na ten kort dłużej. Bierz to co jest, union w Kroku 4 połączy.
- Niektóre kluby mają nagłówki kortów po polsku (`"Kort 1"`), inne po angielsku (`"Court 1"`) lub hiszpańsku (`"Pista 1"`). Heurystyka filtra singla i identyfikacja kortu powinny być case/lang-insensitive.

#### Wspólne — preferowany workflow per pair

1. `browser_navigate(URL)` → `browser_wait_for(time=2)` → **`browser_evaluate(parser)` zwraca `rawSlots[]` od razu**.
2. `browser_snapshot` rzucasz **tylko gdy `evaluate` zwróci podejrzany wynik** (puste, brak kortów, struktura niezgodna z opisem powyżej) — wtedy diagnozujesz przez snapshot i, jeśli odkryjesz nową strukturę, **zaktualizuj tę sekcję** w nowym PR.

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

## Krok 5 — Render HTML (i fallback plain text)

Mail wysyłany jest **jako HTML** (lepsze formatowanie w Gmailu) z plain-text fallbackiem. Renderuj **oba**.

### Sortowanie

- Sekcje per klub — alfabetycznie po `displayName`. Sekcja klubu pojawia się **zawsze** (nawet gdy brak wolnych okien — wtedy pokazuje notkę o braku, patrz niżej).
- W sekcji klubu: pogrupowane po dacie ↑, w grupie daty po `start` ↑.

### Mapowanie dni tygodnia (PL)

`Mon→poniedziałek, Tue→wtorek, Wed→środa, Thu→czwartek, Fri→piątek`.

### Format długości

`1.5h`, `2h`, `2.5h`, `3h`, ... (jeśli całkowita liczba godzin → bez ułamka; inaczej `.5h`).

Bez liczby kortów. Bez nazw kortów. Wystarczy info, że w tym przedziale jakiś (deblowy, niesinglowy) kort jest wolny.

### Klub bez wolnych slotów (≠ klub w `notChecked`)

Jeśli klub ma `clubReportSlots[klub]` puste dla wszystkich 5 dat **i** żadna z 5 dat tego klubu nie jest w `notChecked` (czyli udało się sprawdzić wszystkie dni, ale nigdzie nie ma wolnego okna ≥1.5h) — **pokaż sekcję klubu** z notką:

> Brak wolnych kortów w dniach {date_first}–{date_last} w przedziale 17:00–23:00.

(`date_first` = pierwsza z 5 sprawdzonych dat, `date_last` = ostatnia, format `DD.MM`.)

### Klub częściowo w `notChecked`

Jeśli klub ma niektóre daty w `clubReportSlots` z wolnymi oknami, a niektóre w `notChecked` — pokaż sekcję klubu **plus** wymień nieudane daty na końcu sekcji klubu:

> _Nie sprawdzono: DD.MM.YYYY — reason_

### Szablon HTML

Inline styles (Gmail nie ładuje zewnętrznych stylesheetów ani `<style>` w `<head>`). Max-width 600px, system font stack.

```html
<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;line-height:1.5;font-size:15px;">

<h1 style="font-size:22px;margin:0 0 4px 0;">Dostępność kortów padlowych</h1>
<p style="color:#666;margin:0 0 24px 0;font-size:13px;">Sprawdzono: {date_first_full}–{date_last_full} (5 dni roboczych)</p>

<!-- per klub: -->
<h2 style="margin:24px 0 8px 0;padding-bottom:4px;border-bottom:2px solid #eee;font-size:17px;">{Display Name}</h2>

<!-- jeśli klub ma sloty: dla każdej daty z wolnymi oknami: -->
<p style="margin:12px 0 4px 0;font-weight:600;font-size:14px;color:#333;">{DD.MM} {dzień_tygodnia}</p>
<ul style="margin:0 0 8px 0;padding-left:20px;">
  <li style="margin:2px 0;">{HH:MM}–{HH:MM} <span style="color:#888;font-size:13px;">({Xh})</span></li>
</ul>

<!-- jeśli klub bez slotów (sprawdzony, brak okien): -->
<p style="color:#888;font-style:italic;margin:8px 0 0 0;font-size:14px;">Brak wolnych kortów w dniach {DD.MM}–{DD.MM} w przedziale 17:00–23:00.</p>

<!-- jeśli klub częściowo nie sprawdzony: doklej na końcu sekcji: -->
<p style="color:#b85a00;font-style:italic;margin:8px 0 0 0;font-size:13px;">Nie sprawdzono: {DD.MM.YYYY} — {reason}</p>

<!-- sekcja Nie sprawdzono (globalna) — TYLKO jeśli któreś z (klub,data) są w notChecked: -->
<h2 style="margin:32px 0 8px 0;padding-bottom:4px;border-bottom:2px solid #eee;font-size:17px;color:#b85a00;">⚠️ Nie sprawdzono</h2>
<ul style="margin:0;padding-left:20px;">
  <li style="margin:2px 0;">{Klub} ({DD.MM.YYYY}) — {konkretny reason}</li>
</ul>

</body></html>
```

Format `{date_first_full}` / `{date_last_full}`: `DD.MM.YYYY`. Format `{DD.MM}` używaj wewnątrz sekcji klubów (rok wynika z kontekstu nagłówka).

### Szablon plain text (fallback)

Wysyłany w `text` polu Resend dla klientów bez HTML (rzadkie):

```
Dostępność kortów padlowych
Sprawdzono: {date_first_full}–{date_last_full} (5 dni roboczych)

{Display Name 1}
  {DD.MM} {dzień}:
    - HH:MM–HH:MM (Xh)
    - HH:MM–HH:MM (Xh)
  {DD.MM} {dzień}:
    - HH:MM–HH:MM (Xh)

{Display Name 2}
  Brak wolnych kortów w dniach {DD.MM}–{DD.MM} w przedziale 17:00–23:00.

⚠️ Nie sprawdzono
  - {Klub} ({DD.MM.YYYY}) — {reason}
```

### Szablon — wszystkie kluby bez wolnych slotów

Jeśli żaden klub × żadna data nie ma `clubReportSlots` z wolnymi oknami **i** żadna nie jest w `notChecked` (czyli wszystkie 30 par sprawdzone, wszystkie wynik = brak okna ≥1.5h):

```html
<p>W najbliższych 5 dniach roboczych żaden warszawski klub padlowy nie ma wolnego kortu w godzinach 17:00–23:00 na min. 1.5h gry.</p>
```

### Sekcja "⚠️ Nie sprawdzono" — globalna

Dodaj **tylko gdy `notChecked` jest niepusta**. Globalna sekcja na końcu listuje wszystkie nieudane (klub, data) pary. Sekcje per-klub mogą duplikować to (jak wyżej w "częściowo nie sprawdzony") — to OK, redundancja jest pożądana.

Jeśli **wszystkie** 30 par jest w `notChecked` → raport zawiera tylko nagłówek + globalną sekcję "Nie sprawdzono".

---

## Krok 6 — Wyślij email (Resend)

**Wysyłaj zawsze**, niezależnie od wyniku.

### Subject — z zakresem dat (rozdziela wątki w Gmailu)

Format: `Padel WWA — DD.MM–DD.MM.YYYY`

`DD.MM` = pierwsza i ostatnia z 5 sprawdzonych dat (rok = rok ostatniej daty, zwykle ten sam dla obu).

Przykład: dla dat sprawdzonych 04–08.05.2026 → subject `Padel WWA — 04.05–08.05.2026`.

Każdy run innego dnia → inny zakres dat → inny subject → **osobny wątek w Gmailu**. (Jedyny wyjątek: dwa runy w obrębie tego samego okna 5 dni roboczych — rzadkie i wtedy złączenie ma sens.)

### Body — HTML + plain text fallback

Resend API przyjmuje oba: `html` (renderowany w klientach pocztowych) i `text` (fallback). Wyślij oba.

```bash
HTML_FILE=$(mktemp)
TEXT_FILE=$(mktemp)
echo '<html raportu z kroku 5>' > "$HTML_FILE"
echo '<plain text raportu z kroku 5>' > "$TEXT_FILE"

PAYLOAD=$(jq -n \
  --arg from "$MAIL_FROM" \
  --arg to "$MAIL_TO" \
  --arg subj "Padel WWA — $DATE_FIRST–$DATE_LAST" \
  --rawfile html "$HTML_FILE" \
  --rawfile text "$TEXT_FILE" \
  '{from: $from, to: [$to], subject: $subj, html: $html, text: $text}')

curl -fsS -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
```

`$DATE_FIRST` / `$DATE_LAST` formatuj jako `DD.MM` dla pierwszej daty i `DD.MM.YYYY` dla ostatniej.

Jeśli `jq` niedostępne — zbuduj JSON ręcznie z escapowaniem (np. `node -e 'process.stdout.write(JSON.stringify({...}))'` — pamiętaj że HTML zawiera cudzysłowy, escape jest krytyczny).

### Reguły body

- **HTML:** musi być z inline styles (Gmail nie ładuje `<style>` w `<head>` ani zewnętrznych CSS). Pełny dokument `<!DOCTYPE html>...</html>`.
- **Text:** prosty, czytelny, bez markdown formatting (Gmail w plain text mode pokaże `**bold**` jako literalne gwiazdki).
- Bez preambuł ("Cześć", "Pozdrawiam"), bez załączników, bez CC/BCC.

### Retry

Jednokrotny. Jeśli `curl` zwróci kod ≥500 lub network error → odczekaj 5 sekund i powtórz raz. Jeśli drugi raz fail → zakończ z kodem błędu (logi routine pokażą problem w UI).

### Po wysłaniu

Zakończ. Nie generuj dodatkowego outputu w stdout poza krótkim potwierdzeniem typu `Email sent (id: …).` Raport jest dostarczony mailem.

---

## Ograniczenia

- **Bez retry dla scrapowania.** Jeden strzał na (klub, dzień). Niepowodzenie → wpis w `notChecked` z konkretnym reason.
- **Bez logowania** do serwisów rezerwacyjnych (poza kluby.org auth). Nie zakładaj kont, nie klikaj "Zarezerwuj".
- **Tylko odczyt grafiku.** Żadnej interakcji z formularzami rezerwacji.
- **Email priorytet.** Jeśli zbliżasz się do limitu turn / budżetu, przerwij scrape, **uzupełnij processedPairs do 30** (resztę do `notChecked` z reason `"budget exceeded — not attempted"`), złóż raport, wyślij email.
