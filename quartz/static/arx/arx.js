// =====================================================================
//  Карта Аркс-Феррума: зум, слои, меню мест, превью и маршруты.
//  Данные — data.js, сетка улиц для маршрутов — roads.png.
// =====================================================================
;(function () {
  "use strict"
  const D = window.ARX
  const $ = (s) => document.querySelector(s)
  const $$ = (s) => [...document.querySelectorAll(s)]
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
  const norm = (s) => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches
  const narrow = () => matchMedia("(max-width: 760px)").matches
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} },
  }

  // адрес сайта: …/avolar/static/arx/ → …/avolar/
  const BASE = location.pathname.replace(/static\/arx\/[^/]*$/, "")
  const ASPECT = 2 / 3 // ширина / высота карты (3600 × 5400)
  const VBH = 100 / ASPECT

  const app = $("#arx")
  const stage = $("#stage")
  const world = $("#world")
  const mapImg = $("#map")
  const pinsEl = $("#pins")
  const distEl = $("#districts")
  const routeSvg = $("#routeLayer")
  const card = $("#card")
  const hint = $("#hint")

  // ---------------- данные ----------------
  const layerById = new Map(D.layers.map((l) => [l.id, l]))
  const places = D.places.map((p) => ({ ...p, kind: "place", id: "p" + p.n }))
  const districts = D.districts.map((d) => ({ ...d, kind: "district", id: "d" + d.name }))
  const byId = new Map([...places, ...districts].map((i) => [i.id, i]))
  const placeByN = new Map(places.map((p) => [p.n, p]))
  const distByName = new Map(districts.map((d) => [norm(d.name), d]))
  const locOf = (a) => (a.place != null ? placeByN.get(a.place) : distByName.get(norm(a.district)))
  const people = D.people
    .map((p, i) => {
      const at = (p.at ?? []).map((a) => ({ ...a, item: locOf(a) })).filter((a) => a.item)
      return { ...p, kind: "person", id: "c" + i, name: p.page, at, x: at[0]?.item.x, y: at[0]?.item.y }
    })
    .filter((p) => p.at.length)
  people.forEach((p) => byId.set(p.id, p))
  const peopleAt = (item) => people.filter((p) => p.at.some((a) => a.item === item))

  // ---------------- статьи базы ----------------
  // contentIndex.json знает все страницы сайта: по нему проверяем, есть ли статья
  let index = null
  const ready = fetch(BASE + "static/contentIndex.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return
      index = { byTitle: new Map(), bySeg: new Map() }
      // сначала папки, потом статьи: у статьи с тем же именем приоритет
      // (папка «Персонажи/Аркс-Феррум» не должна перекрыть статью «Аркс-Феррум»)
      const entries = Object.entries(data).filter(([slug]) => !slug.startsWith("tags/"))
      const folders = entries.filter(([slug]) => slug.endsWith("/index"))
      const pages = entries.filter(([slug]) => !slug.endsWith("/index"))
      for (const [slug, v] of [...folders, ...pages]) {
        const clean = slug.replace(/\/index$/, "")
        index.byTitle.set(norm(v.title), clean)
        index.bySeg.set(norm(clean.split("/").pop()), clean)
      }
    })
    .catch(() => {})
  const slugOf = (name) => (index && name ? index.byTitle.get(norm(name)) ?? index.bySeg.get(norm(name)) ?? null : null)
  // заголовок → якорь, как делает Quartz (github-slugger)
  const anchorOf = (h) => String(h).toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "").replace(/ /g, "-")
  const hrefOf = (item) => {
    const slug = slugOf(item.page)
    if (!slug) return null
    return BASE + slug + (item.anchor ? "#" + anchorOf(item.anchor) : "")
  }
  // из статьи берём описание и первую картинку
  const pageCache = new Map()
  function pageInfo(name) {
    const slug = slugOf(name)
    if (!slug) return Promise.resolve(null)
    if (!pageCache.has(slug)) {
      const url = new URL(BASE + slug, location.origin)
      pageCache.set(
        slug,
        fetch(url)
          .then((r) => (r.ok ? r.text() : null))
          .then((html) => {
            if (!html) return null
            const doc = new DOMParser().parseFromString(html, "text/html")
            const desc = doc.querySelector('meta[name="description"]')?.content ?? doc.querySelector('meta[property="og:description"]')?.content ?? ""
            const im = [...doc.querySelectorAll("article img")].find((i) => !/icon|favicon/.test(i.getAttribute("src") || ""))
            const img = im ? new URL(im.getAttribute("src"), url).href : null
            return { desc, img }
          })
          .catch(() => null),
      )
    }
    return pageCache.get(slug)
  }

  // ---------------- камера ----------------
  const st = { s: 1, tx: 0, ty: 0, fitW: 0, sw: 0, sh: 0, maxS: 8 }
  let flyRaf = 0
  function layout(keep) {
    const r = stage.getBoundingClientRect()
    let cx, cy
    if (keep && st.fitW) {
      cx = (st.sw / 2 - st.tx) / (st.fitW * st.s)
      cy = (st.sh / 2 - st.ty) / ((st.fitW / ASPECT) * st.s)
    }
    st.sw = r.width
    st.sh = r.height
    st.fitW = Math.min(st.sw, st.sh * ASPECT)
    st.maxS = Math.max(3, (3600 / st.fitW) * 1.25)
    if (keep && cx != null) {
      st.tx = st.sw / 2 - cx * st.fitW * st.s
      st.ty = st.sh / 2 - cy * (st.fitW / ASPECT) * st.s
    }
    apply()
  }
  function apply() {
    st.s = clamp(st.s, 1, st.maxS)
    const dw = st.fitW * st.s
    const dh = (st.fitW / ASPECT) * st.s
    st.tx = dw <= st.sw ? (st.sw - dw) / 2 : clamp(st.tx, st.sw - dw, 0)
    st.ty = dh <= st.sh ? (st.sh - dh) / 2 : clamp(st.ty, st.sh - dh, 0)
    // карта рисуется в настоящем размере — остаётся чёткой при приближении
    world.style.width = dw + "px"
    world.style.height = dh + "px"
    world.style.transform = `translate(${st.tx}px, ${st.ty}px)`
    world.style.setProperty("--k", clamp(0.85 + (st.s - 1) * 0.12, 0.85, 1.45).toFixed(3))
    if (st.s > 1.6) loadFullMap()
    if (openItem) placeCard()
  }
  function zoomAt(px, py, f) {
    const ns = clamp(st.s * f, 1, st.maxS)
    st.tx = px - (px - st.tx) * (ns / st.s)
    st.ty = py - (py - st.ty) * (ns / st.s)
    st.s = ns
    apply()
  }
  function flyTo(x, y, s, done) {
    cancelAnimationFrame(flyRaf)
    const ts = clamp(s ?? st.s, 1, st.maxS)
    // карточка снизу на телефоне — центр чуть выше
    const oy = narrow() && openItem ? -st.sh * 0.18 : 0
    const target = { s: ts, tx: st.sw / 2 - (x / 100) * st.fitW * ts, ty: st.sh / 2 + oy - (y / 100) * (st.fitW / ASPECT) * ts }
    if (reduceMotion()) {
      Object.assign(st, target)
      apply()
      return done && done()
    }
    const from = { s: st.s, tx: st.tx, ty: st.ty }
    const t0 = performance.now()
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 650)
      const e = 1 - Math.pow(1 - k, 3)
      st.s = from.s + (target.s - from.s) * e
      st.tx = from.tx + (target.tx - from.tx) * e
      st.ty = from.ty + (target.ty - from.ty) * e
      apply()
      if (k < 1) flyRaf = requestAnimationFrame(step)
      else if (done) done()
    }
    flyRaf = requestAnimationFrame(step)
  }
  // сколько места на экране закрывают открытые меню
  function insets() {
    if (narrow()) return { l: 8, r: 58, t: 62, b: 12 }
    return { l: $("#left").hidden ? 0 : 352, r: $("#right").hidden ? 56 : 352, t: 60, b: 0 }
  }
  function fitPoints(pts, maxS = 4, pad = 4) {
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    const x0 = Math.max(0, Math.min(...xs) - pad), x1 = Math.min(100, Math.max(...xs) + pad)
    const y0 = Math.max(0, Math.min(...ys) - pad), y1 = Math.min(100, Math.max(...ys) + pad)
    const ins = insets()
    const aw = Math.max(200, st.sw - ins.l - ins.r)
    const ah = Math.max(200, st.sh - ins.t - ins.b)
    const s = clamp(Math.min(aw / (((x1 - x0) / 100) * st.fitW), ah / (((y1 - y0) / 100) * (st.fitW / ASPECT)), maxS), 1, st.maxS)
    // центр видимой области, а не всего экрана
    const cxPx = ins.l + aw / 2 - st.sw / 2
    const cyPx = ins.t + ah / 2 - st.sh / 2
    const cx = (x0 + x1) / 2 - (cxPx / (st.fitW * s)) * 100
    const cy = (y0 + y1) / 2 - (cyPx / ((st.fitW / ASPECT) * s)) * 100
    flyTo(cx, cy, s)
  }
  const toPct = (cx, cy) => {
    const r = stage.getBoundingClientRect()
    return { x: ((cx - r.left - st.tx) / (st.fitW * st.s)) * 100, y: ((cy - r.top - st.ty) / ((st.fitW / ASPECT) * st.s)) * 100 }
  }
  // сначала лёгкая карта, при приближении — полная (3600 × 5400)
  let fullLoading = false
  function loadFullMap() {
    if (fullLoading) return
    fullLoading = true
    const big = new Image()
    big.decoding = "async"
    big.onload = () => (mapImg.src = big.src)
    big.src = "map.webp"
  }

  // ---------------- метки ----------------
  const els = new Map()
  for (const d of districts) {
    const b = document.createElement("button")
    b.type = "button"
    b.className = "district"
    b.dataset.id = d.id
    b.textContent = d.name
    b.style.left = d.x + "%"
    b.style.top = d.y + "%"
    distEl.appendChild(b)
    els.set(d.id, b)
  }
  for (const p of places) {
    const L = layerById.get(p.layer)
    const b = document.createElement("button")
    b.type = "button"
    b.className = "pin"
    b.dataset.id = p.id
    b.dataset.layer = p.layer
    b.style.setProperty("--c", L?.color ?? "#e8c766")
    b.style.left = p.x + "%"
    b.style.top = p.y + "%"
    b.setAttribute("aria-label", `${p.n}. ${p.name}`)
    b.innerHTML = `<span class="pin-shape"></span><span class="pin-num">${p.n}</span><span class="tip">${esc(p.name)}</span>`
    pinsEl.appendChild(b)
    els.set(p.id, b)
  }
  // персонажи — веером над своим местом
  const groups = new Map()
  for (const c of people) {
    const key = c.at[0].item.id
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }
  for (const list of groups.values()) {
    list.forEach((c, i) => {
      const n = list.length
      const a = -Math.PI / 2 + (n === 1 ? 0 : ((i - (n - 1) / 2) * Math.PI) / 3.6)
      const r = n === 1 ? 30 : 36
      const b = document.createElement("button")
      b.type = "button"
      b.className = "person" + (c.hero ? " hero" : "")
      b.dataset.id = c.id
      b.style.left = c.x + "%"
      b.style.top = c.y + "%"
      b.style.setProperty("--dx", `calc(${Math.cos(a) * r}px * var(--k, 1))`)
      b.style.setProperty("--dy", `calc(${Math.sin(a) * r - 6}px * var(--k, 1))`)
      b.setAttribute("aria-label", c.name)
      b.innerHTML = `<span class="ini">${esc((c.short ?? c.name)[0])}</span><span class="tip">${esc(c.short ?? c.name)}</span>`
      pinsEl.appendChild(b)
      els.set(c.id, b)
    })
  }
  // портреты из статей
  const portraits = new Map()
  ready.then(() =>
    people.forEach((c) =>
      pageInfo(c.page).then((info) => {
        if (!info?.img) return
        portraits.set(c.id, info.img)
        const el = els.get(c.id)
        el.querySelector(".ini")?.remove()
        el.insertAdjacentHTML("afterbegin", `<img src="${esc(info.img)}" alt="" loading="lazy" draggable="false">`)
        $$(`[data-face="${c.id}"]`).forEach((f) => (f.innerHTML = `<img src="${esc(info.img)}" alt="">`))
      }),
    ),
  )

  // ---------------- слои ----------------
  const LAYERS = [...D.layers, { id: "people", name: "Персонажи", color: "#e8c766" }, { id: "districts", name: "Районы", color: "#fff3c4" }]
  const hidden = new Set(store.get("arx-hidden", []))
  const layersPop = $("#layersPop")
  const layersBtn = $("#layersBtn")
  const countOf = (id) => (id === "people" ? people.length : id === "districts" ? districts.length : places.filter((p) => p.layer === id).length)
  function renderLayers() {
    layersPop.innerHTML =
      LAYERS.map(
        (l, i) =>
          `${i === D.layers.length ? '<div class="layers-sep"></div>' : ""}<button type="button" class="layer" role="menuitemcheckbox" data-layer="${l.id}" aria-checked="${!hidden.has(l.id)}" style="--c:${l.color}">
            <span class="box"></span>${esc(l.name)}<span class="count">${countOf(l.id)}</span></button>`,
      ).join("") + `<button type="button" class="layers-all">${hidden.size ? "Показать все" : "Скрыть все значки"}</button>`
  }
  function applyLayers() {
    for (const p of places) els.get(p.id).hidden = hidden.has(p.layer)
    app.classList.toggle("hide-people", hidden.has("people"))
    app.classList.toggle("hide-districts", hidden.has("districts"))
    $$(".group-title[data-layer]").forEach((g) => g.classList.toggle("off", hidden.has(g.dataset.layer)))
    store.set("arx-hidden", [...hidden])
    renderLayers()
  }
  layersPop.addEventListener("click", (e) => {
    // меню перерисовывается — не даём щелчку закрыть его
    e.stopPropagation()
    const b = e.target.closest(".layer")
    if (b) {
      const id = b.dataset.layer
      hidden.has(id) ? hidden.delete(id) : hidden.add(id)
      return applyLayers()
    }
    if (e.target.closest(".layers-all")) {
      if (hidden.size) hidden.clear()
      else LAYERS.forEach((l) => l.id !== "districts" && hidden.add(l.id))
      applyLayers()
    }
  })
  layersBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    const open = layersPop.hidden
    layersPop.hidden = !open
    layersBtn.setAttribute("aria-expanded", String(open))
  })
  const ensureVisible = (item) => {
    const layer = item.kind === "person" ? "people" : item.kind === "district" ? "districts" : item.layer
    if (hidden.has(layer)) {
      hidden.delete(layer)
      applyLayers()
    }
  }

  // ---------------- превью ----------------
  let openItem = null
  const kindLine = (item) => {
    if (item.kind === "place") {
      const L = layerById.get(item.layer)
      return `<span class="card-kind" style="--c:${L?.color}"><i></i>№ ${item.n} · ${esc(L?.name ?? "")}</span>`
    }
    if (item.kind === "district") return `<span class="card-kind" style="--c:#fff3c4"><i></i>Район</span>`
    return `<span class="card-kind" style="--c:${item.hero ? "#e8c766" : "#9fb3cc"}"><i style="border-radius:50%"></i>${item.hero ? "Герой кампании" : "Житель города"}</span>`
  }
  const faceHtml = (c) => {
    const img = portraits.get(c.id)
    return `<span class="face" data-face="${c.id}">${img ? `<img src="${esc(img)}" alt="">` : esc((c.short ?? c.name)[0])}</span>`
  }
  function cardHtml(item) {
    const href = item.page ? hrefOf(item) : null
    const actions = `<div class="card-actions">
        <button type="button" class="btn primary" data-route="${esc(item.id)}">Маршрут сюда</button>
        ${href ? `<a class="btn" href="${esc(href)}">Читать в базе</a>` : ""}</div>`
    if (item.kind === "person") {
      const where = item.at
        .map((a) => {
          const it = a.item
          const mini = it.kind === "place" ? `<span class="mini" style="--c:${layerById.get(it.layer)?.color}">${it.n}</span>` : `<span class="mini d">◆</span>`
          return `<li><button type="button" data-go="${esc(it.id)}">${mini}<span>${esc(it.name)}<small>${esc(a.label ?? "")}</small></span></button></li>`
        })
        .join("")
      return `<button type="button" class="card-close" aria-label="Закрыть">×</button>
        <div class="card-media" data-media></div>
        <div class="card-body">${kindLine(item)}<h3>${esc(item.name)}</h3>
          <p class="muted" data-desc></p>
          <ul class="card-where">${where}</ul>${actions}</div>`
    }
    // место или район: без статьи — только название
    const who = peopleAt(item)
    const whoHtml = who.length
      ? `<div class="card-people">${who.map((c) => `<button type="button" class="chip" data-go="${c.id}">${faceHtml(c)}${esc(c.short ?? c.name)}</button>`).join("")}</div>`
      : ""
    const body = href && item.text ? `<p>${esc(item.text)}</p>` : ""
    return `<button type="button" class="card-close" aria-label="Закрыть">×</button>
      <div class="card-media" data-media></div>
      <div class="card-body">${kindLine(item)}<h3>${esc(item.name)}</h3>${body}${whoHtml}${actions}</div>`
  }
  function placeCard() {
    if (!openItem || card.hidden || narrow()) return
    const el = els.get(openItem.id)
    if (!el) return
    const sr = stage.getBoundingClientRect()
    const pr = el.getBoundingClientRect()
    const cw = card.offsetWidth
    const ch = card.offsetHeight
    let x = pr.left - sr.left + pr.width / 2 - cw / 2
    let y = pr.top - sr.top - ch - 14
    if (y < 64) y = pr.bottom - sr.top + 14
    const leftOpen = !$("#left").hidden ? 352 : 12
    const rightOpen = !$("#right").hidden ? 352 : 60
    card.style.left = clamp(x, leftOpen, Math.max(leftOpen, st.sw - cw - rightOpen)) + "px"
    card.style.top = clamp(y, 64, Math.max(64, st.sh - ch - 12)) + "px"
  }
  function open(item, opts = {}) {
    if (!item) return
    ensureVisible(item)
    openItem = item
    els.forEach((el) => el.classList.remove("active"))
    els.get(item.id)?.classList.add("active")
    $$(".item").forEach((b) => b.classList.toggle("active", b.dataset.id === item.id))
    card.innerHTML = cardHtml(item)
    card.hidden = false
    const z = item.kind === "district" ? 2.2 : 3
    if (opts.fly !== false) flyTo(item.x, item.y, Math.max(st.s, z), () => placeCard())
    requestAnimationFrame(placeCard)
    // картинка и описание из статьи
    const showImg = item.kind === "person" || item.pageImage
    if (item.page) {
      ready.then(() => {
        if (openItem !== item) return
        // ссылка могла появиться после загрузки индекса
        const actions = card.querySelector(".card-actions")
        if (actions && !actions.querySelector("a") && hrefOf(item)) actions.insertAdjacentHTML("beforeend", `<a class="btn" href="${esc(hrefOf(item))}">Читать в базе</a>`)
        if (item.kind !== "person" && item.text && hrefOf(item) && !card.querySelector(".card-body > p")) card.querySelector("h3").insertAdjacentHTML("afterend", `<p>${esc(item.text)}</p>`)
        pageInfo(item.page).then((info) => {
          if (openItem !== item || !info) return
          if (showImg && info.img) {
            card.querySelector("[data-media]").innerHTML = `<img class="card-img${item.kind === "person" ? " portrait" : ""}" src="${esc(info.img)}" alt="">`
            card.querySelector(".card-img").addEventListener("load", placeCard, { once: true })
          }
          const d = card.querySelector("[data-desc]")
          if (d && info.desc) d.textContent = info.desc
          placeCard()
        })
      })
    }
    if (location.hash !== "#" + encodeURIComponent(item.kind === "place" ? item.n : item.name)) history.replaceState(null, "", "#" + encodeURIComponent(item.kind === "place" ? item.n : item.name))
  }
  function closeCard() {
    openItem = null
    card.hidden = true
    els.forEach((el) => el.classList.remove("active"))
    $$(".item.active").forEach((b) => b.classList.remove("active"))
    history.replaceState(null, "", location.pathname + location.search)
  }
  card.addEventListener("pointerdown", (e) => e.stopPropagation())
  card.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true })
  card.addEventListener("click", (e) => {
    if (e.target.closest(".card-close")) return closeCard()
    const go = e.target.closest("[data-go]")
    if (go) return open(byId.get(go.dataset.go))
    const r = e.target.closest("[data-route]")
    if (r) routeTo(byId.get(r.dataset.route))
  })

  // ---------------- меню мест ----------------
  const list = $("#list")
  function renderList(q = "") {
    const nq = norm(q)
    const match = (s) => !nq || norm(s).includes(nq)
    const blocks = []
    const pp = people.filter((c) => match(c.name) || c.at.some((a) => match(a.item.name)))
    if (pp.length)
      blocks.push(`<h3 class="group-title" data-layer="people" style="--c:#e8c766"><i style="border-radius:50%"></i>Персонажи</h3>` +
        pp.map((c) => `<button type="button" class="item" data-id="${c.id}"><span class="badge round" style="--c:${c.hero ? "#e8c766" : "#9fb3cc"}" data-face="${c.id}">${portraits.get(c.id) ? `<img src="${esc(portraits.get(c.id))}" alt="">` : esc((c.short ?? c.name)[0])}</span><span><b>${esc(c.name)}</b><small>${esc(c.at[0].item.name)}</small></span></button>`).join(""))
    const dd = districts.filter((d) => match(d.name))
    if (dd.length)
      blocks.push(`<h3 class="group-title" data-layer="districts" style="--c:#fff3c4"><i></i>Районы</h3>` +
        dd.map((d) => `<button type="button" class="item${d.page ? "" : " nopage"}" data-id="${esc(d.id)}"><span class="badge dist">◆</span><span><b>${esc(d.name)}</b></span></button>`).join(""))
    for (const L of D.layers) {
      const ps = places.filter((p) => p.layer === L.id && (match(p.name) || match(String(p.n))))
      if (!ps.length) continue
      blocks.push(`<h3 class="group-title" data-layer="${L.id}" style="--c:${L.color}"><i></i>${esc(L.name)}</h3>` +
        ps.map((p) => `<button type="button" class="item${p.page ? "" : " nopage"}" data-id="${p.id}"><span class="badge" style="--c:${L.color}">${p.n}</span><span><b>${esc(p.name)}</b></span></button>`).join(""))
    }
    list.innerHTML = blocks.join("") || `<p class="empty">Ничего не найдено</p>`
    $$(".group-title[data-layer]").forEach((g) => g.classList.toggle("off", hidden.has(g.dataset.layer)))
    if (openItem) $$(".item").forEach((b) => b.classList.toggle("active", b.dataset.id === openItem.id))
  }
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".item")
    if (!b) return
    open(byId.get(b.dataset.id))
    if (narrow()) setDrawer("left", false)
  })
  $("#search").addEventListener("input", (e) => renderList(e.target.value))
  $("#search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") list.querySelector(".item")?.click()
  })

  // ---------------- боковые меню ----------------
  function setDrawer(side, show) {
    const el = $("#" + side)
    if (show && narrow()) setDrawer(side === "left" ? "right" : "left", false)
    el.hidden = !show
    $(`[data-open="${side}"]`).setAttribute("aria-expanded", String(show))
    store.set("arx-drawers", { left: !$("#left").hidden, right: !$("#right").hidden })
    if (show && side === "left") setTimeout(() => !narrow() && $("#search").focus({ preventScroll: true }), 50)
    placeCard()
  }
  $$("[data-open]").forEach((b) => b.addEventListener("click", () => setDrawer(b.dataset.open, $("#" + b.dataset.open).hidden)))
  $$("[data-close]").forEach((b) => b.addEventListener("click", () => setDrawer(b.dataset.close, false)))

  // ---------------- маршрут ----------------
  // roads.png: 0 — непроходимо (река, ущелья, горы), 1 — главные дороги и мосты, 6 — улицы, 8 — поля, 40 — застройка
  let grid = null, GW = 0, GH = 0
  const gridReady = new Promise((res) => {
    const im = new Image()
    im.onload = () => {
      GW = im.naturalWidth
      GH = im.naturalHeight
      const c = document.createElement("canvas")
      c.width = GW
      c.height = GH
      const ctx = c.getContext("2d", { willReadFrequently: true })
      ctx.drawImage(im, 0, 0)
      const px = ctx.getImageData(0, 0, GW, GH).data
      grid = new Uint8Array(GW * GH)
      for (let i = 0; i < grid.length; i++) grid[i] = px[i * 4]
      res()
    }
    im.onerror = () => res()
    im.src = "roads.png"
  })
  function snap(x, y) {
    const gx = clamp(Math.round((x / 100) * GW), 0, GW - 1)
    const gy = clamp(Math.round((y / 100) * GH), 0, GH - 1)
    for (let r = 0; r < 80; r++) {
      let best = -1, bd = 1e9
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const X = gx + dx, Y = gy + dy
          if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue
          const c = grid[Y * GW + X]
          if (c > 0 && c < 40) {
            const d = dx * dx + dy * dy
            if (d < bd) { bd = d; best = Y * GW + X }
          }
        }
      if (best >= 0) return best
    }
    return gy * GW + gx
  }
  function astar(s, t) {
    const N = GW * GH
    const g = new Float32Array(N).fill(Infinity)
    const prev = new Int32Array(N).fill(-1)
    const closed = new Uint8Array(N)
    const hn = [], hf = []
    const push = (n, f) => {
      hn.push(n); hf.push(f)
      let i = hn.length - 1
      while (i > 0) {
        const p = (i - 1) >> 1
        if (hf[p] <= hf[i]) break
        ;[hn[p], hn[i]] = [hn[i], hn[p]]
        ;[hf[p], hf[i]] = [hf[i], hf[p]]
        i = p
      }
    }
    const pop = () => {
      const top = hn[0]
      const ln = hn.pop(), lf = hf.pop()
      if (hn.length) {
        hn[0] = ln; hf[0] = lf
        let i = 0
        for (;;) {
          const l = 2 * i + 1, r = l + 1
          let m = i
          if (l < hn.length && hf[l] < hf[m]) m = l
          if (r < hn.length && hf[r] < hf[m]) m = r
          if (m === i) break
          ;[hn[m], hn[i]] = [hn[i], hn[m]]
          ;[hf[m], hf[i]] = [hf[i], hf[m]]
          i = m
        }
      }
      return top
    }
    const tx = t % GW, ty = (t / GW) | 0
    const h = (n) => {
      const dx = Math.abs((n % GW) - tx), dy = Math.abs(((n / GW) | 0) - ty)
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy)
    }
    g[s] = 0
    push(s, h(s))
    const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]
    while (hn.length) {
      const u = pop()
      if (closed[u]) continue
      closed[u] = 1
      if (u === t) break
      const ux = u % GW, uy = (u / GW) | 0
      for (const [dx, dy, m] of D8) {
        const X = ux + dx, Y = uy + dy
        if (X < 0 || Y < 0 || X >= GW || Y >= GH) continue
        const v = Y * GW + X
        const c = grid[v]
        if (!c || closed[v]) continue
        const ng = g[u] + m * c
        if (ng < g[v]) {
          g[v] = ng
          prev[v] = u
          push(v, ng + h(v))
        }
      }
    }
    if (prev[t] < 0 && s !== t) return null
    const path = []
    for (let u = t; u !== -1; u = prev[u]) path.push(u)
    return path.reverse().map((u) => [u % GW, (u / GW) | 0])
  }
  // упрощение линии (Рамер — Дуглас — Пекер)
  function simplify(pts, eps) {
    if (pts.length < 3) return pts
    let dmax = 0, idx = 0
    const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1]
    const L = Math.hypot(bx - ax, by - ay) || 1
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / L
      if (d > dmax) { dmax = d; idx = i }
    }
    if (dmax <= eps) return [pts[0], pts[pts.length - 1]]
    return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)]
  }

  const fromSel = $("#fromSel")
  const toSel = $("#toSel")
  const result = $("#routeResult")
  let pickedPoint = null
  function optionsHtml(withPoint) {
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`
    return (
      `<option value="">— выберите —</option>` +
      (withPoint ? `<option value="pt" ${pickedPoint ? "" : "disabled"}>Точка на карте</option>` : "") +
      `<optgroup label="Персонажи">${people.map((c) => opt(c.id, c.name)).join("")}</optgroup>` +
      `<optgroup label="Районы">${districts.map((d) => opt(d.id, d.name)).join("")}</optgroup>` +
      D.layers.map((L) => `<optgroup label="${esc(L.name)}">${places.filter((p) => p.layer === L.id).map((p) => opt(p.id, `${p.n}. ${p.name}`)).join("")}</optgroup>`).join("")
    )
  }
  function fillSelects() {
    const f = fromSel.value, t = toSel.value
    fromSel.innerHTML = optionsHtml(true)
    toSel.innerHTML = optionsHtml(false)
    fromSel.value = f
    toSel.value = t
  }
  const pointOf = (v) => {
    if (v === "pt") return pickedPoint
    const it = byId.get(v)
    return it ? { x: it.x, y: it.y, item: it } : null
  }
  const ends = { from: null, to: null }
  function endPin(kind, p) {
    ends[kind]?.remove()
    ends[kind] = null
    if (!p) return
    const el = document.createElement("span")
    el.className = "end-pin " + kind
    el.style.left = p.x + "%"
    el.style.top = p.y + "%"
    pinsEl.appendChild(el)
    ends[kind] = el
  }
  function clearRoute() {
    routeSvg.innerHTML = ""
    result.innerHTML = ""
    endPin("from", null)
    endPin("to", null)
    $$(".pin.on-route").forEach((p) => p.classList.remove("on-route"))
    $("#clearBtn").hidden = true
  }
  async function buildRoute() {
    const a = pointOf(fromSel.value)
    const b = pointOf(toSel.value)
    if (!a || !b) {
      result.innerHTML = `<p class="route-note">Выберите, откуда и куда идти.</p>`
      return
    }
    result.innerHTML = `<p class="route-note">Прокладываю маршрут…</p>`
    await gridReady
    if (!grid) {
      result.innerHTML = `<p class="route-note">Не удалось загрузить сетку улиц (roads.png).</p>`
      return
    }
    await new Promise((r) => setTimeout(r, 16))
    const path = astar(snap(a.x, a.y), snap(b.x, b.y))
    if (!path) {
      result.innerHTML = `<p class="route-note">Между этими точками нет прохода.</p>`
      return
    }
    const simp = simplify(path, 0.9).map(([gx, gy]) => [((gx + 0.5) / GW) * 100, ((gy + 0.5) / GH) * 100])
    const pts = [[a.x, a.y], ...simp, [b.x, b.y]]
    const attr = pts.map(([x, y]) => `${x.toFixed(3)},${(y / 100 * VBH).toFixed(3)}`).join(" ")
    routeSvg.innerHTML = `<polyline class="route-under" points="${attr}"/><polyline class="route-line" points="${attr}"/>`
    endPin("from", a)
    endPin("to", b)
    // что встречается по пути: места рядом с линией, по порядку
    const along = []
    // начало и конец пути (для персонажа — его место) в списке «по пути» не повторяем
    const skip = new Set([a.item, b.item, a.item?.at?.[0]?.item, b.item?.at?.[0]?.item].filter(Boolean))
    const near = 1.15
    for (const p of places) {
      if (skip.has(p)) continue
      let bi = -1, bd = 1e9
      for (let i = 0; i < path.length; i += 2) {
        const x = ((path[i][0] + 0.5) / GW) * 100, y = ((path[i][1] + 0.5) / GH) * 100
        const d = Math.hypot(x - p.x, (y - p.y) * 1.5)
        if (d < bd) { bd = d; bi = i }
      }
      if (bd < near) along.push({ p, i: bi })
    }
    along.sort((u, v) => u.i - v.i)
    $$(".pin.on-route").forEach((p) => p.classList.remove("on-route"))
    along.forEach(({ p }) => els.get(p.id)?.classList.add("on-route"))
    const nameOf = (pt, sel) => (pt.item ? (pt.item.kind === "place" ? `${pt.item.n}. ${pt.item.name}` : pt.item.name) : sel.options[sel.selectedIndex]?.text ?? "Точка на карте")
    const bridges = along.filter(({ p }) => p.layer === "cross").map(({ p }) => p.name)
    result.innerHTML = `
      <p class="route-sum">От <b>${esc(nameOf(a, fromSel))}</b> до <b>${esc(nameOf(b, toSel))}</b>${bridges.length ? `<br><span class="muted">через ${esc(bridges.join(", "))}</span>` : ""}</p>
      <ol class="route-steps">
        <li><button type="button" data-step-from><span class="dot from"></span><span>${esc(nameOf(a, fromSel))}</span></button></li>
        ${along.map(({ p }) => `<li><button type="button" data-go="${p.id}"><span class="dot">${p.n}</span><span>${esc(p.name)}<br><small>по пути</small></span></button></li>`).join("")}
        <li><button type="button" data-step-to><span class="dot to"></span><span>${esc(nameOf(b, toSel))}</span></button></li>
      </ol>
      <p class="route-note">Маршрут идёт по главным улицам; реку и ущелья пересекает только по мостам.</p>`
    $("#clearBtn").hidden = false
    // на телефоне меню закрывает карту — сворачиваем его, чтобы был виден путь
    if (narrow()) {
      setDrawer("right", false)
      say("Маршрут проложен · подробности — в меню «Маршрут»", 3500)
    }
    fitPoints(pts.map(([x, y]) => ({ x, y })), 3.2, 3)
  }
  result.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]")
    if (go) return open(byId.get(go.dataset.go))
    const f = e.target.closest("[data-step-from]")
    const t = e.target.closest("[data-step-to]")
    const p = f ? pointOf(fromSel.value) : t ? pointOf(toSel.value) : null
    if (p) p.item ? open(p.item) : flyTo(p.x, p.y, Math.max(st.s, 3))
  })
  function routeTo(item) {
    if (!item) return
    toSel.value = item.id
    setDrawer("right", true)
    closeCard()
    if (fromSel.value) buildRoute()
    else {
      result.innerHTML = `<p class="route-note">Выберите, откуда идти, или укажите точку на карте.</p>`
      fromSel.focus()
    }
  }
  $("#goBtn").addEventListener("click", buildRoute)
  $("#clearBtn").addEventListener("click", clearRoute)
  $("#swapBtn").addEventListener("click", () => {
    if (fromSel.value === "pt") return say("Точку на карте можно указать только как начало пути", 2500)
    const f = fromSel.value
    fromSel.value = toSel.value
    toSel.value = f
    if (fromSel.value && toSel.value) buildRoute()
  })
  ;[fromSel, toSel].forEach((s) => s.addEventListener("change", () => fromSel.value && toSel.value && buildRoute()))
  let picking = false
  const pickBtn = $("#pickBtn")
  function setPicking(v) {
    picking = v
    pickBtn.setAttribute("aria-pressed", String(v))
    stage.classList.toggle("picking", v)
    say(v ? "Нажмите на карту, откуда начать путь" : "")
    if (v && narrow()) setDrawer("right", false)
  }
  pickBtn.addEventListener("click", () => setPicking(!picking))

  // ---------------- подсказки, координаты ----------------
  let hintT = 0
  function say(text, ms) {
    hint.textContent = text
    hint.hidden = !text
    clearTimeout(hintT)
    if (ms) hintT = setTimeout(() => (hint.hidden = true), ms)
  }
  let coordsMode = false
  const coordsBtn = $('[data-act="coords"]')

  // ---------------- мышь, тач, клавиатура ----------------
  const pointers = new Map()
  let drag = null, pinch = null
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".card")) return
    stage.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    cancelAnimationFrame(flyRaf)
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, tx: st.tx, ty: st.ty, moved: false, target: e.target }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: st.s }
      drag = null
    }
  })
  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      const r = stage.getBoundingClientRect()
      zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, (pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)) / st.s)
      return
    }
    if (!drag) return
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) > 5) {
      drag.moved = true
      stage.classList.add("dragging")
    }
    if (drag.moved) {
      st.tx = drag.tx + dx
      st.ty = drag.ty + dy
      apply()
    }
  })
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
    if (!drag) return
    const d = drag
    drag = null
    stage.classList.remove("dragging")
    if (d.moved || e.type === "pointercancel") return
    const p = toPct(e.clientX, e.clientY)
    if (picking) {
      pickedPoint = { x: p.x, y: p.y }
      fillSelects()
      fromSel.value = "pt"
      endPin("from", pickedPoint)
      setPicking(false)
      setDrawer("right", true)
      if (toSel.value) buildRoute()
      return
    }
    if (coordsMode) {
      const text = `x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)}`
      navigator.clipboard?.writeText(text).then(() => say(text + " — скопировано", 3500), () => say(text, 6000))
      if (!navigator.clipboard) say(text, 6000)
      return
    }
    const hit = d.target.closest?.(".pin, .person, .district")
    if (hit) return open(byId.get(hit.dataset.id))
    if (!layersPop.hidden) {
      layersPop.hidden = true
      layersBtn.setAttribute("aria-expanded", "false")
    }
    if (openItem) closeCard()
  }
  stage.addEventListener("pointerup", end)
  stage.addEventListener("pointercancel", end)
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault()
      const r = stage.getBoundingClientRect()
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-clamp(delta, -120, 120) * 0.0022))
    },
    { passive: false },
  )
  stage.addEventListener("dblclick", (e) => {
    if (e.target.closest(".pin, .person, .district, .card")) return
    const r = stage.getBoundingClientRect()
    zoomAt(e.clientX - r.left, e.clientY - r.top, 2)
  })
  stage.addEventListener("keydown", (e) => {
    const k = e.key
    if (e.target.closest(".card")) return
    if (k === "+" || k === "=") zoomAt(st.sw / 2, st.sh / 2, 1.4)
    else if (k === "-" || k === "_") zoomAt(st.sw / 2, st.sh / 2, 1 / 1.4)
    else if (k.startsWith("Arrow") && e.target === stage) {
      st.tx += k === "ArrowLeft" ? 90 : k === "ArrowRight" ? -90 : 0
      st.ty += k === "ArrowUp" ? 90 : k === "ArrowDown" ? -90 : 0
      apply()
    } else if ((k === "Enter" || k === " ") && e.target.closest(".pin, .person, .district")) {
      open(byId.get(e.target.closest("[data-id]").dataset.id))
    } else return
    e.preventDefault()
  })
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return
    if (picking) return setPicking(false)
    if (!layersPop.hidden) return layersBtn.click()
    if (openItem) return closeCard()
    if (!$("#right").hidden) return setDrawer("right", false)
    if (!$("#left").hidden) return setDrawer("left", false)
  })
  document.addEventListener("click", (e) => {
    if (!layersPop.hidden && !e.target.closest(".layers-wrap")) {
      layersPop.hidden = true
      layersBtn.setAttribute("aria-expanded", "false")
    }
  })
  $$(".controls [data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = b.dataset.act
      if (a === "in") zoomAt(st.sw / 2, st.sh / 2, 1.5)
      if (a === "out") zoomAt(st.sw / 2, st.sh / 2, 1 / 1.5)
      if (a === "fit") flyTo(50, 50, 1)
      if (a === "coords") {
        coordsMode = !coordsMode
        b.setAttribute("aria-pressed", String(coordsMode))
        stage.classList.toggle("picking", coordsMode)
        say(coordsMode ? "Нажмите на карту — координаты скопируются" : "", coordsMode ? 0 : 1)
      }
    }),
  )

  // ---------------- тема ----------------
  $("#themeBtn").addEventListener("click", () => {
    const t = document.documentElement.dataset.theme === "light" ? "dark" : "light"
    document.documentElement.dataset.theme = t
    try { localStorage.setItem("theme", t) } catch {}
  })

  // ---------------- старт ----------------
  $("#title").textContent = D.title ?? "Аркс-Феррум"
  $("#subtitle").textContent = D.subtitle ?? ""
  ready.then(() => {
    const href = slugOf(D.cityPage) ? BASE + slugOf(D.cityPage) : BASE
    $("#backLink").href = href
    if (openItem) open(openItem, { fly: false })
  })
  $("#backLink").href = BASE
  renderList()
  fillSelects()
  applyLayers()
  const saved = store.get("arx-drawers", { left: false, right: false })
  if (!narrow()) {
    if (saved.left) setDrawer("left", true)
    if (saved.right) setDrawer("right", true)
  }
  new ResizeObserver(() => layout(true)).observe(stage)
  layout(false)
  // ссылка вида …/static/arx/#13 или #Ступени открывает место
  const h = decodeURIComponent(location.hash.slice(1))
  if (h) {
    const it = /^\d+$/.test(h) ? placeByN.get(+h) : [...districts, ...people, ...places].find((i) => norm(i.name) === norm(h) || norm(i.short) === norm(h))
    if (it) setTimeout(() => open(it), 200)
  }
})()
