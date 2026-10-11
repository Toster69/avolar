// Компонент интерактивной карты Аволара.
// Рендерится только на странице «Карта» (slug "карта"). Данные — ../../atlas.yaml и ../../overlays.json,
// стили — ../../atlas.css, интерактив — ../../atlas.client.js.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { h } from "preact"
import { parse as parseYaml } from "yaml"
import { slugifyFilePath } from "@quartz-community/utils"

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const readLocal = (name) => fs.readFileSync(path.join(pluginDir, name), "utf-8")
const TARGET_SLUG = "карта"

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
const simple = (slug) => String(slug).replace(/\/index$/, "")

function buildResolver(allFiles, ctx) {
  const byName = new Map()
  const add = (key, file) => {
    const k = norm(key)
    if (k && !byName.has(k)) byName.set(k, file)
  }
  for (const f of allFiles) {
    add(f.filePath ? path.basename(String(f.filePath)).replace(/\.md$/i, "") : "", f)
  }
  for (const f of allFiles) {
    const fm = f.frontmatter ?? {}
    add(fm.title, f)
    ;(Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : []).forEach((a) => add(a, f))
  }
  const assets = (ctx?.allFiles ?? []).map(String)

  const page = (name) => {
    if (!name) return null
    const file = byName.get(norm(name))
    if (!file) {
      console.warn(`[avolar-atlas] Не найдена страница «${name}» — проверьте atlas.yaml`)
      return null
    }
    return { href: slugToHref(String(file.slug)), slug: String(file.slug), title: file.frontmatter?.title ?? name, file }
  }
  const image = (name, quiet) => {
    if (!name) return null
    if (/^https?:\/\//.test(name)) return name
    const target = norm(path.basename(decodeURIComponent(name)))
    const fp = assets.find((p) => norm(path.basename(p)) === target)
    if (!fp) {
      if (!quiet) console.warn(`[avolar-atlas] Не найдена картинка «${name}»`)
      return null
    }
    return "./" + slugifyFilePath(fp.replace(/^.*?content[\\/]/, ""))
  }
  return { page, image }
}

// первая картинка в статье: ![[x.webp]], ![](x.webp) или <img src="x.webp">
function firstImage(file, R) {
  if (!file?.filePath) return null
  let raw
  try {
    const fp = String(file.filePath)
    raw = fs.readFileSync(path.isAbsolute(fp) ? fp : path.resolve(process.cwd(), fp), "utf-8")
  } catch {
    return null
  }
  const re = /!\[\[([^\]|#]+?\.(?:webp|png|jpe?g|gif|avif))[^\]]*\]\]|!\[[^\]]*\]\(([^)\s]+?\.(?:webp|png|jpe?g|gif|avif))\)|<img[^>]+src="([^"]+?\.(?:webp|png|jpe?g|gif|avif))"/gi
  for (const m of raw.matchAll(re)) {
    const src = R.image(m[1] || m[2] || m[3], true)
    if (src) return src
  }
  return null
}

function buildData(cfg, R) {
  const places = (cfg.places ?? [])
    .map((p, i) => {
      const pg = R.page(p.page)
      if (!pg) return null
      return {
        id: "p" + i,
        kind: "place",
        name: pg.title,
        x: +p.x,
        y: +p.y,
        type: p.type ?? "city",
        lost: !!p.lost,
        note: p.note ?? "",
        desc: pg.file.frontmatter?.description ?? "",
        image: R.image(p.image) ?? firstImage(pg.file, R),
        href: pg.href,
        slug: simple(pg.slug),
      }
    })
    .filter(Boolean)

  const sites = (cfg.sites ?? [])
    .map((e, i) => {
      const pg = e.page ? R.page(e.page) : null
      return {
        id: "s" + i,
        kind: "site",
        name: e.name,
        x: +e.x,
        y: +e.y,
        note: e.note ?? "",
        href: pg?.href ?? null,
        slug: pg ? simple(pg.slug) : null,
        pageTitle: pg?.title ?? null,
      }
    })
    .filter((e) => Number.isFinite(e.x) && Number.isFinite(e.y))

  let overlays = { strip: [] }
  try {
    overlays = JSON.parse(readLocal("overlays.json"))
  } catch (e) {
    console.warn("[avolar-atlas] Не прочитан overlays.json:", e.message)
  }

  return {
    pageOf: (name) => R.page(name),
    title: cfg.title ?? "Карта",
    image: R.image(cfg.image),
    aspect: +cfg.aspect || 1,
    kmPerMapWidth: +cfg.kmPerMapWidth || null,
    kmPerDay: +cfg.kmPerDay || null,
    types: cfg.types ?? {},
    places,
    sites,
    strip: overlays.strip ?? [],
  }
}

const ptsAttr = (pts) => pts.map(([x, y]) => `${x},${y}`).join(" ")

function render(cfg, data) {
  const order = ["capital", "city", "fortress", "shrine"]
  const typesUsed = [...new Set(data.places.map((p) => p.type))].sort(
    (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99),
  )
  const plural = { capital: "Столица", city: "Города", fortress: "Крепости", shrine: "Святыни" }

  // переключатели под картой: какие значки показывать
  const toggles = [
    ...typesUsed.map((t) => ({ key: "t-" + t, label: plural[t] ?? data.types[t] ?? t, sw: `atl-sw-${t}` })),
    ...(data.sites.length ? [{ key: "sites", label: "Знаковые места", sw: "atl-sw-site" }] : []),
    ...(data.strip.length ? [{ key: "strip", label: "Красная Полоса", sw: "atl-lg-strip" }] : []),
  ]
  const toggleHtml = toggles
    .map(
      (t) =>
        `<button type="button" class="atl-toggle" data-toggle="${esc(t.key)}" aria-pressed="true"><i class="atl-sw ${esc(t.sw)}" aria-hidden="true"></i>${esc(t.label)}</button>`,
    )
    .join("")

  const sides = (cfg.sides ?? [])
    .map((sd) => {
      const pg = sd.page ? data.pageOf(sd.page) : null
      return `<li class="atl-side-item" style="--c:${esc(sd.color ?? "#e8c766")}">
        <span class="atl-side-key atl-side-${esc(sd.key ?? "area")}" aria-hidden="true"></span>
        <div><h3>${pg ? `<a class="internal" href="${esc(pg.href)}" data-slug="${esc(pg.slug)}">${esc(sd.name ?? pg.title)}</a>` : esc(sd.name)}</h3>
        <p>${esc(sd.text ?? "")}</p></div></li>`
    })
    .join("")

  const legendItems = [
    ...typesUsed.map((t) => `<li><i class="atl-sw atl-sw-${esc(t)}"></i>${esc(data.types[t] ?? t)}</li>`),
    data.places.some((p) => p.lost) ? `<li><i class="atl-sw atl-sw-lost"></i>${esc(data.types.lost ?? "Пропавший город")}</li>` : "",
    data.sites.length ? `<li><i class="atl-sw atl-sw-site"></i>Знаковое место</li>` : "",
    data.strip.length ? `<li><i class="atl-lg-strip"></i>Красная Полоса</li>` : "",
    `<li><i class="atl-lg-border"></i>Граница фракций</li>`,
  ].join("")

  const icon = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`

  return `
  <header class="atl-head">
    <h1 class="atl-title">${esc(data.title)}</h1>
    ${cfg.intro ? `<p class="atl-intro">${esc(cfg.intro)}</p>` : ""}
  </header>

  <div class="atl-app">
    <div class="atl-stage" tabindex="0" aria-label="Карта. Перетаскивайте, чтобы двигать; колесо, жесты или плюс и минус — масштаб.">
      <div class="atl-world" style="aspect-ratio:${data.aspect}">
        <img class="atl-img" src="${esc(data.image)}" alt="Карта Аволара" draggable="false" decoding="async">
        <svg class="atl-svg" viewBox="0 0 100 ${+(100 / data.aspect).toFixed(3)}" preserveAspectRatio="none" aria-hidden="true">
          <defs><filter id="atl-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.6"/></filter></defs>
          ${data.strip.length ? `<g class="atl-strip"><polygon class="atl-strip-glow" points="${ptsAttr(data.strip)}" filter="url(#atl-glow)"/><polygon class="atl-strip-edge" points="${ptsAttr(data.strip)}"/></g>` : ""}
          <g class="atl-ruler"></g>
        </svg>
        <div class="atl-pins"></div>
      </div>

      <div class="atl-controls" role="toolbar" aria-label="Управление картой">
        <button type="button" data-act="in" aria-label="Приблизить">+</button>
        <button type="button" data-act="out" aria-label="Отдалить">−</button>
        <button type="button" data-act="reset" aria-label="Показать всю Коалицию">${icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>')}</button>
        <button type="button" data-act="full" aria-label="Во весь экран">${icon('<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>')}</button>
        ${data.kmPerMapWidth ? `<button type="button" data-act="ruler" aria-pressed="false" aria-label="Линейка">${icon('<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>')}</button>` : ""}
        <button type="button" data-act="coords" aria-pressed="false" aria-label="Узнать координаты точки">${icon('<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>')}</button>
      </div>

      <div class="atl-overview" aria-hidden="true">
        <img src="${esc(data.image)}" alt="" draggable="false" loading="lazy" decoding="async">
        <span class="atl-overview-view"></span>
      </div>

      <div class="atl-legend">
        <button type="button" class="atl-legend-toggle" aria-expanded="false">
          <svg class="atl-rose" viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="22"/><circle cx="32" cy="32" r="15" stroke-dasharray="1.5 2.5"/>
            <path d="M32 4 L36 32 L32 60 L28 32 Z" class="fill"/><path d="M4 32 L32 28 L60 32 L32 36 Z"/>
          </svg>Легенда</button>
        <ul class="atl-legend-list" hidden>${legendItems}</ul>
      </div>

      <div class="atl-card" hidden></div>
      <div class="atl-hint" hidden></div>
    </div>

    <div class="atl-bar" role="group" aria-label="Что показывать на карте">
      <span class="atl-bar-label">Показывать:</span>
      <div class="atl-toggles">${toggleHtml}</div>
      <button type="button" class="atl-toggle-all" data-all="off">Скрыть все значки</button>
    </div>
  </div>

  ${sides ? `<section class="atl-index" aria-label="${esc(cfg.sidesTitle ?? "Границы")}"><div class="atl-block"><h2>${esc(cfg.sidesTitle ?? "Границы")}</h2><ul class="atl-sides">${sides}</ul></div></section>` : ""}
  <script type="application/json" class="atl-data">${JSON.stringify({ ...data, pageOf: undefined }).replace(/</g, "\\u003c")}</script>`
}

export const AvolarAtlas = (opts) => {
  const css = readLocal("atlas.css")
  const script = readLocal("atlas.client.js")

  const Component = (props) => {
    const { fileData, allFiles, ctx } = props
    if (fileData?.slug !== TARGET_SLUG) return null
    let cfg
    try {
      cfg = { ...(parseYaml(readLocal("atlas.yaml")) ?? {}), ...(opts ?? {}) }
    } catch (e) {
      console.error("[avolar-atlas] Ошибка в atlas.yaml:", e.message)
      return null
    }
    const R = buildResolver(allFiles ?? [], ctx)
    const data = buildData(cfg, R)
    if (!data.image) return null
    return h("div", { class: "atl", dangerouslySetInnerHTML: { __html: render(cfg, data) } })
  }
  Component.css = css
  Component.afterDOMLoaded = script
  Component.displayName = "AvolarAtlas"
  return Component
}
