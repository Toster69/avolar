// Интерактивная страница «О мире».
// Рендерится только на странице, указанной в world.yaml (page). Тексты берутся из самой статьи,
// стили — ../../world.css, интерактив — ../../world.client.js.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { h } from "preact"
import { parse as parseYaml } from "yaml"
import { slugifyFilePath } from "@quartz-community/utils"

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const readLocal = (name) => fs.readFileSync(path.join(pluginDir, name), "utf-8")

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

// ---------- поиск страниц и картинок ----------
function buildResolver(allFiles, ctx) {
  const byName = new Map()
  const add = (key, file) => {
    const k = norm(key)
    if (k && !byName.has(k)) byName.set(k, file)
  }
  for (const f of allFiles) add(f.filePath ? path.basename(String(f.filePath)).replace(/\.md$/i, "") : "", f)
  for (const f of allFiles) {
    const fm = f.frontmatter ?? {}
    add(fm.title, f)
    ;(Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : []).forEach((a) => add(a, f))
  }
  const assets = (ctx?.allFiles ?? []).map(String)
  const page = (name, quiet) => {
    if (!name) return null
    const file = byName.get(norm(name))
    if (!file) {
      if (!quiet) console.warn(`[avolar-world] Не найдена страница «${name}»`)
      return null
    }
    return { href: slugToHref(String(file.slug)), slug: String(file.slug), title: file.frontmatter?.title ?? name, file }
  }
  const image = (name) => {
    if (!name) return null
    if (/^https?:\/\//.test(name)) return name
    const target = norm(path.basename(name))
    const fp = assets.find((p) => norm(path.basename(p)) === target)
    if (!fp) {
      console.warn(`[avolar-world] Не найдена картинка «${name}» — проверьте world.yaml`)
      return null
    }
    return "./" + slugifyFilePath(fp.replace(/^.*?content[\\/]/, ""))
  }
  return { page, image }
}

const linkTag = (p, text, cls = "") =>
  `<a href="${esc(p.href)}" class="internal ${cls}" data-slug="${esc(p.slug)}">${text}</a>`

// ---------- мини-markdown: **жирный**, *курсив*, [[ссылки]], [ссылки](url) ----------
function inline(md, R) {
  let out = esc(md)
  out = out.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const p = R.page(target.replace(/&quot;/g, '"').trim())
    const text = label ?? target
    return p ? linkTag(p, text) : text
  })
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => `<a href="${url}" class="external" target="_blank" rel="noopener">${text}</a>`)
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  out = out.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>")
  return out
}

// разбор блока markdown на абзацы, списки и таблицы
function blocks(md) {
  const out = []
  let para = []
  const flush = () => {
    if (para.length) out.push({ type: "p", text: para.join(" ") })
    para = []
  }
  const lines = md.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t || /^-{3,}$/.test(t) || /^>/.test(t) || /^!\[\[/.test(t)) {
      flush()
      continue
    }
    if (/^[-*]\s+/.test(t)) {
      flush()
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, "").trim())
      i--
      out.push({ type: "ul", items })
      continue
    }
    if (/^\|/.test(t)) {
      flush()
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i]
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim())
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells)
        i++
      }
      i--
      out.push({ type: "table", rows: rows.slice(1) })
      continue
    }
    para.push(t)
  }
  flush()
  return out
}
const renderBlocks = (bs, R) =>
  bs
    .map((b) =>
      b.type === "p"
        ? `<p>${inline(b.text, R)}</p>`
        : b.type === "ul"
          ? `<ul>${b.items.map((it) => `<li>${inline(it, R)}</li>`).join("")}</ul>`
          : "",
    )
    .join("")

// разделы статьи: ## и ###
function sections(md) {
  const body = md.replace(/^---[\s\S]*?\n---\n/, "")
  const out = []
  let cur = { title: "", level: 1, body: "", subs: [] }
  out.push(cur)
  let sub = null
  for (const line of body.split("\n")) {
    const h2 = line.match(/^##\s+(.+?)\s*$/)
    const h3 = line.match(/^###\s+(.+?)\s*$/)
    if (h2) {
      cur = { title: h2[1].trim(), body: "", subs: [] }
      out.push(cur)
      sub = null
    } else if (h3) {
      sub = { title: h3[1].trim(), body: "" }
      cur.subs.push(sub)
    } else if (sub) sub.body += line + "\n"
    else cur.body += line + "\n"
  }
  return out
}
const findSection = (secs, start) => secs.find((s) => norm(s.title).startsWith(norm(start)))

// ---------- секции страницы ----------
function hero(cfg, file, R) {
  const img = R.image(cfg.hero?.image)
  const g = cfg.hero?.guide
  return `
  <header class="avw-hero"${img ? ` style="--hero:url('${esc(img)}')"` : ""}>
    <div class="avw-hero-inner">
      <h1 class="avw-title">${esc(file.frontmatter?.title ?? "О мире")}</h1>
      ${file.frontmatter?.description ? `<p class="avw-lede">${esc(file.frontmatter.description)}</p>` : ""}
      <nav class="avw-jump" aria-label="Разделы страницы">
        <a href="#avw-cosmos">Космология</a><a href="#avw-split">Две силы</a><a href="#avw-history">История</a>
      </nav>
      ${g?.url ? `<a class="avw-dl" href="${esc(g.url)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>${esc(g.label ?? "Скачать PDF")}</a>` : ""}
    </div>
  </header>`
}

function cosmos(sec, cfg, R) {
  if (!sec) return ""
  const bs = blocks(sec.body)
  const list = bs.find((b) => b.type === "ul")
  const idx = bs.indexOf(list)
  const before = bs.slice(0, idx < 0 ? 0 : idx)
  const after = bs.slice(idx < 0 ? 0 : idx + 1)
  const halves = { light: null, dark: null }
  for (const it of list?.items ?? []) {
    const m = it.match(/^\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/)
    if (!m) continue
    const text = m[2].charAt(0).toUpperCase() + m[2].slice(1)
    if (/свет/i.test(m[1])) halves.light = { name: m[1], text }
    if (/тьм/i.test(m[1])) halves.dark = { name: m[1], text }
  }
  const year = +cfg.year || 500
  // круг = 2000 лет: правая половина — Тысячелетие Тьмы (сверху вниз), левая — Света
  const angle = 0 + (year / 1000) * 180 // 0° — вверх; 90° — «сейчас» при 500
  const half = (key, h) =>
    h
      ? `<button type="button" class="avw-half avw-half-${key}" data-half="${key}" aria-pressed="${key === "dark"}">
          <span class="avw-half-name">${esc(h.name)}</span>
          <span class="avw-half-text">${inline(h.text, R)}</span></button>`
      : ""
  return `
  <section class="avw-section avw-cosmos" id="avw-cosmos" aria-labelledby="avw-cosmos-h">
    <h2 id="avw-cosmos-h">${esc(sec.title)}</h2>
    ${renderBlocks(before, R)}
    <div class="avw-cosmos-grid">
      <figure class="avw-dial" style="--needle:${angle}deg" aria-label="Маятник: сейчас ${year}-й год Тьмы">
        <svg viewBox="-110 -110 220 220" aria-hidden="true">
          <defs>
            <linearGradient id="avw-light" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f6e7b0"/><stop offset="1" stop-color="#c99a2e"/></linearGradient>
            <linearGradient id="avw-dark" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2a1630"/><stop offset="1" stop-color="#5b0e16"/></linearGradient>
          </defs>
          <path class="avw-dial-light" d="M0,-92 A92,92 0 0,0 0,92 Z"/>
          <path class="avw-dial-dark" d="M0,-92 A92,92 0 0,1 0,92 Z"/>
          <circle r="92" class="avw-dial-rim"/>
          <circle r="70" class="avw-dial-inner"/>
          ${Array.from({ length: 24 }, (_, i) => {
            const a = (i / 24) * Math.PI * 2
            const r1 = i % 6 === 0 ? 78 : 84
            return `<line x1="${(Math.sin(a) * r1).toFixed(1)}" y1="${(-Math.cos(a) * r1).toFixed(1)}" x2="${(Math.sin(a) * 92).toFixed(1)}" y2="${(-Math.cos(a) * 92).toFixed(1)}" class="avw-tick"/>`
          }).join("")}
          <text x="0" y="-98" class="avw-dial-label">0</text>
          <text x="0" y="106" class="avw-dial-label">1000</text>
          <text x="58" y="4" class="avw-dial-word avw-dial-word-dark">ТЬМА</text>
          <text x="-58" y="4" class="avw-dial-word avw-dial-word-light">СВЕТ</text>
          <g class="avw-hero-mark"><circle cx="-92" cy="0" r="4"/></g>
          <g class="avw-needle"><line x1="0" y1="0" x2="0" y2="-86"/><circle r="7"/><path d="M0,-96 L5,-84 L-5,-84 Z"/></g>
        </svg>
        <figcaption><b>${year}</b> год Тьмы<span>половина пути маятника</span></figcaption>
      </figure>
      <div class="avw-halves">
        ${half("light", halves.light)}${half("dark", halves.dark)}
        <p class="avw-dial-note"><i></i>Точка слева — «Жертва Героя», середина прошлого Тысячелетия Света.</p>
      </div>
    </div>
    <div class="avw-now">${renderBlocks(after, R)}</div>
  </section>`
}

function split(sec, cfg, R) {
  if (!sec) return ""
  const facs = sec.subs.map((s) => {
    const key = Object.keys(cfg.factions ?? {}).find((k) => norm(s.title).startsWith(norm(k)))
    const fc = key ? cfg.factions[key] : {}
    const bs = blocks(s.body)
    const tagIdx = bs.findIndex((b) => b.type === "p" && /^\*\*[^*]+\*\*$/.test(b.text))
    const tag = tagIdx >= 0 ? bs[tagIdx].text.replace(/\*\*/g, "") : ""
    const paras = bs.filter((b, i) => b.type === "p" && i !== tagIdx)
    const table = bs.find((b) => b.type === "table")
    const aspects = new Map((table?.rows ?? []).map((r) => [r[0].replace(/\*\*/g, "").trim(), r[1] ?? ""]))
    const short = s.title.match(/\(([^)]+)\)/)?.[1] ?? ""
    return {
      name: s.title.replace(/\s*\([^)]*\)\s*$/, ""),
      short,
      side: fc.side ?? (short || "x").toLowerCase(),
      img: R.image(fc.image),
      page: fc.page ? R.page(fc.page) : null,
      tag,
      paras,
      aspects,
    }
  })
  if (!facs.length) return ""
  const intro = renderBlocks(blocks(sec.body), R)
  const aspectNames = [...new Set(facs.flatMap((f) => [...f.aspects.keys()]))]
  const cards = facs
    .map(
      (f) => `
      <article class="avw-faction avw-side-${esc(f.side)}">
        ${f.img ? `<div class="avw-faction-img"><img src="${esc(f.img)}" alt="" loading="lazy"></div>` : ""}
        <div class="avw-faction-body">
          <h3>${esc(f.name)}${f.short ? ` <small>${esc(f.short)}</small>` : ""}</h3>
          ${f.tag ? `<p class="avw-tag">${esc(f.tag)}</p>` : ""}
          ${f.paras.map((p) => `<p>${inline(p.text, R)}</p>`).join("")}
          ${f.page ? linkTag(f.page, "Подробнее", "avw-more") : ""}
        </div>
      </article>`,
    )
    .join(`<div class="avw-vs" aria-hidden="true"><span>против</span></div>`)
  const tabs = aspectNames
    .map((a, i) => `<button type="button" role="tab" class="avw-tab" data-aspect="${i}" aria-selected="${i === 0}">${esc(a)}</button>`)
    .join("")
  const panels = aspectNames
    .map(
      (a, i) => `
      <div class="avw-aspect${facs.filter((f) => f.aspects.has(a)).length < 2 ? " is-single" : ""}" data-aspect="${i}" role="tabpanel"${i ? " hidden" : ""}>
        ${facs
          .filter((f) => f.aspects.has(a))
          .map(
            (f) => `<div class="avw-aspect-side avw-side-${esc(f.side)}">
              <span class="avw-aspect-who">${esc(f.name)}</span>
              <p>${inline(f.aspects.get(a), R)}</p></div>`,
          )
          .join("")}
      </div>`,
    )
    .join("")
  return `
  <section class="avw-section avw-split" id="avw-split" aria-labelledby="avw-split-h">
    <h2 id="avw-split-h">${esc(sec.title)}</h2>
    ${intro}
    <div class="avw-factions">${cards}</div>
    ${aspectNames.length ? `<div class="avw-compare"><h3 class="avw-compare-title">Сравнить стороны</h3><div class="avw-tabs" role="tablist">${tabs}</div>${panels}</div>` : ""}
  </section>`
}

function history(sec, cfg, R) {
  if (!sec || !sec.subs.length) return ""
  const eras = sec.subs.map((s, i) => {
    const m = s.title.match(/^(.+?)\.\s+(.+)$/)
    const label = m ? m[1] : s.title
    const title = m ? m[2] : ""
    const key = (s.title.match(/\d+/) ?? [""])[0]
    const ec = (cfg.eras ?? {})[key] ?? {}
    return { i, label, title, key, img: R.image(ec.image), page: ec.page ? R.page(ec.page) : null, html: renderBlocks(blocks(s.body), R) }
  })
  const rail = eras
    .map(
      (e) => `<li><button type="button" role="tab" class="avw-era-btn" data-era="${e.i}" aria-selected="${e.i === eras.length - 1}">
        <b>${esc(e.label.replace(/\s*год Тьмы\s*$/i, ""))}</b><span>${esc(e.title)}</span></button></li>`,
    )
    .join("")
  const panels = eras
    .map(
      (e) => `
      <article class="avw-era" data-era="${e.i}" role="tabpanel"${e.i === eras.length - 1 ? "" : " hidden"}>
        ${e.img ? `<div class="avw-era-img"><img src="${esc(e.img)}" alt="" loading="lazy"><span class="avw-era-year">${esc(e.label)}</span></div>` : ""}
        <div class="avw-era-text">
          <h3>${esc(e.title || e.label)}</h3>
          ${e.html}
          <div class="avw-era-nav">
            <button type="button" class="avw-step" data-step="-1" aria-label="Предыдущая эпоха"${e.i === 0 ? " disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
            <span>${e.i + 1} / ${eras.length}</span>
            <button type="button" class="avw-step" data-step="1" aria-label="Следующая эпоха"${e.i === eras.length - 1 ? " disabled" : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
            ${e.page ? linkTag(e.page, "Подробнее", "avw-more") : ""}
          </div>
        </div>
      </article>`,
    )
    .join("")
  return `
  <section class="avw-section avw-history" id="avw-history" aria-labelledby="avw-history-h">
    <h2 id="avw-history-h">${esc(sec.title)}</h2>
    <ol class="avw-rail" role="tablist" style="--n:${eras.length}">${rail}</ol>
    ${panels}
  </section>`
}

function seeAlso(sec, R) {
  if (!sec) return ""
  const items = (blocks(sec.body).find((b) => b.type === "ul")?.items ?? [])
    .map((it) => inline(it, R))
    .filter((s) => s.includes("<a "))
  if (!items.length) return ""
  return `<section class="avw-section avw-see" aria-labelledby="avw-see-h">
    <h2 id="avw-see-h">${esc(sec.title)}</h2>
    <ul class="avw-chips">${items.map((i) => `<li>${i}</li>`).join("")}</ul></section>`
}

// ---------- компонент ----------
export const AvolarWorld = (opts) => {
  const css = readLocal("world.css")
  const script = readLocal("world.client.js")

  const Component = (props) => {
    const { fileData, allFiles, ctx } = props
    let cfg
    try {
      cfg = { ...(parseYaml(readLocal("world.yaml")) ?? {}), ...(opts ?? {}) }
    } catch (e) {
      console.error("[avolar-world] Ошибка в world.yaml:", e.message)
      return null
    }
    const R = buildResolver(allFiles ?? [], ctx)
    const target = R.page(cfg.page ?? "О мире", true)
    if (!target || String(fileData?.slug) !== target.slug) return null

    let raw
    try {
      const fp = String(fileData.filePath)
      raw = fs.readFileSync(path.isAbsolute(fp) ? fp : path.resolve(process.cwd(), fp), "utf-8")
    } catch {
      return null
    }
    const secs = sections(raw)
    const html = [
      hero(cfg, fileData, R),
      cosmos(findSection(secs, "Космология"), cfg, R),
      split(findSection(secs, "Расколотый мир"), cfg, R),
      history(findSection(secs, "История"), cfg, R),
      seeAlso(findSection(secs, "Смотрите также"), R),
    ].join("")
    return h("div", { class: "avw", dangerouslySetInnerHTML: { __html: html } })
  }
  Component.css = css
  Component.afterDOMLoaded = script
  Component.displayName = "AvolarWorld"
  return Component
}
