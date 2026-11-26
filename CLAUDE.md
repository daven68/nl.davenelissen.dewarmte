# DeWarmte Homey-app — werkafspraken en kennis

Community-app (niet van DeWarmte) die DeWarmte-warmtepompen (Pomp AO, Pomp T) naar Homey brengt.
Eigenaar: Dave (daven68). Communiceer in het **Nederlands**. Dave heeft zelf alleen een Pomp AO, zonder DeWarmte Element.

## Project
- TypeScript, Homey Apps SDK 3. Driver: `drivers/dewarmte/` (driver.ts, device.ts). API-laag: `src/api/` (client, auth, products, session, types). Hulpfuncties: `src/util/errors.ts`.
- Flow-kaarten: `drivers/dewarmte/driver.flow.compose.json`. Eigen capabilities: `.homeycompose/capabilities/`. `app.json` wordt door de Homey CLI gegenereerd uit de compose-bestanden.
- Widgets: `widgets/heat-pump/` (overzicht, bewust ongewijzigd laten) en `widgets/today/` ("Warmtepomp COP", periode-instelling dag/week/maand/jaar).
- Diagnosepagina: `settings/` + `api.js`. Rapporten van gebruikers komen binnen op dewarmtetest@icloud.com.

## Controleren na elke wijziging
- `npx tsc --noEmit` en `npm run lint` moeten schoon zijn.
- Testen op Daves Homey: `homey app run` (Docker Desktop moet aanstaan). Daarna `homey app install` zodat de versie blijft staan.

## Afspraken
- De app is **read-only**: nooit instellingen van de pomp wijzigen (stooklijn, boost, warmwater, legionella) zonder expliciet akkoord van Dave. Die endpoints bestaan (`/settings/...`), maar zijn bewust niet gebruikt.
- **Niet publiceren** naar Homey zonder akkoord van Dave. Pushen naar GitHub publiceert niets; de Action "Publish Homey App" is handmatig.
- Versie + wijzigingstekst (NL én EN) zet Claude direct in `app.json`, `.homeycompose/app.json`, `package.json`, `package-lock.json` en `.homeychangelog.json`. Niet de Action "Update Homey App Version" gebruiken (die kan maar één taal).
- Wijzigingstekst opbouwen als blokken: Nieuw / Verbeterd / Opgelost. Geen technische details die gebruikers niet merken.
  - Vorm: kopregel ("Nieuw:"), daaronder één regel per punt met "• " (regels gescheiden door \n). De changelog-popup van de App Store toont \n als regeleinde (pre-wrap); het blok "What's new" plakt alles op één regel, en dan blijven de bolletjes leesbaar. Punten kort houden.
- Versienummering: minor (1.x.0) voor nieuwe functies zolang alles achterwaarts compatibel is.
- Nooit `npm audit fix --force` (breekt eslint-config-athom). De resterende 'high'-meldingen zitten in dev-tooling van Athom.
- tsconfig blijft op node16: `compatibility` is `>=12.4.0` en Homey < v12.9 draait Node 16/18.
- Geen momentane COP tonen: Dave vindt COP alleen zinvol over een periode.
- Homey-types kennen `getId()` niet; in device-code `getData().id` gebruiken.

## DeWarmte API (https://api.mydewarmte.com/v1)
- Login: `POST /auth/token/`, verversen: `POST /auth/token/refresh/` (400/401 = login verlopen → SessionExpiredError → gebruiker gebruikt "Probeer te repareren").
- Status: `GET /customer/products/` (alle pompen + status), `GET /customer/products/tb-status/` (accountbreed: thermostaat, cv-ketel, buitentemperatuur).
- Insights: `GET /customer/products/{id}/insights/?start_date=YYYY-MM-DD&timespan=<resolutie>`.
  - timespan is de **resolutie**, niet de periode: Day=`hourly`, Week=`daily`, Month=`weekly`, Year=`monthly`, All=`yearly`. (`day` en `current` geven HTTP 400.)
  - Periodes zoals de DeWarmte-app: week vanaf maandag, maand vanaf de 1e, jaar vanaf 1 januari.
  - Antwoord o.a.: `cop`, `heat_sum` (geleverde warmte, kWh), `electricity_sum` (kWh), `electric_backup_usage_sum`, `has_dwe`.
  - DeWarmte werkt de kWh-tellers één keer per uur bij, ±1 minuut na het hele uur. Uurblok "19:00" = verbruik 18:00–19:00.
  - `electric_backup_usage_sum` (= `dwe_consumption`) is het kWh-verbruik van het DeWarmte Element. Het zit niet in `electricity_sum` en niet in `cop` (`cop` = `heat_sum / electricity_sum`); `heat_sum` bevat de warmte van het Element wel.
- Instellingen lezen: `GET /customer/products/{id}/settings/` (bevat o.a. stooklijn; voor Pomp T vermoedelijk `setpoint`, `warm_water_is_scheduled`, `warm_water_ranges`, `legionella_protection_day/_time`, `has_element`, `advanced_boost_mode_control`).
- Bron: de code van mydewarmte.com (`main.dart.js`, Flutter). De Home Assistant-integratie gebruikt de Insights-API niet.

## Pomp MP met DeWarmte Element (Marc, nov 2026)
- `status.electricity_consumption` is alleen de compressor. `status.electric_backup_usage` blijft 0 terwijl het Element draait; een live-vermogen van het Element bestaat niet in de API. Aan/uit staat alleen in `tb-status.is_element_on`.
- Het Element staat ook als apart product `MPE` in `/customer/products/` (lege status, Insights geeft HTTP 400).
- Daarom: Element-kWh per uur uit Insights in `meter_power` en `measure_backup_today`; `measure_power` blijft alleen de compressor (geen schattingen).

## Pomp T
- Statusvelden (rapport Wilco, juli 2026): `top_boiler_temp`, `bottom_boiler_temp`, `is_on`, `heat_input/output`, `electricity_consumption`, `water_flow`, `gas_boiler`, `errors`, `is_connected`. Geen `state`, `fault_code`, `is_element_on`.
- Voor warmwater/legionella/boost is eerst een diagnoserapport v2 van een Pomp T-gebruiker nodig (issue #1, Wilco: Pomp AO + Pomp T op één account).
- Mogelijk staat het DeWarmte Element bij sommige klanten als apart product in `/customer/products/` (producttype "element"); dan behandelt de app het nu als warmtepomp.

## Status (november 2026)
- 1.2.9 wacht op goedkeuring door Athom; 1.3.0 is klaar maar wordt pas gepubliceerd na die goedkeuring. Nieuwe wijzigingen tot dan onder 1.3.0.
- Plan: zodra Athom 1.2.9 goedkeurt, meteen 1.3.0 publiceren (pas na akkoord van Dave). 1.3.0 staat al op Daves Homey (homey app install, 20 nov 2026).
- Na publicatie 1.3.0:
  - Wilco, issue #1: excuus voor de late reactie en 3 nieuwe rapporten vragen.
  - Ronald, issue #2: status koelen zit erin; vragen om een diagnoserapport v2 terwijl de pomp koelt (om te bevestigen dat `state` dan `cooling` is).
  - Michiel, issue #3: iconen zitten erin, forken is niet meer nodig.
- John is al per mail geïnformeerd over de herstelde cv-ketelmelding (issue #4).
- Ideeën: stooklijn alleen tonen; Pomp T-warmwatergegevens; boost/stooklijn bedienen pas na overleg.
