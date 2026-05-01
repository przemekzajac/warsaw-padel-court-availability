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
  - mcp__playwright__browser_close
---

# Padel availability check — Warszawa

Jesteś agentem zbierającym dostępność kortów padlowych. Wykonaj zadanie autonomicznie. **Finalna akcja zawsze wymagana: wysyłka maila przez Resend API.**

## Kolejność operacji

1. Wyznacz daty (krok 1)
2. Załaduj kluby (krok 2)
3. Scrape (krok 3)
4. Filtr okien + agregacja (krok 4)
5. Render markdown (krok 5)
6. Wyślij email (krok 6) — **zawsze, niezależnie od wyniku**

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

## Krok 3 — Scrape

Inicjalizacja: brak — pierwsze `mcp__playwright__browser_navigate` startuje sesję Chromium.

Iteruj sekwencyjnie po `(klub × data)` = 30 par. **Bez równoległości** — pojedyncza instancja browsera w MCP.

Dla każdej pary:

1. URL = `urlTemplate` z podstawioną `{date}`.
2. `mcp__playwright__browser_navigate(url=URL)`.
3. `mcp__playwright__browser_wait_for(time=2)` aby SPA zdążyło zarenderować, a dla kluby.org w razie czego dociągnęło DOM.
4. `mcp__playwright__browser_snapshot()` — pobierz accessibility tree.
5. Przeparsuj snapshot wg reguł poniżej. Zapisz wynik jako tablicę `freeWindows` per kort: `{ courtName, start: "HH:MM", end: "HH:MM", durationMin }`.
6. Przy błędzie / pustym snapshocie / 4xx / 5xx / Cloudflare: dopisz wpis do `notChecked` w postaci `{ club: displayName, date, reason }` i przejdź dalej. **Bez retry.**

Po wszystkich parach: `mcp__playwright__browser_close()` żeby zwolnić zasoby.

### Reguły parsowania

#### Grupa `kluby` (kluby.org)

Tabela grafiku: kolumny = korty (nagłówki kolumn = nazwy kortów), wiersze = sloty 30-min (godziny od ~07:00 do ~23:00).

- Komórka z **tekstem "Rezerwuj"** lub linkiem o tekście "Rezerwuj" = kort wolny w tym 30-min slocie.
- Komórka pusta / z imieniem rezerwującego / "Zarezerwowane" = zajęte.

Dla każdej kolumny (kortu):
1. Wybierz wiersze odpowiadające godzinom 17:00–22:30 (ostatni 30-min slot kończy się o 23:00).
2. Znajdź **najdłuższą ciągłą sekwencję wolnych komórek**.
3. Przelicz na okno: `start` = godzina pierwszej wolnej komórki, `end` = godzina pierwszej wolnej + 30·n minut, gdzie n = długość sekwencji.
4. Jeśli `(end - start) ≥ 90 minut` → dopisz do `freeWindows`. Inaczej odrzuć.

Jeśli kort ma kilka rozłącznych wolnych okien w 17–23 (np. 17:00–18:30 i 21:00–23:00) → bierz **każde z nich**, jeśli ≥1.5h. Implementacja: po znalezieniu maksymalnego okna kontynuuj skanowanie od jego końca.

#### Grupa `playtomic` (playtomic.com)

Playtomic to React SPA — snapshot zawiera siatkę dostępności jako lista przycisków/komórek z aria-label opisującym godzinę i status.

- Każda komórka = jeden slot na konkretnym korcie o konkretnej godzinie.
- Wolny slot: zwykle ma `aria-label` typu "X minut" / "Book" / nie-disabled, lub klasę CSS bez modyfikatora `unavailable`/`occupied`.
- Zajęty: aria-disabled, klasa zawierająca `unavailable` lub brak interakcji.
- Granularność zwykle 30 lub 60 minut zależnie od klubu.

**Strategia parsowania (snapshot accessibility tree):**

1. Zidentyfikuj nazwy kortów (zwykle nagłówki wierszy lub `aria-label` całej linii: "Court 1", "Pista 1" itp.).
2. Dla każdego kortu wyciągnij listę dostępnych godzin startu (przyciski "book" / "available").
3. Posortuj godziny rosnąco. Filtruj do zakresu starts ∈ [17:00, 22:30] (dla 30-min) lub [17:00, 22:00] (dla 60-min, bo +1h jeszcze mieści się w 23:00).
4. Wykryj granularność: jeśli różnice między kolejnymi dostępnymi slotami to wielokrotność 30 min — granularność 30 min; jeśli 60 — 60.
5. Znajdź najdłuższą ciągłą sekwencję dostępnych slotów: kolejne starty muszą być oddalone o `granularność`.
6. `start` = pierwszy slot, `end` = ostatni slot + granularność, `durationMin = end - start`. Jeśli `end > 23:00` przytnij do 23:00.
7. Jeśli `durationMin ≥ 90` → dopisz do `freeWindows`. W razie kilku rozłącznych okien — każde osobno.

**Half-cell (pół-wolne):** jeśli snapshot ujawnia osobne sloty 30-min (np. dwa komponenty 17:00 i 17:30 dla godziny 17–18), parsing automatycznie to obsłuży. Jeśli klub ma tylko sloty 60-min — half-cell ignorujemy (traktujemy całą godzinę jako jednostkę).

**Awaryjnie**, jeśli accessibility snapshot nie pozwala odróżnić wolnych od zajętych: użyj `mcp__playwright__browser_evaluate` z funkcją która zwróci listę kortów + dostępnych godzin czytając DOM bezpośrednio (np. `document.querySelectorAll('[data-testid="time-slot"]')`). Eksperymentuj na pierwszej parze, potem zastosuj ten sam selektor do reszty.

---

## Krok 4 — Filtr okien + agregacja

1. Odrzuć `freeWindows` z `durationMin < 90` (już powinno być zfiltrowane, ale upewnij się).
2. Przytnij okna do zakresu 17:00–23:00: `start = max(start, 17:00)`, `end = min(end, 23:00)`. Jeśli po przycięciu `< 90 min` → odrzuć.
3. **Agregacja:** dla każdego unikalnego trio `(klub, data, start, end)` policz liczbę kortów. Wpis raportu = `{ klub, data, start, end, durationMin, courtsCount }`.

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
