# Source Register — Market Research

**Task:** W0-C · **Probed:** 2026-07-27 · **Method:** direct HTTP fetch, browser rendering, PDF/XLSX extraction
**Owner:** W0-C · **Confidentiality:** competitor intelligence — internal to Wamocon. Do not publish.

This register covers **market** sources. It is distinct from [`SOURCES.md`](../../SOURCES.md), which W0-B
owns and which registers **project** sources for Azura World itself. Where this document needs a
project fact it cites `SOURCES.md` by its numeric id (`SOURCES.md #7`) or finding id (`F-002`).
**No entry is duplicated between the two registers.**

---

## 0. How to read this register

| Column | Meaning |
|---|---|
| **id** | Stable citation key used across all W0-C documents |
| **Tier** | 1 official/statistical · 2 trade body / developer · 3 trade press · 4 portal · 5 aggregator/press · 6 agency blog / secondary |
| **HTTP** | **The result actually obtained on 2026-07-27**, not the result expected |
| **Reliability** | What the source may be used for, and what it must not be used for |

**Three rules govern every row.**

1. **A URL appears here only if it was actually attempted.** Failures are recorded, not hidden — a
   403 or an empty body is a finding about source availability.
2. **HTTP 200 is not evidence on several of these hosts.** `veriportali.tuik.gov.tr`,
   `evds3.tcmb.gov.tr` and `endeksa.com` return 200 with an empty JavaScript shell for *any* path,
   including deliberately invalid control paths (S-004, S-005, S-048). `dask.gov.tr` returns 200 on
   soft-404 redirects (S-077). **Any link-checker built for this project must compare response
   bodies, not status codes.**
3. **Portal listings are asking prices, never transaction prices.** Every tier-4/5/6 row carrying a
   price inherits that caveat.

---

## 1. Official, statistical and regulatory sources (`S-`, `G-`)

### 1.1 TÜİK — Turkish Statistical Institute

| id | URL | Tier | HTTP | Yield | Reliability |
|---|---|---|---|---|---|
| S-001 | `tuik.gov.tr/` | 1 | 200, 429,911 B | Server-rendered index | Live |
| S-002 | `data.tuik.gov.tr/` | 1 | 200 → redirect | Shell only | **Legacy host retired**, redirects to veriportali |
| S-003 | `veriportali.tuik.gov.tr/` | 1 | 200, 1,947 B | **None** — empty React shell | See rule 2 |
| S-004 | `veriportali.tuik.gov.tr/asdkjhasdkjh` *(control)* | 1 | 200, 1,947 B | None | **Control probe: identical 200 for a nonsense path** |
| S-005 | `veriportali…/Bulten/Index?p=DOES-NOT-EXIST-99999999` *(control)* | 1 | 200, 3,692 B | None | **Control probe: 200 from this host carries zero information** |
| S-006 | `tuik.gov.tr/Home/HaberBultenleriPartial` | 1 | 200, 108,711 B | **Real bulletin index** with titles, dates, headline values | The working route into TÜİK without a browser |
| **S-007** | `veriportali.tuik.gov.tr/tr/press/58344` | 1 | Shell via fetch; **rendered in browser** | **Konut ve İş Yeri Satış İstatistikleri, Haziran 2026, Sayı 58344, published 17 Jul 2026** | **Primary.** Transaction *counts* only — contains no price data whatsoever |
| **S-008** | `databrowser2.tuik.gov.tr` → `DF_YABANCILARA_SATILAR_ILILCE_V3` | 1 | 200, SDMX-JSON | **Antalya-province foreign-buyer series 2013–2026** | **Primary microdata.** Series self-validates: months sum to the annual figure |
| S-009 | `…/datasets/DF_YABANCILARA_SATILAR_ILILCE_V3/data` (POST) | 1 | 200 | Same, unauthenticated | Public API |
| S-010 | `…/codelist/REF_AREA` (POST) | 1 | **401** | None | **District (level-4) geography requires a portal login** |
| S-011/012 | `nsiws.tuik.gov.tr/rest/{dataflow,categorisation}/TR/all` | 1 | **401** | None | SDMX web service needs a Keycloak token |
| S-013/014 | `tuik.gov.tr/Bulten/Index?p=…58344`, `/DownloadIstatistikselTablo?p=58344` | 1 | **404** | None | — |
| S-015 | `veriportali…/api/press/58344`, `/api/v1/press/58344` | 1 | **404** | None | — |
| S-016 | `biruni.tuik.gov.tr/medas/` | 1 | 200, 67,534 B | Legacy MEDAS reachable | Not driven to a result |
| M-04 | `databrowser2` → `DF_YABANCILARA_SATIS_V3` | 1 | 200 | Türkiye annual foreign house sales 2013–2025 | Primary |
| M-05 | `databrowser2` → `DF_UYRUKLARA_GORE_ILILCE_V3` | 1 | 200 | **Antalya buyers by nationality, 139 countries** | Primary. Nationality table sums ~1 % above the province headline — a discrepancy in TÜİK's own data |
| M-02 | `data.tuik.gov.tr/Bulten/Index?p=…Haziran-2025-54141` | 1 | 302→200 (browser) | June 2025 bulletin; Antalya 603 | Superseded series name |
| G-14 | `veriportali.tuik.gov.tr/tr/press/53899` | 1 | Shell via curl; **rendered in browser** | ADNKS 2025, **Sayı 53899, 09.02.2026**, ref. 31.12.2025; Antalya 2,777,677; Türkiye 86,092,168 | Primary. **No Alanya district figure in the bulletin text** |

> **Series rename — a trap worth recording.** The bulletin is *"Konut Satış İstatistikleri"* up to
> Aralık 2025 and *"Konut ve İş Yeri Satış İstatistikleri"* from Ocak 2026. Anyone searching the old
> title concludes the series stopped. `[V]`

### 1.2 TCMB — Central Bank

| id | URL | Tier | HTTP | Yield | Reliability |
|---|---|---|---|---|---|
| **P-12** | `tcmb.gov.tr/kurlar/today.xml` | 1 | 200 | **Bülten 2026/137, 27.07.2026 — EUR/TRY döviz satış 53.9717; USD/TRY 47.3533** | **Verified independently by W0-C.** The only FX rate used anywhere in these documents |
| **S-022 / M-06** | `tcmb.gov.tr/…/KFE.pdf` | 1 | 200, 854,903 B, 6 pp | **Konut Fiyat Endeksi, Haziran 2026** — full text | **Primary and the best price signal available.** An *index* (2023=100), **not a price level** — it cannot be converted to €/m² |
| S-021 / M-07 | `…/Reel+Sektor+Istatistikleri/Konut+Fiyat+Endeksi/` | 1 | 200, 51,464 B | Landing page, real hrefs | Server-rendered |
| S-023 / M-08 | `…/KFE-Tablo.pdf` | 1 | 200, 107,580 B | Index of EVDS3 portlet links | Links only, all JS-dead |
| S-019 | `evds2.tcmb.gov.tr/` | 1 | 200 → evds3 | None | **EVDS2 retired** |
| S-020 / M-39 | `evds3.tcmb.gov.tr/` and `/charts/portlet/…` | 1 | 200, 1,355 B each | **None** — JS shell on every path | Browser navigation to origin **denied**. TRY/m² unit prices unobtainable |

### 1.3 Land registry, tourism ministry, migration, insurance

| id | URL | Tier | HTTP | Yield | Reliability |
|---|---|---|---|---|---|
| **S-027** | `tkgm.gov.tr/sites/default/files/2024-02/KILAVUZ-01-02-2024_1.pdf` | 1 | 200, 258,551 B | **Citizenship-by-investment guide: USD 400,000 threshold, kat mülkiyeti condition, 3-year lock** | Official, but **dated 01.02.2024 — ~2.5 years old**. The weakest-currency load-bearing regulatory fact here |
| S-024 | `tkgm.gov.tr/` | 1 | 200, 130,911 B | Index | — |
| S-025 | `/istatistikler`, `/kurumsal-istatistikler`, `/yabanciya-satis-istatistikleri` | 1 | **404** ×3 | None | — |
| S-026 | `tkgm.gov.tr/tkgm/istatistik` | 1 | 200, 45,537 B | **No data** — nav chrome only, figures JS-loaded | **TKGM contributed nothing statistical** |
| S-028 | browser nav to `tkgm.gov.tr` | 1 | **Denied** | None | Origin gate |
| **S-056** | `mevzuat.gov.tr/MevzuatMetin/1.3.2644.pdf` | 1 | 200, 235,810 B | **Tapu Kanunu 2644 Art. 35/36** — 10 % district cap, 30 ha personal cap, military-zone regime | **Primary legislation, consolidated.** No "as-at" date on its face — re-verify before client use |
| S-057 | `…/1.5.5901.pdf` | 1 | 200, 636,859 B | Citizenship Law 5901 Art. 12 | Primary |
| S-058 | `…/1.5.6305.pdf` | 1 | 200, 517,759 B | Disaster Insurance Law 6305 | Primary |
| S-059 | `…/1.5.6458.pdf` | 1 | 200, 432,365 B | Foreigners & Int'l Protection Law 6458 | Downloaded; **residence articles not extracted** |
| S-060 | `…/3.5.{20100139,2010139,20109817}.pdf` | 1 | 200 but `text/html` | **None** | **Citizenship Regulation text never retrieved** — see GAP 13 |
| S-053 | `resmigazete.gov.tr/eskiler/2023/12/20231212.htm` | 1 | 200, 28,183 B | **Confirms Karar Sayısı 7938, RG 12.12.2023 Sayı 32397** | Official |
| S-051 | `resmigazete.gov.tr/eskiler/2022/06/20220613.htm` | 1 | 200, 8,741 B | **Refuted a recollection** — no citizenship item in RG 31865 | Recorded as a self-correction |
| P-33 | `resmigazete.gov.tr/fihrist?tarih=2022-05-13` | 1 | 200 | RG 13.05.2022 **Sayı 31834, Karar 5554** — instrument identity | Official |
| P-34/P-35 | `…/20220513-2.pdf`, `-2.htm` | 1 | 200 unparseable / **404** | None | Wrong document number; correct file is `-20.pdf` |
| P-36 | `alomaliye.com/…karar-sayisi-5554/` | 6 | 200 | 250k→400k USD; 3-year hold | **Tier-6 reproduction of the official text**, not the text |
| **S-062** | `goc.gov.tr/ikamet-sss` | 1 | 200, 247,073 B | *"taşınmazın konut olması ve bu amaçla kullanılması gerekir"* | Official FAQ |
| P-39 | `goc.gov.tr/ikamet-izni-cesitleri` | 1 | 200 | Law 6458 Arts 31–33; max 2 years per issuance; **no minimum value stated** | **Its silence on the USD 200k threshold is itself the finding** |
| **S-066** | `goc.gov.tr/…/Kapali_Mahalleler-_31082022_.xlsx` | 1 | 200, 51,536 B | **1,162 closed mahalle across 63 provinces** | **Machine-readable primary.** Settles the 2022 position exactly |
| **S-067** | `antalya.goc.gov.tr/…/Kapali_Mahalleler.xlsx` | 1 | 200, 9,964 B | Antalya extract | Primary |
| S-064/065 | `goc.gov.tr/mahalle-kapatma-duyurusu-hk2`, Antalya version | 1 | 200 | Closure announced 30.06.2022, effective 01.07.2022, 781→1,169 | **Names no district; the list is the attachment** |
| S-063/068 | `goc.gov.tr/duyurular`, `antalya.goc.gov.tr/` | 1 | 200 | **No neighbourhood announcement newer than 2022-era** | Basis for GAP 12 |
| S-075 / M-38 | `yourkeyturkiye.gov.tr/vatandaslik-kazanimi` | 1 | **TLS: "unable to verify the first certificate"**; 200 via PowerShell | Partial | **An official .gov.tr host with an incomplete certificate chain.** Recorded, not bypassed |
| S-078/079 | `dask.gov.tr/tr/konut-kredileri-ve-tapu-islemleri`, `/tr/kanun` | 1 | 200 | **Law 6305 Art. 11(2)** — land registries may not register without valid DASK | Primary; mutually corroborating |
| S-077 | `dask.gov.tr/tr/zorunlu-deprem-sigortasi` | 1 | **200 → soft-404** | None | See rule 2 |
| S-071/072/073/074 | NVİ, MFA, invest.gov.tr | 1 | 200 / **404** | Nothing on the investment route | invest.gov.tr citizenship page 404s |

### 1.4 Tourism, transport and municipal (`G-`)

| id | Publisher | URL | Tier | HTTP | Yield | Reliability |
|---|---|---|---|---|---|---|
| **G-01** | KTB / YİGM | `yigm.ktb.gov.tr/Eklenti/145776,yillik-bulten-2025xlsx.xlsx` | 1 | 200, 466 KB | **Certified facilities by district at 31.12.2025** — Alanya 5★ **99 tesis / 36,206 oda / 78,871 yatak**; Antalya 1,174 / 511,680 beds; Türkiye 8,159 / 1,225,633 | **Primary, dated, district-resolved.** Stops at district — no mahalle |
| **G-02** | KTB / YİGM | `yigm.ktb.gov.tr/Eklenti/150023,tm-ktkgb-listesi--2-xlsx.xlsx` | 1 | 200, 32 KB | **240 tourism-designation entries** incl. Alanya Batısı TM (1,588.99 ha, 1989/14499), İncekum TM (1986/10792), **Türkler Akyar TM (2012/2901)**, Okurcalar Ortaören TM | **Primary register.** RG date columns are Excel serials, not decoded |
| G-03 | KTB / YİGM | `yigm.ktb.gov.tr/TR-9669/…` | 1 | 200 | TM/KTKGB definitions; legal basis **Law 2634** | Primary |
| G-04 | KTB / YİGM | `…/Eklenti/148357,mayis-2026-bultenixls.XLS` | 1 | 200, 3.7 MB | Jan–May 2026 **Antalya 3,245,959 foreign arrivals (21.32 %)**; May 2026 33.34 % | Primary. **Gate-level rows not reliably parsed** |
| S-030/031/032 | KTB / YİGM | accommodation + facility statistics pages | 1 | 200 | **Latest accommodation file 2022; latest facility file 2017** | 2017 file is **8.5 years stale**, province-level only |
| S-034 | KTB / YİGM | `/TR-201118/sinir-giris-cikis-istatistikleri.html` | 1 | 200 → **redirect to veriportali** | Shell | **Border arrivals handed to TÜİK**, lands JS-dead |
| **G-05** | DHMİ | `dhmi.gov.tr/…/Attachments/429/TÜMÜ.xlsx` | 1 | 200, 68 KB | **FY2025 pax: Antalya 39,000,177 (+2.27 %); Gazipaşa-Alanya 992,383 (−3.43 %)** | Primary. **Found by attachment-ID probing — not linked from the live page** |
| G-06 | DHMİ | `…/Attachments/437/TÜMÜ.xlsx` | 1 | 200, 78 KB | H1 2026: Antalya 13,654,494 (−5.53 %); Gazipaşa 341,213 (−10.51 %) | Primary, explicitly **"Kesin Olmayan"** (provisional) |
| G-07 | DHMİ | `…/Attachments/437/YOLCU.pdf` | 1 | 200 | Same data — **text layer misaligns labels vs numbers** | **Do not use the PDF; use the xlsx** |
| **G-08** | KGM | `kgm.gov.tr/…/Uzakliklar/ilcemesafe.xlsx` | 1 | 200, **28 MB** | **Alanya→Gazipaşa 47 km; Alanya→Antalya Merkez 137 km; →Aksu 119 km; →Manavgat 59 km** | **Authoritative road distances.** District-centre to district-centre only — **no mahalle resolution** |
| G-09 | KGM | `/sayfalar/kgm/sitetr/kurumsal/yolagi.aspx` | 1 | 200 | 68,517 km network at 01.01.2026 | **Makes no mention of "D-400"** |
| G-10 | KGM | `…/25TrafikUlasimBilgileri.pdf` | 1 | 200, **43 MB** | Road 400 sections **400-01…400-37**; Antalya holds 400-04…400-08, 400-12/13 with AADT | Section **endpoint names absent from the text layer** |
| **G-11** | Alanya Belediyesi | `alanya.bel.tr/S/443/Muhtarlar` | 1 | 200, static HTML | **Türkler, Konaklı, Avsallar, Payallar, Okurcalar all listed as `MAH.MUH.`** | Primary, municipal — definitive on mahalle status |
| G-12 | Alanya Belediyesi | `…/Documents/StratejikPlan/2020/stratejikplan.pdf` | 1 | 200, 3.1 MB | **Batı-1 / Batı-2 sub-regions; Türkler in Batı-2**; 102 mahalle | Primary. **Reference year for the stat table not printed** |
| G-13 | Alanya Belediyesi | `/Haber/77781/…` (19.01.2023) | 1 | 200 | D-400 alternative route naming Okurcalar…Elikesik incl. Türkler | Primary; corridor association, not a route map |
| S-044/045/046 | Alanya Bel. / Antalya BB | site roots, `/sayfa/alanya-hakkinda` | 1 | 200 / **404** | **No Türkler-level data located** | — |
| G-15 | Antalya İl KTM | `antalya.ktb.gov.tr/TR-175694/…tur-ve-s-.html` | 1 | 200 — **actually a PDF despite `.html`** | Antalya 5★ 219 işletme / 181,188 beds | **Dated 08.06.2012, marked "(Veriler geçicidir.)" — 14 years stale** |
| G-16 | gzpairport.com (TAV) | `gzpairport.com` | 3 | 200 | Operator TAV; expansion works Jan–Oct 2026 | **Publishes no distance data** |

### 1.5 Trade bodies

| id | Publisher | URL | Tier | HTTP | Yield | Reliability |
|---|---|---|---|---|---|---|
| **S-043 / M-09** | **ALTSO** | `altso.org.tr/wp-content/uploads/2025/09/alanya-ekonomik-rapor-2024.pdf` | 2 | 200, **11,373,175 B, 134 pp** | **The richest source in this study.** Alanya population 361,873 / 102 mahalle; **Türkler population 4,949**; accommodation stock 604 facilities / 82,449 rooms / 176,008 beds; **Tablo 6** hotel-by-hotel certified register with mahalle, class, address, rooms, beds; **Tablo 7** BKT register; foreign-buyer tables | **Downloaded and parsed independently by W0-C** (see §4). ISBN 978-625-390-040-3, published **17 Sep 2025**, covering **2024**. Hotel data sourced to **Antalya İl Kültür ve Turizm Müdürlüğü**. Two limits: (a) **no 2025 edition exists as of July 2026** — do not present as current; (b) it is a chamber of commerce promoting its own district — use the tables, treat the prose as advocacy |
| S-042 | ALTSO | `/yayin-kategorisi/alanya-ekonomik-rapor/` | 2 | 200 | Correct index; latest = 2024 | — |
| S-041 | ALTSO | `/yayinlar/`, `/alanya-ekonomik-rapor/`, `/kategori/raporlar/` | 2 | Conn. reset / soft-404 | None | Guessed paths, all wrong |
| M-42 | ALTSO | `…/web-sicil30062015.pdf` | 2 | 200, 9 pp | **0 "Cebeci" occurrences** in the 2015 dissolution schedule | Negative finding in the developer's favour |
| P-47 | ALTSO | `/en/bilgi-hizmetleri/ikamet-izni/` | 2 | 200 | *"Sorry, this entry is only available in Turkish"* | **No ALTSO housing-price report located** |
| **S-039** | GYODER | `portal.gyoder.org.tr/…/GYODER Gösterge -sayı 43-tek sayfalı.pdf` | 2 | 200, **11,682,166 B** | FY2025 sales 1,688,910; **Q1 2026 foreign sales by province: İstanbul 1,939, Antalya 1,196, Mersin 239**; **national gross rental yield ~5.2 %→5.8 %** | **Free despite the "portal" path.** **Contains zero occurrences of "Alanya".** Its yield is a *national* average dominated by İstanbul/Ankara apartment stock — **must never be presented as an Alanya or resort yield** |
| S-037/038 | GYODER | site root, `/yayinlar/gyoder-gosterge` | 2 | 200 | Gösterge 40–43 index | — |

---

## 2. Market and developer sources (`M-`)

| id | Publisher | URL | Tier | HTTP | Yield | Reliability |
|---|---|---|---|---|---|---|
| **M-12** | Cebeci Group | `cebecigroup.com/en/projects` | 2 | 200 | **28 project entries counted** | **Re-counted independently by W0-C: 28, not the 26 the brief states.** Masthead "SINCE 1982" |
| M-13 | Cebeci Group | `/tr/projeler` | 2 | 200 | 28, identical list | Both languages agree |
| M-14 | Cebeci Group | `cebecigroup.com/` | 2 | 200, 62,655 B | 1982 / Oktay Cebeci; **"4000 apartments and 2 hotels"**; "one of the largest" | Self-published claim |
| M-15 | Cebeci Group | `/tr/hakkimizda` | 2 | 200, 51,898 B | **"3500 konut, 3 otel ve 1 iş hanı"** — contradicts M-14 | **The company's own track record is unstable across its two language versions** |
| M-16 | Cebeci Group | `/en/about` | 2 | 200 | Directors; "spanning 40 years" | `/en/about-us` returns **500** |
| **M-17 / C-02** | Cebeci Group | `/en/azura-world-residence-hotel` | 2 | **200** | **76,000 m²; construction "2021-2024"; "private beach"; "Turkey's largest Residence & Hotel & Entertainment concept project"** | **Verified independently by W0-C. Recovers a tier-2 source that `SOURCES.md` records as 500** — the ticket URL carries a spurious `/project/` segment. **Publishes no unit count, block count or price** |
| M-44 | Cebeci Group | `/en/project/azura-world-residence-hotel` | 2 | **500** | None | The stale URL scheme in the ticket |
| M-18 / C-07 | Cebeci Group | `/en/azura-deluxe-resort-and-spa-hotel` | 2 | 200 | 12,000 m²; **330 rooms**; 70 m Blue Flag beach | **Contradicted by the official register** — see §4 |
| M-19 | Cebeci Group | `/en/wyndham-hotel-alanya` | 2 | 200 | 2023–2025; 35,106 m²; Türkler | Land size **duplicates M-20** |
| M-20 / C-05 | Cebeci Group | `/en/cebeci-vista` | 2 | 200 | 2023–2025; 35,106 m²; Kestel | **Byte-identical figures to M-19 — almost certainly a CMS copy-paste error. Neither is reliable** |
| M-21 / C-04 | Cebeci Group | `/en/cebeci-towers` | 2 | 200 | 2020–2022; sea 0 m; **header 7,500 m² vs body 10,000 m²** | Internally inconsistent |
| M-22 / C-03 | Cebeci Group | `/tr/arnelya-beach-residence` | 2 | 200 | 2018–2019; 1,902 m²; **31 units itemised (sums correctly)**; €1,000–1,300/m² | **Page contradicts itself on district** (header Mahmutlar, body Kestel) |
| M-23 / C-08 | Cebeci Group | `/en/azura-park-residence` | 2 | 200 | 2011–2013; 26,000 m²; **607 units itemised (sums correctly)** | Best-corroborated Cebeci project |
| M-24 / C-06 | Cebeci Group | `/en/alanya-country-club` | 2 | 200 | **District + gallery only — zero figures** | A reachable page with no data |
| M-33 | Azura World | `azuraworld.com/` | 1 | 200 | Mirrors the "Turkey's largest" claim | Thin microsite (see `SOURCES.md #1`) |
| M-43 | Cebeci legacy | `alanyacebeci.com` | 2 | **DNS SERVFAIL** | None | Domain dead; still cited by M-30 |
| **M-25** | Turizm Güncel | `turizmguncel.com/haber/ahmet-cebeci-wyndham-markasini-alanyaya-getiriyor` | 3 | **200** | 11 Mar 2023 — Wyndham licence for the Azura World hotel component | **Recovered — `SOURCES.md #23` records this as 403** |
| **M-26** | Wyndham H&R (wire) | `tradingview.com/news/reuters.com,2025-06-24:…` | 3 | 200 | **Operator's own release, 24 Jun 2025: Wyndham Alanya, five-star, 188 guest rooms**, quotes from Dimitris Manikis and Ahmet Cebeci | **Strongest hotel-side source** — the listed franchisor's own announcement |
| M-27/M-28 | BW Hotelier / Today's Traveller | trade articles | 3 | 200 | Same release, 188 keys | Corroboration |
| M-29 | Emlak Kulisi | `emlakkulisi.com.tr/keywords/cebeci-insaat-alanya` | 3 | 200 | 03.02.2012: "30 years"; Azura Park 26,000 m² / 607 units; **2012 asking prices €70k/€137k/€168k** | Independent corroboration of M-23. **2012 prices — no bearing on current values** |
| M-30 | EMIS | `emis.com/php/company-profile/TR/Cebeci_Grup_…` | 5 | 200 | Legal entity **incorporated 27 Jun 2002**; Muratpaşa HQ | Commercial vendor; key fields paywalled |
| M-31 | Find.com.tr | `find.com.tr/Company/…` | 5 | 200 | **Cebeci Global Turizm A.Ş.** operates Azura Deluxe, same address | Registry-derived; ID values absent |
| M-32 | Azura Deluxe | `azuradeluxe.com` | 3 | 200 | 12,000 m² + 70 m beach | **Publishes no star rating and no room count** |
| M-34 | Wikipedia (TR) | `tr.wikipedia.org/wiki/Türkler,_Alanya` | 5 | 200 | Mahalle via Law 6360 (12.11.2012); belde from 31.12.1991; **pop. 7,240 (2000)**; 15 km / 120 km | **Superseded on population by ALTSO** — see §4 |
| G-17 | Wikipedia (EN) | `en.wikipedia.org/wiki/Türkler,_Alanya` | 5 | 200 | Pop. 4,798 (2022, TÜİK ADNKS) | Closer to ALTSO's 4,949 than the TR article |
| M-35 | Wikipedia (EN) | `…/State_road_D.400_(Turkey)` | 5 | 200 | 2,057 km, Datça → Iranian border | Tertiary. TR article gives 1,976 km and **"37 sections", which matches KGM's 400-01…400-37** |
| M-36 / P-19 | Yeni Alanya (relaying Endeksa) | `yenialanya.com/antalya-konut-verileri-aciklandi…` | 5 | 200 | **Endeksa June 2026: Alanya 59,938 TL/m², avg 6,593,180 TL, +22.14 %; Antalya 55,264 TL/m², +26.93 %.** Published 21 Jul 2026 | **A portal estimate relayed by a newspaper — two steps from primary.** Not official, not transaction prices |
| M-37 / S-047 | Endeksa | `endeksa.com/…` (6 URL forms) | 3 | **200 with empty JS shell / bot wall** | **None** | S-048 control: **byte-identical response for a nonsense path** |
| P-30 | Yeni Alanya | `/yabanciya-konut-satisinda-alanya-zirvedeki-yerini-birakmadi` | 5 | 200 | **Russian purchases in Alanya: 2022 6,640 · 2023 4,203 · 2024 2,352 · 2025 1,662; 2026 Jan–Apr 368** | Published 12.06.2026. **Article is ambiguous whether the district figures come from TÜİK or Alanya Tapu Müdürlüğü** |
| P-24…P-29, P-31, P-32 | Turkish press | gayrimenkulhaber, ahaber, antalyaekspres, cumhuriyet, tasinmazhaber, odatv, emlakkulisi, tapusor | 5 | 200 ×6, **403 ×2** | TÜİK June 2026 relays | **Superseded by S-007/S-008 primaries.** One relay reported 2,115/+14.1 % against TÜİK's own **2,015/+20.1 %** — a live demonstration that press summaries of TÜİK are unusable |
| P-43/P-44 | gundemalanya / gazetealanya | Alanya reopening reports | 5 | 200 | Reopening attributed to a **party district chairman** and to **trade-body presidents**; official letters stated as pending | **A political announcement, not an instrument.** See GAP 12 |
| P-45/P-46 | decker-realestate.com | ikamet blacklist / district comparison | 6 | 200 | Claims 4 Alanya mahalle closed; "5–8 % p.a." yield claim | Agency blog citing a phone enquiry. **Contradicted 8 days later by P-43/P-44** |
| P-66 | Ideal Estates | Antalya price guide | 6 | 200 | Alanya €1,000–1,073/m² | **Self-describes its figures as "illustrative"** — do not cite as data |

---

## 3. Competitive-set and price/buyer sources (`C-`, `P-`)

Full per-source detail is carried in [`Competitive-Set.md`](Competitive-Set.md) §2 and §4. Summarised here:

### 3.1 Competitive set — 46 URLs attempted, 36 × 200

| Group | ids | Outcome |
|---|---|---|
| Cebeci Group project pages | C-01…C-08 | All 200. Highest-authority list in the set; **status column demonstrably stale** |
| New Level Group / New Level Premium | C-09…C-17, C-44 | Developer page 200 (**completion "July 2026"** — re-verified by W0-C); six portals 200; `siberia-turkey.com` **301 → newlevel-group.com**, proving the entities are one |
| Goldcity | C-23, C-24, **C-25 (tier 1 operator, 211,677 m² — re-verified by W0-C)** | 200 |
| Konak Seaside Premium / Resort | C-18, C-19, C-20 | 200; **C-38 developer host TLS "certificate has expired"** |
| Yekta Kingdom Premium | C-21 (developer), C-22 | 200; **unit count contested 720 vs 220** |
| Exodus Resort | C-29, C-30, C-31 | 200; **three hosts, three beach distances** |
| Emerald Park / ART LIFE | C-27, C-28 | 200; both stale or commission-inclusive |
| **New Azura World sources** | **C-32** antalyahomes.com, **C-33** newlifeturkey.com/de | 200. **Two new price observations widening F-002** |
| Strip-wide index | C-34 (≈200 residences), C-35, C-45, C-46 | 200 but little yield |
| Failed | C-37 **403**, C-39/C-40 **404**, C-41/C-42/C-43 **DNS**, C-38 **TLS** | 9 of 46 failed (19.6 %) |

### 3.2 Price and buyer — 72 URLs attempted, 40 usable

| Group | ids | Outcome |
|---|---|---|
| **Emlakjet district statistics** | **P-01…P-11** | 200. Türkler 64,951 ₺/m² (18 listings, ~7 yr, +2.8 %) — **re-verified independently by W0-C**; Konaklı, Avsallar, Payallar, Okurcalar, Mahmutlar, Oba, Saray, Kestel |
| Emlak360 index via republication | P-13, P-14 | 200. **Native-EUR district index, updated 1 May 2026.** **Türkler, Payallar and Okurcalar are absent from it** |
| Sahibinden Emlak360 at source | P-71 | **403** — the index behind P-13/P-14 could not be verified at source |
| Azura World price ladders | P-48…P-60 | Ten hosts, 200. Seaside **"Last Updated 23/07/2026"**; Alanya-Home **"Last Updated 2023-02-25"**; Housearch DE **$239,171** vs EN **$238,967** same unit same day |
| Payment terms | P-53, P-58, P-63, P-64 | 200. Azura-specific terms are **3.4 yr stale or expired May 2025** |
| Failed | P-61 **403**, P-62 **DNS**, P-65/P-69/P-72 **404**, P-67/P-68/P-70 **403** | 11 × 403, 5 × 404, 5 × empty body, 3 unparseable PDF, 1 DNS, 1 TLS |

### 3.3 Ids cited individually in the W0-C documents

The groupings above collapse several ids into ranges. Every id cited by name anywhere in W0-C's
output is itemised here so that no citation is unresolvable. Access date for all rows: **2026-07-27**.

| id | Publisher | URL | Tier | HTTP | Yield | Reliability |
|---|---|---|---|---|---|---|
| C-10 | Haspo Realty | `hasporealty.com/en/complex/new-level-premium/` | 4 | 200 | NLP structure + price table | **Low reliability on structure** — "12 buildings / 8 floors" against six sources' 7 × 12, and a corrupt "1+1, 55 m², €10,000" row. Same failure pattern as its Azura record (F-001, F-006) |
| C-11 | Seaside Alanya | `/en/property/new-level-premium-residence-in-avsallar-for-sale` | 4 | 200 | 769 / 52,000 / 900 m; **full payment-term breakdown** (35 % down, 65 % interest-free) | Consistent with the majority on structure |
| C-12 | Istanbul Property | `istanbulproperty.com/property-detail/alanya/avsallar/new-level-premium-ip-6011` | 4 | 200 | Only host naming **SİBERİA İNŞAATİ**; prices in USD ($125,114) | Sole developer-identity source besides the C-44 redirect |
| C-13 | Vikingen Estate | `vikingen.net/en/real-estate/1109-new-level-premium-avsallar-alanya` | 4 | 200 | Labelled spec block; 7 × 12; €137,600 / 50 m² | Undated prices |
| C-14 | Mark Home Invest | `markhomeinvest.com/property/new-premium-class-5-star-project-in-avsallar-alanya/` | 4 | 200 | Confirms **769 / 52,000 / 900 m and the 5★ hotel**; build start 30.06.2023 | Does not name the project |
| C-15 | EMO Homes | `emohomes.com/property/apartment/for_sale/antalya/alanya/avsallar/…` | 4 | 200 | €124,450 / 53 m²; 35 % + 24 months | Quotes "7 % p.a." and ">30 % profit at completion" — **marketing projections, not guarantees; excluded from all tables** |
| C-16 | Alanya Brand (RU) | `alanyabrand.ru/apartment/65576` | 4 | 200 | Russian-language; confirms 5★ hotel, 7 × 12, 35 % down; band to €335,250 | Does not name the project |
| C-26 | GEOLN | `geoln.com/turkey/alanya/4801` | 5 | 200 | Arnelya: Kestel, 6 floors, Dec 2019, USD pricing | **Conflicts with the developer on district, floors, completion month and currency.** Loses the display value per §2.2; all four conflicts stored |
| C-36 | Profit Real Estate (RU) | `profitrealestate.ru/catalog_single/…-avsallar-v-1500m-ot-morya` | 4 | 200 | 9,000 m², 162 units, 3 × 10 fl, 1,500 m, from €135,000, 30 % down | **Host never names the project** — unusable as a competitive-set row |
| M-03 | TÜİK | `databrowser2.tuik.gov.tr` → `DF_YABANCILARA_SATILAR_ILILCE_V3` | 1 | 200 | Antalya monthly + annual foreign house sales 2013–2026 | **Same dataflow as S-008**; both ids refer to it. Primary microdata; series self-validates |
| P-09 | Emlakjet | `emlakjet.com/satilik-daire/antalya-alanya-kestel-mahallesi` | 4 | 200 | 69,857 ₺/m², 158 listings, yield 4.95 % | Asking prices; portal-computed yield |
| P-49 | Seaside Alanya (EN) | `/en/property/-azura-world-residence-hotel-…` | 4 | 200 | Azura 8-row ladder €185k–€1.2m with sizes; **"Last Updated 23/07/2026"** | **Freshest Azura ladder found.** DE and EN versions agree — internal consistency |
| P-50 | Haspo Realty (DE) | `hasporealty.com/de/complex/azura-world/` | 4 | 200 | Azura 14-row ladder €112k–€574k with sizes | **Stale per F-006** — still describes the project as forthcoming two years after handover |
| P-51 | Housearch (DE) | `/de/turkey/residential-complexes/azura-world-3403639/` | 4 | 200 | 4 unit types with sizes; **$239,171** for the 1+1 | USD |
| P-52 | Housearch (EN) | `/turkey/residential-complexes/azura-world-3403639/` | 4 | 200 | **$238,967** for the same unit, same day | **Proves live FX conversion — this host's "price" is a moving target** |
| P-55 | Vikingen (Norway) | `/en/real-estate/1477-azura-world-turkler-alanya` | 6 | 200 | Azura ladder €120k–€1.2m; operator **Tyrkialeiligheter AS** | **Nordic channel — absent from `SOURCES.md`.** Self-contradicts: table min €120,000 vs stated range "125.000-1.200.000 €" |
| P-56 | FirstAlanya (.ru) | `/properties/apartment/alanya-turkler/…` | 6 | 200 | Azura ladder €259k–€900k | **Highest implied €/m² in the set.** Self-contradicts: headline "from €229,000" vs table min €259,000 |
| P-59 | Ajyad Investment | `/property/azura-world/` | 6 | 200 | "Price on call"; 5+1 350 m² | İstanbul-based; Gulf-facing is `[I]` from name and positioning only |
| S-068 | Göç İdaresi | `antalya.goc.gov.tr/` | 1 | 200, 125,852 B | Provincial announcement list | **Nothing newer than 2022-era items** — basis for GAP 12 |
| S-079 | DASK | `dask.gov.tr/tr/kanun` | 1 | 200, 113,632 B | **Law 6305 Art. 11(2) verbatim** | Primary; corroborates the operational page S-078 |

---

## 4. Sources W0-C verified independently

Per ORCHESTRATION §7.4 — *"a subagent reporting success is a claim, not evidence"* — the following
were re-fetched or re-parsed by the owning window. **Two agent claims were corrected as a result.**

| What | Method | Result |
|---|---|---|
| TCMB FX bulletin (P-12) | WebFetch | **Confirmed exactly**: Bülten 2026/137, 27.07.2026, EUR 53.9717, USD 47.3533 |
| Emlakjet Türkler (P-01) | WebFetch | **Confirmed exactly**: 64,951 ₺/m², 18 listings, ~7 yr, +2.8 %, 26,250 TL rent. 64,951 ÷ 53.9717 = €1,203 ✓ |
| Cebeci portfolio (M-12) | WebFetch | **Confirmed 28 entries**, "SINCE 1982". Also shows *Wyndham Hotel Alanya — Antalya/Türkler* as a **separate entry** from *Azura World Residence & Hotel — Alanya/Türkler* |
| Cebeci Azura World page (M-17/C-02) | WebFetch | **Confirmed 200**, 76,000 m², "2021-2024", "private beach", superlative claim. **Recovers a source `SOURCES.md` records as dead** |
| New Level Premium completion (C-09) | WebFetch | **Confirmed "July 2026"** and price-from €136,400; **"Share" product at €5,400 / 51 m² confirmed** |
| Goldcity area (C-25) | WebFetch | **Confirmed** *"211.677m2 dazzling structure"*, "5-star facility", **no room count published** |
| **ALTSO 5★ register (S-043)** | **Downloaded the 11.4 MB PDF; parsed Tablo 6 by word coordinates** | **Agent disagreement resolved.** Class-token totals give **5★ = 99** exactly. Nearest-y column matching, **zero unmatched rows**: Okurcalar 28 · **Türkler 20** · Konaklı 18 · Avsallar 9 · Payallar 6 · Oba 5 · Kargıcak 5 · Kestel 3 · Tosmur 2 · İncekum 2 · Mahmutlar 1 = **99**. One agent graded this `[V]`, the other `[I]`; **it is `[V]`** |
| **Türkler summary row (S-043 p98)** | PDF coordinate parse | **Independent corroboration from a second table**: Türkler `1 | 20 | 4 | 1 | 1 | 27 | 5 | 5 | 32` — 20 five-star hotels + 1 five-star holiday village, 27 certified, 32 total establishments |
| **Türkler population (S-043 p35)** | PDF coordinate parse | **4,949** (2,616 + 2,333 = 4,949 ✓), rank 21 of 102. **Supersedes M-34's 7,240**, which is a 2000 *belde* census figure |
| **Türkler bed capacity (S-043 p98)** | PDF coordinate parse | **27,775 beds = 15.7 %** of Alanya, from 32 establishments. Ranking: Merkez 33,129 (18.8 %) · Konaklı 32,417 (18.4 %) · **Türkler 27,775 (15.7 %)** · Okurcalar 25,856 (14.7 %) · Avsallar 12,421 (7.1 %) |
| **Azura Deluxe official record (S-043 Tablo 6)** | PDF coordinate parse | Row 16: `Avsallar | Azura Deluxe Res.&Spa Hot.(Şıhlı) | 5* | Avsallar Mah. İncekum Cad. No:76 | 374 oda | 818 yatak | ibt`. **Contradicts the developer's published 330 rooms / 1,200 beds** |
| **Wyndham Alanya register entry (S-043 Tablo 7)** | PDF coordinate parse | **Corrects an agent claim.** One agent reported the hotel absent from the 2024 register. It is present — in **Tablo 7 (Basit Konaklama Tesisleri**, municipality-licensed), row 296: `Türkler | Wyndham Alanya Otel | Otel | Türkler Mah. Kargı Çayı Cad. 10 | 188 oda | 376 yatak`. **Not** in Tablo 6 (ministry-certified) |

---

## 5. Evidence-handling rules for anything built on this register

1. **Never present a portal figure as a transaction price.** Every price in every W0-C document is an
   asking price. No transaction-price source was found at any tier, for any project or district.
2. **Never quote a TRY figure without its date.** The only FX rate used across these documents is
   P-12 (TCMB bulletin 2026/137, 27.07.2026). Any other conversion is invalid.
3. **Never quote Turkish nominal price growth without the real figure beside it.** S-022 gives
   **+24.5 % nominal and −5.8 % real** for the year to June 2026.
4. **Never present GYODER's national rental yield as an Alanya or resort yield** (S-039).
5. **Never present the developer's self-descriptions as fact.** "Turkey's largest Residence & Hotel
   & Entertainment concept project" and "one of the largest developers in the region" are quotes,
   attributed every time.
6. **Re-check S-027 before any client-facing use.** The USD 400,000 citizenship threshold rests on a
   guide dated 01.02.2024; the Regulation's own text could not be retrieved (S-060).
7. **State the closure position as "2022" and never as "current"** (S-066). The reported June 2026
   reopening has no official instrument.
8. **ALTSO covers 2024 and was published in September 2025.** No 2025 edition exists as of July 2026.
