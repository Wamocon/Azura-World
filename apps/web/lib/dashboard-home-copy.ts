/**
 * Shell and home copy, in four locales.                    Owner: W3-B
 *
 * WHY THIS EXISTS ALONGSIDE `messages/*.json`, WHICH IS W1-C's:
 * the shell needs about forty strings that the message catalogue does not
 * carry. Group headings, the 403 body, per-role home intros, the data-table
 * chrome. Adding them means editing four files W1-C owns while they are
 * actively working in them, which ORCHESTRATION §4 forbids and which would
 * collide. The 1Çatı reference solves it the same way, with a
 * `lib/dashboard-home-copy.ts` holding page-specific copy beside the shared
 * catalogue.
 *
 * Everything W1-C DOES already ship is used from `messages/*.json` and is not
 * duplicated here. Nav labels are `dashboard.<module>.title`, and
 * `dashboard.shell.*` covers the topbar. Two copies of one string is two things
 * to translate and one of them to forget.
 *
 * HANDOFF/W3-B.md lists the keys that should migrate into the catalogue once
 * W1-C is idle. Until then this file is the single source for them, typed so
 * that a missing locale or a missing key is a compile error rather than a
 * `undefined` rendered into the page.
 */

import type { ProvenanceLabels } from "@/components/evidence/provenance-value"
import type { Locale } from "@/lib/contracts"

import type { DashboardGroup } from "./dashboard-routing"

// ---------------------------------------------------------------------------

export interface DashboardShellCopy {
  /** Sidebar group headings. */
  groups: Record<DashboardGroup, string>
  /** The module exists in the nav but is not built yet. */
  pending: string
  pendingHint: string

  forbiddenTitle: string
  /** `{role}` is substituted. */
  forbiddenBody: string
  forbiddenAction: string

  /** No role in the current matrix reaches zero resources, but one could. */
  noAccessTitle: string
  noAccessBody: string

  /** Role-aware home. */
  homeGreeting: string
  homeSubtitleByRole: string
  panelRestricted: string
  panelRestrictedHint: string
  panelFailed: string
  panelFailedHint: string
  panelTruncated: string
  retry: string
  refresh: string

  /** KPI cards. */
  kpiUnitsTotal: string
  kpiUnitsModelled: string
  kpiUnitsPortal: string
  kpiOpenTickets: string
  kpiOverdueTickets: string
  kpiFindings: string
  kpiCriticalFindings: string
  kpiFactGaps: string
  kpiSourcesValidated: string
  kpiHotelRooms: string
  kpiReviewSources: string
  kpiLedgerEntries: string

  /** Data table chrome. */
  tableCaption: string
  tableCount: string
  tableColumns: string
  tableExport: string
  tableSelectRow: string
  tableSelectAll: string
  tableSelected: string
  tableSortAsc: string
  tableSortDesc: string
  tableSortClear: string
  tableLoading: string
  tableNoValue: string
  tableEmptyTitle: string
  tableEmptyBody: string
  tableErrorTitle: string
  tableErrorBody: string

  /** Global search. */
  searchOpen: string
  searchClose: string
  searchEmptyTitle: string
  searchEmptyBody: string
  searchTyping: string
}

const de: DashboardShellCopy = {
  groups: {
    overview: "Übersicht",
    intelligence: "Analyse",
    inventory: "Bestand",
    commercial: "Vertrieb",
    finance: "Finanzen",
    operations: "Betrieb",
    governance: "Verwaltung",
  },
  pending: "In Arbeit",
  pendingHint: "Dieser Bereich ist noch nicht gebaut.",

  forbiddenTitle: "Kein Zugriff auf diesen Bereich",
  forbiddenBody:
    "Ihre Rolle ({role}) hat keine Berechtigung für diese Seite. Die Adresse bleibt erhalten. Sie können sie an eine berechtigte Person weitergeben.",
  forbiddenAction: "Zu einem freigegebenen Bereich",

  noAccessTitle: "Für diese Rolle ist kein Bereich freigegeben",
  noAccessBody:
    "Ihr Konto ist angemeldet, aber Ihrer Rolle ist derzeit kein Bereich zugewiesen. Wenden Sie sich an die Verwaltung, um Berechtigungen zu erhalten.",

  homeGreeting: "Guten Tag",
  homeSubtitleByRole: "Ihre Ansicht als {role}",
  panelRestricted: "Nicht freigegeben",
  panelRestrictedHint:
    "Dieser Bereich gehört nicht zu Ihrer Rolle. Das ist die richtige Antwort, kein Fehler.",
  panelFailed: "Nicht geladen",
  panelFailedHint:
    "Dieser Bereich konnte nicht geladen werden. Die übrigen Kennzahlen sind davon unberührt.",
  panelTruncated:
    "Verteilungen aus einer begrenzten Stichprobe. Die Anteile sind Näherungen.",
  retry: "Erneut versuchen",
  refresh: "Aktualisieren",

  kpiUnitsTotal: "Wohneinheiten",
  kpiUnitsModelled: "Davon modelliert",
  kpiUnitsPortal: "Davon Portal-Inserate",
  kpiOpenTickets: "Offene Tickets",
  kpiOverdueTickets: "SLA überschritten",
  kpiFindings: "Befunde",
  kpiCriticalFindings: "Kritische Befunde",
  kpiFactGaps: "Angaben ohne Quelle",
  kpiSourcesValidated: "Geprüfte Quellen",
  kpiHotelRooms: "Hotelzimmer",
  kpiReviewSources: "Bewertungsportale",
  kpiLedgerEntries: "Buchungen",

  tableCaption: "Datentabelle",
  tableCount: "{visible} von {total}",
  tableColumns: "Spalten",
  tableExport: "CSV exportieren",
  tableSelectRow: "Zeile auswählen",
  tableSelectAll: "Alle auf dieser Seite auswählen",
  tableSelected: "{count} ausgewählt",
  tableSortAsc: "Aufsteigend sortieren",
  tableSortDesc: "Absteigend sortieren",
  tableSortClear: "Sortierung aufheben",
  tableLoading: "Daten werden geladen",
  tableNoValue: "Keine Angabe",
  tableEmptyTitle: "Keine Einträge",
  tableEmptyBody:
    "Für die aktuelle Auswahl gibt es keine Einträge. Setzen Sie die Filter zurück, um mehr zu sehen.",
  tableErrorTitle: "Daten konnten nicht geladen werden",
  tableErrorBody:
    "Die Verbindung zur Datenquelle ist unterbrochen. Es werden bewusst keine veralteten Werte angezeigt.",

  searchOpen: "Suche öffnen",
  searchClose: "Schließen",
  searchEmptyTitle: "Keine Treffer",
  searchEmptyBody: "Versuchen Sie eine Einheitenkennung, einen Blockcode oder einen Namen.",
  searchTyping: "Mindestens zwei Zeichen eingeben.",
}

const en: DashboardShellCopy = {
  groups: {
    overview: "Overview",
    intelligence: "Intelligence",
    inventory: "Inventory",
    commercial: "Commercial",
    finance: "Finance",
    operations: "Operations",
    governance: "Governance",
  },
  pending: "In progress",
  pendingHint: "This area has not been built yet.",

  forbiddenTitle: "No access to this area",
  forbiddenBody:
    "Your role ({role}) does not carry permission for this page. The address is preserved. You can pass it to someone who does.",
  forbiddenAction: "Go to an area you can open",

  noAccessTitle: "No area is available for this role",
  noAccessBody:
    "Your account is signed in, but no area is currently assigned to your role. Contact an administrator to be granted access.",

  homeGreeting: "Good day",
  homeSubtitleByRole: "Your view as {role}",
  panelRestricted: "Not available",
  panelRestrictedHint:
    "This panel is outside your role. That is the correct answer, not a fault.",
  panelFailed: "Did not load",
  panelFailedHint:
    "This panel could not be loaded. The remaining figures are unaffected.",
  panelTruncated:
    "Distributions computed from a bounded sample. The proportions are approximate.",
  retry: "Try again",
  refresh: "Refresh",

  kpiUnitsTotal: "Units",
  kpiUnitsModelled: "Of which modelled",
  kpiUnitsPortal: "Of which portal listings",
  kpiOpenTickets: "Open tickets",
  kpiOverdueTickets: "Past SLA",
  kpiFindings: "Findings",
  kpiCriticalFindings: "Critical findings",
  kpiFactGaps: "Unestablished facts",
  kpiSourcesValidated: "Validated sources",
  kpiHotelRooms: "Hotel rooms",
  kpiReviewSources: "Review platforms",
  kpiLedgerEntries: "Ledger entries",

  tableCaption: "Data table",
  tableCount: "{visible} of {total}",
  tableColumns: "Columns",
  tableExport: "Export CSV",
  tableSelectRow: "Select row",
  tableSelectAll: "Select all on this page",
  tableSelected: "{count} selected",
  tableSortAsc: "Sort ascending",
  tableSortDesc: "Sort descending",
  tableSortClear: "Clear sorting",
  tableLoading: "Loading data",
  tableNoValue: "Not stated",
  tableEmptyTitle: "No entries",
  tableEmptyBody:
    "There are no entries for the current selection. Reset the filters to see more.",
  tableErrorTitle: "Data could not be loaded",
  tableErrorBody:
    "The connection to the data source is interrupted. Stale values are deliberately not shown.",

  searchOpen: "Open search",
  searchClose: "Close",
  searchEmptyTitle: "No matches",
  searchEmptyBody: "Try a unit id, a block code, or a name.",
  searchTyping: "Type at least two characters.",
}

const tr: DashboardShellCopy = {
  groups: {
    overview: "Genel bakış",
    intelligence: "Analiz",
    inventory: "Envanter",
    commercial: "Satış",
    finance: "Finans",
    operations: "Operasyon",
    governance: "Yönetim",
  },
  pending: "Yapım aşamasında",
  pendingHint: "Bu bölüm henüz oluşturulmadı.",

  forbiddenTitle: "Bu bölüme erişiminiz yok",
  forbiddenBody:
    "Rolünüz ({role}) bu sayfa için yetki taşımıyor. Adres korunuyor. Yetkili bir kişiye iletebilirsiniz.",
  forbiddenAction: "Açabileceğiniz bir bölüme git",

  noAccessTitle: "Bu rol için açık bir bölüm yok",
  noAccessBody:
    "Hesabınız oturum açtı, ancak rolünüze şu anda hiçbir bölüm atanmadı. Yetki için yönetime başvurun.",

  homeGreeting: "İyi günler",
  homeSubtitleByRole: "{role} olarak görünümünüz",
  panelRestricted: "Yetki dışı",
  panelRestrictedHint:
    "Bu panel rolünüzün dışında. Bu bir hata değil, doğru yanıt.",
  panelFailed: "Yüklenemedi",
  panelFailedHint: "Bu panel yüklenemedi. Diğer göstergeler bundan etkilenmez.",
  panelTruncated:
    "Dağılımlar sınırlı bir örneklemden hesaplandı. Oranlar yaklaşıktır.",
  retry: "Tekrar dene",
  refresh: "Yenile",

  kpiUnitsTotal: "Daireler",
  kpiUnitsModelled: "Modellenen",
  kpiUnitsPortal: "Portal ilanı olan",
  kpiOpenTickets: "Açık talepler",
  kpiOverdueTickets: "SLA aşıldı",
  kpiFindings: "Bulgular",
  kpiCriticalFindings: "Kritik bulgular",
  kpiFactGaps: "Kaynaksız veriler",
  kpiSourcesValidated: "Doğrulanan kaynaklar",
  kpiHotelRooms: "Otel odaları",
  kpiReviewSources: "Değerlendirme siteleri",
  kpiLedgerEntries: "Muhasebe kayıtları",

  tableCaption: "Veri tablosu",
  tableCount: "{total} kayıttan {visible} tanesi",
  tableColumns: "Sütunlar",
  tableExport: "CSV dışa aktar",
  tableSelectRow: "Satırı seç",
  tableSelectAll: "Bu sayfadaki tümünü seç",
  tableSelected: "{count} seçildi",
  tableSortAsc: "Artan sırala",
  tableSortDesc: "Azalan sırala",
  tableSortClear: "Sıralamayı kaldır",
  tableLoading: "Veriler yükleniyor",
  tableNoValue: "Belirtilmemiş",
  tableEmptyTitle: "Kayıt yok",
  tableEmptyBody:
    "Geçerli seçim için kayıt bulunmuyor. Daha fazlasını görmek için filtreleri sıfırlayın.",
  tableErrorTitle: "Veriler yüklenemedi",
  tableErrorBody:
    "Veri kaynağıyla bağlantı kesildi. Eski değerler bilinçli olarak gösterilmiyor.",

  searchOpen: "Aramayı aç",
  searchClose: "Kapat",
  searchEmptyTitle: "Sonuç yok",
  searchEmptyBody: "Bir daire kodu, blok kodu veya ad deneyin.",
  searchTyping: "En az iki karakter girin.",
}

const ru: DashboardShellCopy = {
  groups: {
    overview: "Обзор",
    intelligence: "Аналитика",
    inventory: "Фонд",
    commercial: "Продажи",
    finance: "Финансы",
    operations: "Эксплуатация",
    governance: "Управление",
  },
  pending: "В работе",
  pendingHint: "Этот раздел ещё не создан.",

  forbiddenTitle: "Нет доступа к этому разделу",
  forbiddenBody:
    "Ваша роль ({role}) не даёт прав на эту страницу. Адрес сохранён. Вы можете передать его тому, у кого есть доступ.",
  forbiddenAction: "Перейти в доступный раздел",

  noAccessTitle: "Для этой роли нет доступных разделов",
  noAccessBody:
    "Вы вошли в систему, но вашей роли пока не назначен ни один раздел. Обратитесь к администратору за правами.",

  homeGreeting: "Добрый день",
  homeSubtitleByRole: "Ваш вид как {role}",
  panelRestricted: "Недоступно",
  panelRestrictedHint:
    "Эта панель вне вашей роли. Это правильный ответ, а не ошибка.",
  panelFailed: "Не загрузилось",
  panelFailedHint:
    "Эту панель не удалось загрузить. Остальные показатели это не затрагивает.",
  panelTruncated:
    "Распределения рассчитаны по ограниченной выборке. Доли приблизительны.",
  retry: "Повторить",
  refresh: "Обновить",

  kpiUnitsTotal: "Квартиры",
  kpiUnitsModelled: "Из них смоделировано",
  kpiUnitsPortal: "Из них с объявлением",
  kpiOpenTickets: "Открытые заявки",
  kpiOverdueTickets: "Просрочен SLA",
  kpiFindings: "Находки",
  kpiCriticalFindings: "Критические находки",
  kpiFactGaps: "Неподтверждённые данные",
  kpiSourcesValidated: "Проверенные источники",
  kpiHotelRooms: "Номера отеля",
  kpiReviewSources: "Площадки отзывов",
  kpiLedgerEntries: "Проводки",

  tableCaption: "Таблица данных",
  tableCount: "{visible} из {total}",
  tableColumns: "Столбцы",
  tableExport: "Экспорт CSV",
  tableSelectRow: "Выбрать строку",
  tableSelectAll: "Выбрать все на этой странице",
  tableSelected: "Выбрано: {count}",
  tableSortAsc: "Сортировать по возрастанию",
  tableSortDesc: "Сортировать по убыванию",
  tableSortClear: "Снять сортировку",
  tableLoading: "Загрузка данных",
  tableNoValue: "Нет данных",
  tableEmptyTitle: "Записей нет",
  tableEmptyBody:
    "Для текущего выбора записей нет. Сбросьте фильтры, чтобы увидеть больше.",
  tableErrorTitle: "Не удалось загрузить данные",
  tableErrorBody:
    "Связь с источником данных прервана. Устаревшие значения намеренно не показываются.",

  searchOpen: "Открыть поиск",
  searchClose: "Закрыть",
  searchEmptyTitle: "Ничего не найдено",
  searchEmptyBody: "Попробуйте код квартиры, код блока или имя.",
  searchTyping: "Введите не менее двух символов.",
}

/**
 * `Record<Locale, …>` is exhaustive on purpose: adding a fifth locale to
 * CONTRACTS §7 becomes a compile error here rather than an `undefined`
 * rendered into the page.
 */
export const dashboardShellCopy: Record<Locale, DashboardShellCopy> = Object.freeze({
  de,
  en,
  tr,
  ru,
})

/** German for anything unrecognised. CONTRACTS §7 makes `de` the default. */
export function shellCopy(locale: string): DashboardShellCopy {
  return dashboardShellCopy[locale as Locale] ?? de
}

/** `{name}`-style interpolation. The catalogue's ICU syntax is W1-C's, not ours. */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
}

// ---------------------------------------------------------------------------
// Provenance labels
// ---------------------------------------------------------------------------

/**
 * Builds W1-D's `ProvenanceLabels` from W1-C's `evidence.*` catalogue.
 *
 * EVERY MODULE NEEDS THIS, so it lives in the shared contract rather than
 * being reassembled per module. Six windows hand-writing the same seventeen
 * strings is six chances for one of them to say something subtly different
 * about what a conflict means.
 *
 * It takes a translate function rather than calling `useTranslations` itself,
 * so the same builder works from a Server Component (`getTranslations`) and a
 * client one (`useTranslations`).
 *
 * The strings are W1-C's, not invented here. `evidence.confidence.*`,
 * `evidence.conflict.*` and `evidence.label.*` already exist in all four
 * locales. Only the source-tier names fall back to this module, because the
 * catalogue has no key for them.
 */
export function buildProvenanceLabels(
  t: (key: string) => string,
  locale: string,
): ProvenanceLabels {
  const copy = shellCopy(locale)

  const source = {
    openSource: t("evidence.label.openSource"),
    snapshot: t("evidence.label.snapshot"),
    unreachable: t("evidence.sourceUnreachable"),
    tier: {
      official: t("evidence.confidence.official"),
      developer: t("evidence.label.source"),
      hotel: t("evidence.label.source"),
      portal: t("evidence.label.source"),
      review: t("evidence.label.source"),
      press: t("evidence.label.source"),
    },
  }

  return {
    confidence: {
      confirmed: t("evidence.confidence.confirmed"),
      official: t("evidence.confidence.official"),
      single_source: t("evidence.confidence.single_source"),
      conflicted: t("evidence.confidence.conflicted"),
      inferred: t("evidence.confidence.inferred"),
      gap: t("evidence.confidence.gap"),
    },
    conflict: {
      trigger: t("evidence.confidence.conflicted"),
      heading: t("evidence.conflict.title"),
      // `{count}` is W1-D's placeholder, not ICU. The components interpolate
      // with their own `fill()` so they stay usable outside next-intl.
      summary: `{count} · ${t("evidence.label.sources")}`,
      displayed: t("evidence.conflict.displayedValue"),
      unresolvedNote: t("evidence.conflict.description"),
      close: copy.searchClose,
      source,
    },
    source,
    gap: t("evidence.confidence.gap"),
    inferred: t("evidence.confidence.inferred"),
    more: `+{count}`,
    sources: t("evidence.label.sources"),
  }
}
