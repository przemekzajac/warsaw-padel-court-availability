# Warsaw Padel Court Availability

Codzienny scheduled job (Claude Code on the web → Routines) sprawdzający dostępność kortów padlowych w 6 warszawskich klubach i wysyłający raport mailem.

## Cel

Każdego dnia roboczego rano (07:00 Europe/Warsaw) odpalany jest skill `padel-check`, który:
1. Wyznacza 5 najbliższych dni roboczych PL (z wyłączeniem weekendów i świąt państwowych).
2. Scrape'uje grafiki rezerwacji 6 klubów dla każdej z tych dat.
3. Filtruje wolne ciągłe okna ≥1.5h w godzinach 17:00–23:00 dla każdego kortu.
4. Renderuje markdown raport (grupowanie po klubie, sortowanie po dacie/godzinie).
5. Wysyła raport mailem przez Resend API.

## Kluby

| Klucz | Nazwa | Grupa |
|---|---|---|
| `padlovnia` | Padlovnia | kluby.org |
| `mana-padel` | Mana Padel | kluby.org |
| `toro-padel` | Toro Padel | kluby.org |
| `loba-padel` | Loba Padel | kluby.org |
| `interpadel-warszawa` | Inter Padel Warszawa | Playtomic |
| `warsaw-padel-club` | Warsaw Padel Club | Playtomic |

Definicje + URL templates: `.claude/skills/padel-check/clubs.json`.

## Stack

- **Runtime:** Claude Code on the web (Routines).
- **Scraping:** Playwright MCP (`@playwright/mcp`) — `WebFetch` zwraca 403 z `kluby.org` i `playtomic.com` (sprawdzone podczas planowania, antybot blokuje statyczny fetch). Headless Chromium konieczny.
- **Email:** Resend API (HTTP POST przez `curl`), bez Gmail / OAuth.
- **Timezone:** Wszystkie obliczenia dat w `Europe/Warsaw` (`TZ=Europe/Warsaw date ...`).

## Wymagane env vars (ustawiane w UI environment configuration)

| Zmienna | Opis |
|---|---|
| `RESEND_API_KEY` | Klucz API z resend.com |
| `MAIL_TO` | Adres odbiorcy raportu |
| `MAIL_FROM` | Adres nadawcy (np. `onboarding@resend.dev` lub własna zweryfikowana domena) |
| `KLUBY_USERNAME` | Login na kluby.org — grafik widoczny tylko po zalogowaniu |
| `KLUBY_PASSWORD` | Hasło na kluby.org |

**Bezpieczeństwo:** `KLUBY_PASSWORD` nigdy nie trafia do logu/maila/repo. Skill ma instrukcję nie cytować snapshotów strony logowania.

## Wymagany setup script

W environment configuration cloud routine:
```
npx -y playwright install --with-deps chromium
```

## Struktura repo

```
.claude/
├── settings.json              # permission allowlist
└── skills/padel-check/
    ├── SKILL.md               # główny prompt skilla
    ├── clubs.json             # definicje 6 klubów
    └── holidays.md            # reguła dni roboczych PL + Computus
.mcp.json                      # Playwright MCP config
CLAUDE.md                      # ten plik
```

## Jak uruchomić ręcznie (test)

W sesji Claude Code on the web na tym branchu:
```
/padel-check
```

Skill wykona pełen flow i zakończy mailem. W stdout pojawi się tylko status końcowy.

## Setup Routine (jednorazowo w UI)

1. claude.ai/code/routines → New routine.
2. Repo: ten branch.
3. Prompt: `Run /padel-check`.
4. Environment (Custom):
   - Network: `kluby.org`, `*.kluby.org`, `playtomic.com`, `*.playtomic.com`, `api.resend.com` (lub Full).
   - Env vars: `RESEND_API_KEY`, `MAIL_TO`, `MAIL_FROM`.
   - Setup script: `npx -y playwright install --with-deps chromium`.
5. Trigger: Schedule → Weekdays → 07:00.
6. Run now (test pierwszego runu).
