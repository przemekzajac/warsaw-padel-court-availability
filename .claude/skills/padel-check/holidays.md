# Polskie święta państwowe (dni wolne od pracy)

Referencja używana w kroku 1 promptu `padel-check` — wyznaczanie dni roboczych.

## Święta o stałej dacie

| Data | Nazwa |
|---|---|
| 01.01 | Nowy Rok |
| 06.01 | Trzech Króli |
| 01.05 | Święto Pracy |
| 03.05 | Święto Konstytucji 3 Maja |
| 15.08 | Wniebowzięcie NMP |
| 01.11 | Wszystkich Świętych |
| 11.11 | Święto Niepodległości |
| 25.12 | Boże Narodzenie (1. dzień) |
| 26.12 | Boże Narodzenie (2. dzień) |

## Święta ruchome

Liczone od daty Wielkanocy w bieżącym roku:

| Nazwa | Offset |
|---|---|
| Wielkanoc | +0 |
| Poniedziałek Wielkanocny | +1 dzień |
| Zielone Świątki | +49 dni |
| Boże Ciało | +60 dni |

## Algorytm: data Wielkanocy (Anonymous Gregorian / Computus)

Dla roku `Y` zwraca `(month, day)`. Implementacja referencyjna w shell/node:

```
a = Y mod 19
b = Y div 100
c = Y mod 100
d = b div 4
e = b mod 4
f = (b + 8) div 25
g = (b - f + 1) div 3
h = (19*a + b - d - g + 15) mod 30
i = c div 4
k = c mod 4
l = (32 + 2*e + 2*i - h - k) mod 7
m = (a + 11*h + 22*l) div 451
month = (h + l - 7*m + 114) div 31    # 3 = March, 4 = April
day   = ((h + l - 7*m + 114) mod 31) + 1
```

Przykład: dla 2026 → Wielkanoc = 5 kwietnia.

## Tryb obliczeniowy w prompcie

W kroku 1 SKILL.md wykonaj inline (Bash + node lub date arithmetic):

1. `Y = bieżący rok` (z `TZ=Europe/Warsaw date +%Y`).
2. Oblicz `easter(Y)` powyższym algorytmem.
3. Wygeneruj zbiór dat-świąt: stałe + `easter`, `easter+1`, `easter+49`, `easter+60`.
4. Iteruj `today, today+1, ..., today+N` aż uzbierasz 5 dat spełniających: `weekday ∈ Pn..Pt` ∧ `data ∉ świąt`.
