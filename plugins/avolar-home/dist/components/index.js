// Компонент новой главной страницы Аволара.
// Рендерится только на главной (slug "index"). Содержимое берётся из ../../home.yaml,
// стили — из ../../home.css, клиентский скрипт — из ../../home.client.js.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { h } from "preact"
import { parse as parseYaml } from "yaml"
import { slugifyFilePath } from "@quartz-community/utils"

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const readLocal = (name) => fs.readFileSync(path.join(pluginDir, name), "utf-8")

// ---------- утилиты ----------
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim()

const slugToHref = (slug) => {
  if (slug === "index") return "./"
  if (slug.endsWith("/index")) return "./" + slug.slice(0, -"index".length)
  return "./" + slug
}

function buildResolver(allFiles, ctx) {
  const byName = new Map()
  const add = (key, file) => {
    const k = norm(key)
    if (k && !byName.has(k)) byName.set(k, file)
  }
  for (const f of allFiles) {
    const fm = f.frontmatter ?? {}
    const stem = f.filePath ? path.basename(String(f.filePath)).replace(/\.md$/i, "") : ""
    // имя файла важнее title: так работают и ссылки Obsidian
    add(stem, f)
  }
  for (const f of allFiles) {
    const fm = f.frontmatter ?? {}
    add(fm.title, f)
    const aliases = Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : []
    aliases.forEach((a) => add(a, f))
  }

  const allSlugs = (ctx?.allSlugs ?? []).map(String)
  const allAssetPaths = (ctx?.allFiles ?? []).map(String)

  const page = (name) => {
    const file = byName.get(norm(name))
    if (file) {
      return {
        href: slugToHref(String(file.slug)),
        slug: String(file.slug),
        title: file.frontmatter?.title ?? name,
        file,
      }
    }
    // папка без заметки (например «Персонажи игроков»)
    const seg = norm(name).replace(/ /g, "-")
    const hit = allSlugs.find((s) => s.split("/").slice(0, -1).some((p) => norm(p) === seg))
    if (hit) {
      const parts = hit.split("/")
      const idx = parts.findIndex((p) => norm(p) === seg)
      const folder = parts.slice(0, idx + 1).join("/")
      return { href: "./" + folder + "/", slug: folder + "/index", title: name, file: null }
    }
    console.warn(`[avolar-home] Не найдена страница «${name}» — проверьте home.yaml`)
    return null
  }

  const image = (name) => {
    if (!name) return null
    if (/^https?:\/\//.test(name)) return name
    const target = norm(name)
    const fp = allAssetPaths.find((p) => norm(path.basename(p)) === target)
    if (!fp) {
      console.warn(`[avolar-home] Не найдена картинка «${name}» — проверьте home.yaml`)
      return null
    }
    const rel = fp.replace(/^.*?content[\\/]/, "")
    return "./" + slugifyFilePath(rel)
  }

  return { page, image }
}

// мини-разметка: [текст](url), [[Страница|текст]], **жирный**
function inline(md, R) {
  let out = esc(md)
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const p = R.page(target.trim())
    const text = label ?? target
    return p ? linkTag(p, text) : text
  })
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    return `<a href="${url}" class="external" target="_blank" rel="noopener">${text}</a>`
  })
  return out
}

const linkTag = (p, text, cls = "") =>
  `<a href="${esc(p.href)}" class="internal ${cls}" data-slug="${esc(p.slug)}">${text}</a>`

function anyLink(item, R, cls = "") {
  if (item.url) {
    return `<a href="${esc(item.url)}" class="external ${cls}" target="_blank" rel="noopener">${esc(item.label)}</a>`
  }
  const p = R.page(item.page)
  return p ? linkTag(p, esc(item.label ?? p.title), cls) : ""
}

// ---------- иконки (свои, в духе ар-деко) ----------
const ICONS = {
  compass: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19"/><circle cx="24" cy="24" r="13" stroke-dasharray="2 3"/><path d="M24 7v6M24 35v6M7 24h6M35 24h6"/><path d="M24 14l4 10-4 10-4-10z" class="fill"/></svg>`,
  dice: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4l18 10v20L24 44 6 34V14z"/><path d="M6 14l18 10 18-10M24 24v20"/><path d="M24 10l7 4-7 4-7-4z" class="fill"/></svg>`,
  screen: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="5" y="9" width="38" height="26" rx="2"/><path d="M17 41h14M24 35v6"/><path d="M20 16v12l10-6z" class="fill"/></svg>`,
}

// ---------- секции ----------
function heroSection(cfg, R) {
  const img = R.image(cfg.image)
  return `
  <header class="avh-hero">
    ${img ? `<img class="avh-hero-img" src="${esc(img)}" alt="Аволар: Проклятие Жизни" fetchpriority="high">` : ""}
    <p class="avh-hero-text">${inline(cfg.text ?? "", R)}</p>
  </header>`
}

function pathsSection(cfg, R) {
  const cards = (cfg.cards ?? [])
    .map((c, i) => {
      const links = (c.links ?? []).map((l) => anyLink(l, R, "avh-pill")).join("")
      return `
      <li class="avh-card" style="--i:${i}">
        <button class="avh-card-inner" type="button" aria-expanded="false" aria-label="${esc(c.title)}: показать подробности">
          <span class="avh-card-face avh-card-front">
            <span class="avh-card-icon">${ICONS[c.icon] ?? ICONS.compass}</span>
            <span class="avh-card-title">${esc(c.title)}</span>
            <span class="avh-card-teaser">${esc(c.teaser ?? "")}</span>
            <span class="avh-card-hint">Нажмите, чтобы открыть</span>
          </span>
        </button>
        <div class="avh-card-face avh-card-back" aria-hidden="true">
          <span class="avh-card-title">${esc(c.title)}</span>
          <p>${inline(c.text ?? "", R)}</p>
          <div class="avh-card-links">${links}</div>
          <button class="avh-card-close" type="button" aria-label="Закрыть карточку">×</button>
        </div>
      </li>`
    })
    .join("")
  return `
  <section class="avh-section avh-paths" aria-labelledby="avh-paths-h">
    <h2 id="avh-paths-h">${esc(cfg.title ?? "Выберите путь")}</h2>
    <ul class="avh-cards">${cards}</ul>
  </section>`
}

function timelineSection(cfg, R) {
  const events = (cfg.events ?? []).slice().sort((a, b) => a.year - b.year)
  const now = events.at(-1)?.year ?? 500
  const pct = (y) => (y / 1000) * 100
  const marks = events
    .map((e, i) => {
      const p = e.page ? R.page(e.page) : null
      const isNow = i === events.length - 1
      return `
      <li class="avh-tl-event${e.red ? " is-red" : ""}${isNow ? " is-now" : ""}" style="--x:${pct(e.year)}%">
        <button type="button" class="avh-tl-mark" data-idx="${i}" aria-controls="avh-tl-panel" aria-pressed="${isNow}">
          <span class="avh-tl-year">${e.year}</span>
          <span class="avh-tl-name">${esc(e.title)}</span>
        </button>
        <template class="avh-tl-detail">
          <span class="avh-tl-detail-year">${e.year} год Тьмы${isNow ? " · сейчас" : ""}</span>
          <h3>${esc(e.title)}</h3>
          <p>${inline(e.text ?? "", R)}</p>
          ${p ? linkTag(p, "Читать статью", "avh-pill") : ""}
        </template>
      </li>`
    })
    .join("")
  return `
  <section class="avh-section avh-timeline" aria-labelledby="avh-tl-h">
    <h2 id="avh-tl-h">${esc(cfg.title ?? "Шкала Тьмы")}</h2>
    ${cfg.intro ? `<p class="avh-lede">${inline(cfg.intro, R)}</p>` : ""}
    <div class="avh-tl" style="--now:${pct(now)}%">
      <div class="avh-tl-rail" aria-hidden="true">
        <span class="avh-tl-past"></span>
        <span class="avh-tl-tick is-start" style="--x:0%">0</span>
        <span class="avh-tl-tick" style="--x:50%">500</span>
        <span class="avh-tl-tick is-end" style="--x:100%">1000</span>
        <span class="avh-tl-unknown">Тысячелетие Тьмы?</span>
      </div>
      <ol class="avh-tl-events" style="--count:${events.length}">${marks}</ol>
    </div>
    <div class="avh-tl-panel" id="avh-tl-panel" aria-live="polite"></div>
  </section>`
}

function worldSection(cfg, R) {
  const tiles = (cfg.tiles ?? [])
    .map((t, i) => {
      const p = R.page(t.page)
      if (!p) return ""
      const img = R.image(t.image)
      return `
      <a class="avh-tile internal${i === 0 ? " is-lead" : ""}" href="${esc(p.href)}" data-slug="${esc(p.slug)}">
        ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ""}
        <span class="avh-tile-body">
          <span class="avh-tile-title">${esc(t.title ?? p.title)}</span>
          <span class="avh-tile-text">${esc(t.text ?? "")}</span>
        </span>
      </a>`
    })
    .join("")
  return `
  <section class="avh-section avh-world" aria-labelledby="avh-world-h">
    <h2 id="avh-world-h">${esc(cfg.title ?? "Мир в пяти ссылках")}</h2>
    <div class="avh-tiles">${tiles}</div>
  </section>`
}

function mapSection(cfg, R) {
  const img = R.image(cfg.image)
  if (!img) return ""
  const c = { x: 0, y: 0, w: 100, h: 100, ...(cfg.crop ?? {}) }
  const pct = (n) => `${+n.toFixed(3)}%`
  const items = (cfg.markers ?? [])
    .map((m, i) => ({ ...m, i, p: R.page(m.page) }))
    .filter((m) => m.p)
  const pins = items
    .filter((m) => m.x >= c.x && m.x <= c.x + c.w && m.y >= c.y && m.y <= c.y + c.h)
    .map((m) => {
      const cls = ["avh-pin", m.capital ? "is-capital" : "", m.lost ? "is-lost" : ""].join(" ")
      return `<a class="${cls} internal" href="${esc(m.p.href)}" data-slug="${esc(m.p.slug)}" data-key="${m.i}"
        style="left:${pct(((m.x - c.x) / c.w) * 100)};top:${pct(((m.y - c.y) / c.h) * 100)}"
        aria-label="${esc(m.p.title)}"><span class="avh-pin-label">${esc(m.p.title)}</span></a>`
    })
    .join("")
  const list = items
    .map((m) => {
      const note = m.note ?? m.p.file?.frontmatter?.description ?? ""
      const mark = m.capital ? " is-capital" : m.lost ? " is-lost" : ""
      return `<li><a class="avh-map-item${mark}" href="${esc(m.p.href)}" data-key="${m.i}">
        <span class="avh-map-name">${esc(m.p.title)}</span>
        <span class="avh-map-note">${esc(note)}</span></a></li>`
    })
    .join("")
  const full = cfg.fullMap ? R.page(cfg.fullMap) : null
  return `
  <section class="avh-section avh-map" aria-labelledby="avh-map-h">
    <h2 id="avh-map-h">${esc(cfg.title ?? "Карта мира")}</h2>
    ${cfg.intro ? `<p class="avh-lede">${inline(cfg.intro, R)}</p>` : ""}
    <div class="avh-map-grid">
      <div class="avh-map-view" style="aspect-ratio:${c.w}/${c.h}">
        <img src="${esc(img)}" alt="Карта Аволара" loading="lazy" decoding="async"
          style="width:${pct((100 / c.w) * 100)};height:${pct((100 / c.h) * 100)};left:${pct((-c.x / c.w) * 100)};top:${pct((-c.y / c.h) * 100)}">
        ${pins}
      </div>
      <div class="avh-map-side">
        <ol class="avh-map-list">${list}</ol>
        ${full ? linkTag(full, "Открыть полную карту", "avh-pill") : ""}
      </div>
    </div>
  </section>`
}

function readNews(cfg, R) {
  const p = cfg.newsPage ? R.page(cfg.newsPage) : null
  if (!p?.file?.filePath) return null
  let raw
  try {
    const fp = String(p.file.filePath)
    raw = fs.readFileSync(path.isAbsolute(fp) ? fp : path.resolve(process.cwd(), fp), "utf-8")
  } catch {
    return null
  }
  raw = raw.replace(/^---[\s\S]*?\n---\n/, "")
  const parts = raw.split(/^##\s+/m).slice(1)
  const first = parts.find((s) => !/^смотрите также/i.test(s.trim()))
  if (!first) return null
  const [headLine, ...rest] = first.split("\n")
  const bullets = rest
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
  return { page: p, heading: headLine.trim(), bullets }
}

const fmtDate = (d) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(d))

function liveSection(cfg, R, allFiles) {
  // 1) последнее обновление
  const news = readNews(cfg, R)
  const maxBullets = 4
  const newsHtml = news
    ? `
    <article class="avh-live-card avh-news">
      <h3>${esc(news.heading)}</h3>
      <ul>${news.bullets
        .slice(0, maxBullets)
        .map((b) => `<li>${inline(b, R)}</li>`)
        .join("")}</ul>
      ${linkTag(news.page, news.bullets.length > maxBullets ? `Ещё ${news.bullets.length - maxBullets} — все новости` : "Все новости", "avh-pill")}
    </article>`
    : ""

  // 2) недавно изменённые статьи
  const skip = new Set(["index", news?.page.slug].filter(Boolean))
  const recent = allFiles
    .filter((f) => f.slug && !skip.has(f.slug) && !String(f.slug).startsWith("tags/"))
    .filter((f) => f.filePath && String(f.filePath).endsWith(".md"))
    .filter((f) => f.dates?.modified)
    .sort((a, b) => new Date(b.dates.modified) - new Date(a.dates.modified))
    .slice(0, cfg.recentCount ?? 5)
  const recentHtml = recent.length
    ? `
    <article class="avh-live-card avh-recent">
      <h3>Недавно дополнены</h3>
      <ol>${recent
        .map(
          (f) => `
        <li>${linkTag({ href: slugToHref(String(f.slug)), slug: String(f.slug) }, esc(f.frontmatter?.title ?? f.slug))}
          <time datetime="${new Date(f.dates.modified).toISOString()}">${fmtDate(f.dates.modified)}</time></li>`,
        )
        .join("")}</ol>
      <button type="button" class="avh-pill avh-random">Случайная статья</button>
    </article>`
    : ""

  // 3) видео + таймер
  const uploads = cfg.youtubeChannelId ? "UU" + String(cfg.youtubeChannelId).slice(2) : ""
  const poster = R.image(cfg.youtubePoster)
  const videoHtml = uploads
    ? `
    <article class="avh-live-card avh-video">
      <h3>${esc(cfg.youtubeTitle ?? "Последний эпизод")}</h3>
      <button type="button" class="avh-video-facade" data-list="${esc(uploads)}"${poster ? ` data-poster="${esc(poster)}"` : ""} aria-label="Включить последнее видео">
        <span class="avh-video-play" aria-hidden="true"></span>
        <span class="avh-video-note">Видео загрузится с YouTube после нажатия</span>
      </button>
    </article>`
    : ""
  const timerHtml = cfg.nextSession
    ? `
    <article class="avh-live-card avh-timer" data-at="${esc(cfg.nextSession)}" hidden>
      <h3>${esc(cfg.nextSessionLabel ?? "До следующей игры")}</h3>
      <p class="avh-timer-digits"><span data-u="d">0</span><small>дн</small><span data-u="h">0</span><small>ч</small><span data-u="m">0</span><small>мин</small></p>
    </article>`
    : ""

  return `
  <section class="avh-section avh-live" aria-label="Что нового">
    <div class="avh-live-col">${newsHtml}</div>
    <div class="avh-live-col">${timerHtml}${videoHtml}${recentHtml}</div>
  </section>`
}

function graphSection(cfg, R) {
  return `
  <section class="avh-section avh-web" aria-labelledby="avh-web-h">
    <h2 id="avh-web-h">${esc(cfg.title ?? "Паутина мира")}</h2>
    ${cfg.intro ? `<p class="avh-lede">${inline(cfg.intro, R)}</p>` : ""}
    <div class="avh-web-stage">
      <canvas class="avh-web-canvas" aria-label="Граф связей между статьями"></canvas>
      <div class="avh-web-label" hidden></div>
      <ul class="avh-web-legend"></ul>
    </div>
  </section>`
}

// ---------- компонент ----------
export const AvolarHome = (opts) => {
  const css = readLocal("home.css")
  const script = readLocal("home.client.js")

  const Component = (props) => {
    const { fileData, allFiles, ctx } = props
    let cfg
    try {
      cfg = parseYaml(readLocal("home.yaml")) ?? {}
    } catch (e) {
      console.error("[avolar-home] Ошибка в home.yaml:", e.message)
      return null
    }
    cfg = { ...cfg, ...(opts ?? {}) }
    const atm = cfg.atmosphere ?? {}
    const flags = {
      "data-cursor": atm.cursor === false ? "off" : "on",
      "data-ambient": atm.ambient === false ? "off" : "on",
    }
    // на остальных страницах — только флаги для курсора и звука
    if (fileData?.slug !== "index") return h("span", { class: "avh-flags", hidden: true, ...flags })

    const R = buildResolver(allFiles ?? [], ctx)

    const html = [
      cfg.hero ? heroSection(cfg.hero, R) : "",
      cfg.paths ? pathsSection(cfg.paths, R) : "",
      cfg.timeline ? timelineSection(cfg.timeline, R) : "",
      cfg.world ? worldSection(cfg.world, R) : "",
      cfg.map ? mapSection(cfg.map, R) : "",
      cfg.live ? liveSection(cfg.live, R, allFiles ?? []) : "",
      cfg.graph ? graphSection(cfg.graph, R) : "",
      cfg.footer ? `<p class="avh-footer">${inline(cfg.footer, R)}</p>` : "",
    ].join("")

    return h("div", {
      class: "avh",
      ...flags,
      dangerouslySetInnerHTML: { __html: html },
    })
  }

  Component.css = css
  Component.afterDOMLoaded = script
  Component.displayName = "AvolarHome"
  return Component
}
