// Карта Аволара: карта с метками, карточка места по клику, переключатели значков под картой.
// Quartz работает как SPA — всё запускается на событие "nav" и снимается через addCleanup.
;(function () {
  if (window.__atlLoaded3) return
  window.__atlLoaded3 = true

  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
  const norm = (s) => String(s ?? "").toLowerCase().replace(/ё/g, "е").trim()
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const STORE = "avolar-atlas-toggles"
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || "{}")
    } catch {
      return {}
    }
  }
  const save = (v) => {
    try {
      localStorage.setItem(STORE, JSON.stringify(v))
    } catch {}
  }

  function init() {
    const root = document.querySelector(".atl")
    if (!root || root.dataset.ready) return
    root.dataset.ready = "1"
    const D = JSON.parse(root.querySelector(".atl-data").textContent)

    const cleanups = []
    const on = (el, ev, fn, opts) => {
      if (!el) return
      el.addEventListener(ev, fn, opts)
      cleanups.push(() => el.removeEventListener(ev, fn, opts))
    }
    let flyRaf = 0
    let hintTimer = 0
    if (typeof window.addCleanup === "function")
      window.addCleanup(() => {
        cleanups.forEach((f) => f())
        cancelAnimationFrame(flyRaf)
        clearTimeout(hintTimer)
      })

    const $ = (sel) => root.querySelector(sel)
    const $$ = (sel) => [...root.querySelectorAll(sel)]
    const app = $(".atl-app")
    const stage = $(".atl-stage")
    const world = $(".atl-world")
    const img = $(".atl-img")
    const pinsEl = $(".atl-pins")
    const rulerG = $(".atl-ruler")
    const hint = $(".atl-hint")
    const card = $(".atl-card")
    const NS = "http://www.w3.org/2000/svg"
    const vy = (y) => (y / 100) * (100 / D.aspect)
    const items = [...D.places, ...D.sites]
    const byId = new Map(items.map((i) => [i.id, i]))
    const typeName = (t) => D.types[t] ?? t

    const st = { s: 1, tx: 0, ty: 0, fitW: 0, sw: 0, sh: 0, maxS: 6, open: null, tool: null, ruler: [] }

    // ================= камера =================
    function layout(keepCenter) {
      const r = stage.getBoundingClientRect()
      let cx, cy
      if (keepCenter && st.fitW) {
        cx = (st.sw / 2 - st.tx) / (st.fitW * st.s)
        cy = (st.sh / 2 - st.ty) / ((st.fitW / D.aspect) * st.s)
      }
      st.sw = r.width
      st.sh = r.height
      st.fitW = Math.min(st.sw, st.sh * D.aspect)
      st.maxS = Math.max(2, ((img.naturalWidth || 5000) / st.fitW) * 1.1)
      if (keepCenter && cx != null) {
        st.tx = st.sw / 2 - cx * st.fitW * st.s
        st.ty = st.sh / 2 - cy * (st.fitW / D.aspect) * st.s
      }
      apply()
    }
    function apply() {
      st.s = clamp(st.s, 1, st.maxS)
      const dw = st.fitW * st.s
      const dh = (st.fitW / D.aspect) * st.s
      st.tx = dw <= st.sw ? (st.sw - dw) / 2 : clamp(st.tx, st.sw - dw, 0)
      st.ty = dh <= st.sh ? (st.sh - dh) / 2 : clamp(st.ty, st.sh - dh, 0)
      // карта перерисовывается в настоящем размере (а не растягивается),
      // поэтому при приближении остаётся чёткой — исходник 5000×5000
      world.style.width = dw + "px"
      world.style.height = dh + "px"
      world.style.transform = `translate(${st.tx}px, ${st.ty}px)`
      // значки плавно растут вместе с картой, но не больше чем вдвое
      world.style.setProperty("--inv", Math.min(1 + (st.s - 1) * 0.3, 2).toFixed(3))
      root.classList.toggle("show-labels", st.s < 2.6)
      updateOverview()
      if (st.open) placeCard(st.open)
    }
    function zoomAt(px, py, factor) {
      const ns = clamp(st.s * factor, 1, st.maxS)
      st.tx = px - (px - st.tx) * (ns / st.s)
      st.ty = py - (py - st.ty) * (ns / st.s)
      st.s = ns
      apply()
    }
    function flyTo(x, y, s) {
      cancelAnimationFrame(flyRaf)
      const ts = clamp(s ?? st.s, 1, st.maxS)
      const target = { s: ts, tx: st.sw / 2 - (x / 100) * st.fitW * ts, ty: st.sh / 2 - (y / 100) * (st.fitW / D.aspect) * ts }
      if (reduceMotion()) {
        Object.assign(st, target)
        return apply()
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
      }
      flyRaf = requestAnimationFrame(step)
    }
    // в кадре вся Коалиция
    function startView(animate) {
      const xs = D.places.map((p) => p.x)
      const ys = D.places.map((p) => p.y)
      const pad = 6
      const x0 = Math.max(0, Math.min(...xs) - pad)
      const x1 = Math.min(100, Math.max(...xs) + pad)
      const y0 = Math.max(0, Math.min(...ys) - pad)
      const y1 = Math.min(100, Math.max(...ys) + pad)
      const fitH = st.fitW / D.aspect
      const s = clamp(Math.min(st.sw / (((x1 - x0) / 100) * st.fitW), st.sh / (((y1 - y0) / 100) * fitH)), 1, st.maxS)
      if (animate) return flyTo((x0 + x1) / 2, (y0 + y1) / 2, s)
      st.s = s
      st.tx = st.sw / 2 - ((x0 + x1) / 200) * st.fitW * s
      st.ty = st.sh / 2 - ((y0 + y1) / 200) * fitH * s
      apply()
    }
    const toPct = (cx, cy) => {
      const r = stage.getBoundingClientRect()
      return { x: ((cx - r.left - st.tx) / (st.fitW * st.s)) * 100, y: ((cy - r.top - st.ty) / ((st.fitW / D.aspect) * st.s)) * 100 }
    }

    // обзорная мини-карта
    const ovEl = $(".atl-overview")
    const ovView = $(".atl-overview-view")
    function updateOverview() {
      if (!st.fitW) return
      const W = st.fitW * st.s
      const H = (st.fitW / D.aspect) * st.s
      const x0 = clamp(-st.tx / W, 0, 1)
      const y0 = clamp(-st.ty / H, 0, 1)
      const x1 = clamp((st.sw - st.tx) / W, 0, 1)
      const y1 = clamp((st.sh - st.ty) / H, 0, 1)
      Object.assign(ovView.style, { left: x0 * 100 + "%", top: y0 * 100 + "%", width: (x1 - x0) * 100 + "%", height: (y1 - y0) * 100 + "%" })
      root.classList.toggle("is-zoomed", x1 - x0 < 0.6 || y1 - y0 < 0.6)
    }
    on(ovEl, "pointerdown", (e) => {
      e.stopPropagation()
      const r = ovEl.getBoundingClientRect()
      flyTo(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100, st.s)
    })

    // ================= метки =================
    const pinEls = new Map()
    for (const it of items) {
      const b = document.createElement("button")
      b.type = "button"
      b.dataset.id = it.id
      b.className = it.kind === "place" ? `atl-pin k-place t-${it.type}${it.lost ? " is-lost" : ""}` : "atl-pin k-site"
      b.setAttribute("aria-label", it.name)
      // подписи только у знаковых мест: названия городов уже есть на самой карте
      //if (it.kind === "site") b.innerHTML = `<span class="atl-pin-label">${esc(it.name)}</span>`
      b.style.left = it.x + "%"
      b.style.top = it.y + "%"
      pinsEl.appendChild(b)
      pinEls.set(it.id, b)
    }

    // ================= карточка места =================
    // наведение — краткое превью; клик — карточка со ссылкой, остаётся открытой
    function cardHtml(it, full) {
      const kind =
        it.kind === "place"
          ? `<i class="atl-sw atl-sw-${it.lost ? "lost" : esc(it.type)}"></i>${esc(it.lost ? typeName("lost") : typeName(it.type))}`
          : `<i class="atl-sw atl-sw-site"></i>Знаковое место`
      const link = it.href
        ? `<a class="internal atl-btn is-primary" href="${esc(it.href)}" data-slug="${esc(it.slug)}">${esc(it.kind === "site" && it.pageTitle && norm(it.pageTitle) !== norm(it.name) ? `Читать: ${it.pageTitle}` : "Читать статью")}</a>`
        : ""
      return `${full ? `<button type="button" class="atl-card-close" aria-label="Закрыть">×</button>` : ""}
        ${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : ""}
        <div class="atl-card-body"><span class="atl-card-kind">${kind}</span><b>${esc(it.name)}</b>
          ${it.note ? `<p>${esc(it.note)}</p>` : ""}
          ${full && it.desc ? `<p class="atl-card-desc">${esc(it.desc)}</p>` : ""}
          ${full ? `<div class="atl-actions">${link}</div>` : `<span class="atl-card-hint">Нажмите, чтобы открыть</span>`}
        </div>`
    }
    function placeCard(it) {
      const pin = pinEls.get(it.id)
      if (!pin || card.hidden) return
      const sr = stage.getBoundingClientRect()
      const pr = pin.getBoundingClientRect()
      const cw = card.offsetWidth
      const ch = card.offsetHeight
      let x = pr.left - sr.left + pr.width / 2 - cw / 2
      let y = pr.top - sr.top - ch - 12
      if (y < 8) y = pr.bottom - sr.top + 12
      card.style.left = clamp(x, 8, Math.max(8, st.sw - cw - 54)) + "px"
      card.style.top = clamp(y, 8, Math.max(8, st.sh - ch - 8)) + "px"
    }
    function showPreview(pin) {
      if (st.open || drag) return
      const it = byId.get(pin.dataset.id)
      card.classList.remove("is-open")
      card.innerHTML = cardHtml(it, false)
      card.hidden = false
      placeCard(it)
    }
    function hidePreview() {
      if (!st.open) card.hidden = true
    }
    function openCard(it) {
      st.open = it
      pinEls.forEach((el) => el.classList.toggle("is-active", el.dataset.id === it.id))
      card.classList.add("is-open")
      card.innerHTML = cardHtml(it, true)
      card.hidden = false
      // место — по центру, чуть ниже, чтобы карточка поместилась сверху
      if (st.s < 2) flyTo(it.x, it.y - 6 / st.s, 2.2)
      else placeCard(it)
      const img2 = card.querySelector("img")
      if (img2 && !img2.complete) img2.addEventListener("load", () => placeCard(it), { once: true })
      requestAnimationFrame(() => placeCard(it))
    }
    function closeCard() {
      st.open = null
      card.hidden = true
      card.classList.remove("is-open")
      pinEls.forEach((el) => el.classList.remove("is-active"))
    }
    on(card, "pointerdown", (e) => e.stopPropagation())
    on(card, "click", (e) => {
      if (e.target.closest(".atl-card-close")) closeCard()
    })
    on(pinsEl, "pointerover", (e) => {
      if (e.pointerType !== "mouse") return
      const pin = e.target.closest(".atl-pin")
      if (pin) showPreview(pin)
    })
    on(pinsEl, "pointerout", (e) => {
      const pin = e.target.closest(".atl-pin")
      if (pin && !pin.contains(e.relatedTarget)) hidePreview()
    })

    // ================= переключатели под картой =================
    const prefs = load()
    const toggles = $$(".atl-toggle")
    const allBtn = $(".atl-toggle-all")
    function applyToggles() {
      for (const b of toggles) {
        const k = b.dataset.toggle
        const shown = prefs[k] !== false
        b.setAttribute("aria-pressed", String(shown))
        root.classList.toggle("hide-" + k, !shown)
      }
      const iconKeys = toggles.map((b) => b.dataset.toggle).filter((k) => k.startsWith("t-") || k === "sites")
      const anyIcon = iconKeys.some((k) => prefs[k] !== false)
      allBtn.dataset.all = anyIcon ? "off" : "on"
      allBtn.textContent = anyIcon ? "Скрыть все значки" : "Показать все значки"
      if (st.open && pinEls.get(st.open.id).offsetParent === null) closeCard()
    }
    toggles.forEach((b) =>
      on(b, "click", () => {
        const k = b.dataset.toggle
        prefs[k] = prefs[k] === false
        save(prefs)
        applyToggles()
      }),
    )
    on(allBtn, "click", () => {
      const show = allBtn.dataset.all === "on"
      for (const b of toggles) {
        const k = b.dataset.toggle
        if (k.startsWith("t-") || k === "sites") prefs[k] = show
      }
      save(prefs)
      applyToggles()
    })
    applyToggles()

    // ================= легенда и инструменты =================
    const legendBtn = $(".atl-legend-toggle")
    const legendList = $(".atl-legend-list")
    on(legendBtn, "pointerdown", (e) => e.stopPropagation())
    on(legendList, "pointerdown", (e) => e.stopPropagation())
    on(legendBtn, "click", (e) => {
      e.stopPropagation()
      const open = legendList.hidden
      legendList.hidden = !open
      legendBtn.setAttribute("aria-expanded", String(open))
    })
    const say = (text, ms) => {
      hint.textContent = text
      hint.hidden = !text
      clearTimeout(hintTimer)
      if (ms) hintTimer = setTimeout(() => (hint.hidden = true), ms)
    }
    function setTool(t) {
      st.tool = st.tool === t ? null : t
      $$('[data-act="ruler"],[data-act="coords"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.act === st.tool)))
      stage.classList.toggle("is-tool", !!st.tool)
      st.ruler = []
      rulerG.innerHTML = ""
      if (st.tool === "ruler") say("Линейка: нажимайте на точки маршрута. Esc — сбросить.")
      else if (st.tool === "coords") say("Нажмите на карту — координаты скопируются.")
      else say("")
    }
    function rulerClick(p) {
      st.ruler.push(p)
      rulerG.innerHTML = ""
      const line = document.createElementNS(NS, "polyline")
      line.setAttribute("class", "atl-ruler-line")
      line.setAttribute("points", st.ruler.map((q) => `${q.x},${vy(q.y)}`).join(" "))
      rulerG.appendChild(line)
      const W = D.kmPerMapWidth
      let km = 0
      for (let i = 1; i < st.ruler.length; i++) {
        const a = st.ruler[i - 1]
        const b = st.ruler[i]
        km += Math.hypot(((b.x - a.x) / 100) * W, ((b.y - a.y) / 100) * (W / D.aspect))
      }
      const days = D.kmPerDay ? ` · около ${Math.max(1, Math.round(km / D.kmPerDay))} дн. пути` : ""
      say(st.ruler.length < 2 ? "Нажмите следующую точку" : `${Math.round(km).toLocaleString("ru-RU")} км${days}`)
    }
    function coordsClick(p) {
      const text = `x: ${p.x.toFixed(2)}, y: ${p.y.toFixed(2)}`
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => say(text + " — скопировано", 4000), () => say(text, 6000))
      else say(text, 6000)
    }
    $$(".atl-controls [data-act]").forEach((b) =>
      on(b, "click", (e) => {
        e.stopPropagation()
        const act = b.dataset.act
        if (act === "in") zoomAt(st.sw / 2, st.sh / 2, 1.5)
        if (act === "out") zoomAt(st.sw / 2, st.sh / 2, 1 / 1.5)
        if (act === "reset") {
          closeCard()
          startView(true)
        }
        if (act === "full") {
          if (document.fullscreenElement) document.exitFullscreen()
          else if (app.requestFullscreen) app.requestFullscreen().catch(() => app.classList.toggle("is-full"))
          else app.classList.toggle("is-full")
        }
        if (act === "ruler" || act === "coords") setTool(act)
      }),
    )

    // ================= мышь, тач, клавиатура =================
    const pointers = new Map()
    let drag = null
    let pinch = null
    on(stage, "pointerdown", (e) => {
      if (e.target.closest(".atl-controls, .atl-legend, .atl-overview, .atl-card")) return
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
    on(stage, "pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const r = stage.getBoundingClientRect()
        zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, (pinch.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)) / st.s)
        return
      }
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) > 5) {
        drag.moved = true
        stage.classList.add("is-dragging")
        hidePreview()
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
      stage.classList.remove("is-dragging")
      if (d.moved || e.type === "pointercancel") return
      const p = toPct(e.clientX, e.clientY)
      if (st.tool === "ruler") return rulerClick(p)
      if (st.tool === "coords") return coordsClick(p)
      const pin = d.target.closest?.(".atl-pin")
      if (pin) return openCard(byId.get(pin.dataset.id))
      if (st.open) closeCard()
      if (!legendList.hidden) {
        legendList.hidden = true
        legendBtn.setAttribute("aria-expanded", "false")
      }
    }
    on(stage, "pointerup", end)
    on(stage, "pointercancel", end)
    on(
      stage,
      "wheel",
      (e) => {
        if (e.target.closest(".atl-card, .atl-legend")) return
        e.preventDefault()
        hidePreview()
        const r = stage.getBoundingClientRect()
        const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-clamp(delta, -120, 120) * 0.0022))
      },
      { passive: false },
    )
    on(stage, "dblclick", (e) => {
      if (e.target.closest(".atl-controls, .atl-pin, .atl-legend, .atl-overview, .atl-card")) return
      const r = stage.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, 2)
    })
    on(stage, "keydown", (e) => {
      if (e.target.closest(".atl-card, .atl-legend, .atl-controls")) {
        if (e.key === "Escape") closeCard()
        return
      }
      const k = e.key
      if (k === "+" || k === "=") zoomAt(st.sw / 2, st.sh / 2, 1.4)
      else if (k === "-" || k === "_") zoomAt(st.sw / 2, st.sh / 2, 1 / 1.4)
      else if (k.startsWith("Arrow") && e.target === stage) {
        st.tx += k === "ArrowLeft" ? 80 : k === "ArrowRight" ? -80 : 0
        st.ty += k === "ArrowUp" ? 80 : k === "ArrowDown" ? -80 : 0
        apply()
      } else if (k === "Escape") {
        if (st.tool) setTool(st.tool)
        else closeCard()
      } else if ((k === "Enter" || k === " ") && e.target.closest(".atl-pin")) {
        openCard(byId.get(e.target.closest(".atl-pin").dataset.id))
      } else return
      e.preventDefault()
    })

    // ================= размеры и старт =================
    const ro = new ResizeObserver(() => layout(true))
    ro.observe(stage)
    cleanups.push(() => ro.disconnect())
    on(document, "fullscreenchange", () => setTimeout(() => layout(true), 60))
    layout(false)
    startView(false)
    if (!img.complete) on(img, "load", () => layout(true))

    // ссылка вида карта#Зирк открывает карточку места
    const hash = norm(decodeURIComponent(location.hash.slice(1)))
    const target = hash && items.find((i) => norm(i.name) === hash)
    if (target) setTimeout(() => openCard(target), 300)
  }

  document.addEventListener("nav", init)
  if (document.readyState !== "loading") init()
  else document.addEventListener("DOMContentLoaded", init)
})()
