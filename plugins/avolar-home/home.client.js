// Клиентская часть новой главной Аволара.
// Quartz работает как SPA: всё вешается на событие "nav" и снимается через addCleanup.
;(function () {
  if (window.__avhLoaded) return
  window.__avhLoaded = true

  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const cleanup = (fn) => (typeof window.addCleanup === "function" ? window.addCleanup(fn) : null)
  const on = (el, ev, fn, opts) => {
    el.addEventListener(ev, fn, opts)
    cleanup(() => el.removeEventListener(ev, fn, opts))
  }
  const basePath = () => document.body.dataset.basepath || ""
  const goTo = (slug) => {
    const href = slug === "index" ? "./" : slug.endsWith("/index") ? slug.slice(0, -5) : slug
    const url = new URL(basePath() + "/" + href, location.origin)
    if (typeof window.spaNavigate === "function") window.spaNavigate(url)
    else location.href = url.toString()
  }
  const loadIndex = () =>
    window.fetchData ||
    (window.fetchData = fetch(basePath() + "/static/contentIndex.json").then((r) => r.json()))

  // ================= 1. Карточки пути =================
  function initCards(root) {
    root.querySelectorAll(".avh-card").forEach((card) => {
      const front = card.querySelector(".avh-card-inner")
      const back = card.querySelector(".avh-card-back")
      const close = card.querySelector(".avh-card-close")
      const setOpen = (open, focus) => {
        card.classList.toggle("is-open", open)
        front.setAttribute("aria-expanded", String(open))
        back.setAttribute("aria-hidden", String(!open))
        back.inert = !open
        front.inert = open
        if (focus) (open ? back.querySelector("a, button") : front)?.focus({ preventScroll: true })
      }
      setOpen(false)
      on(front, "click", () => setOpen(true, true))
      on(close, "click", () => setOpen(false, true))
      on(back, "keydown", (e) => {
        if (e.key === "Escape") setOpen(false, true)
      })
    })
  }

  // ================= 2. Шкала Тьмы =================
  function initTimeline(root) {
    const panel = root.querySelector(".avh-tl-panel")
    const marks = [...root.querySelectorAll(".avh-tl-mark")]
    if (!panel || !marks.length) return
    const show = (mark, animate) => {
      marks.forEach((m) => m.setAttribute("aria-pressed", String(m === mark)))
      const ev = mark.closest(".avh-tl-event")
      const tpl = ev.querySelector("template")
      const year = mark.querySelector(".avh-tl-year").textContent
      panel.innerHTML = `<span class="avh-tl-bigyear" aria-hidden="true">${year}</span>`
      panel.appendChild(tpl.content.cloneNode(true))
      panel.classList.toggle("is-red", ev.classList.contains("is-red"))
      if (animate && !reduceMotion()) {
        panel.classList.remove("is-swapping")
        void panel.offsetWidth
        panel.classList.add("is-swapping")
      }
    }
    const start = marks.find((m) => m.getAttribute("aria-pressed") === "true") || marks.at(-1)
    show(start, false)
    marks.forEach((m, i) => {
      on(m, "click", () => show(m, true))
      on(m, "keydown", (e) => {
        const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
        if (!dir) return
        e.preventDefault()
        const next = marks[(i + dir + marks.length) % marks.length]
        next.focus()
        show(next, true)
      })
    })
  }

  // ================= 3. Живые блоки =================
  function initLive(root) {
    // видео грузится только по нажатию
    root.querySelectorAll(".avh-video-facade").forEach((btn) => {
      on(btn, "click", () => {
        const iframe = document.createElement("iframe")
        iframe.src = `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(btn.dataset.list)}&autoplay=1&rel=0`
        iframe.title = "Последнее видео канала «Хроники Ходов»"
        iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"
        iframe.allowFullscreen = true
        btn.replaceWith(iframe)
      })
    })

    // таймер до игры
    const timer = root.querySelector(".avh-timer")
    if (timer) {
      const at = new Date(timer.dataset.at)
      const tick = () => {
        const ms = at - new Date()
        if (!(ms > 0)) {
          timer.hidden = true
          return
        }
        timer.hidden = false
        const m = Math.floor(ms / 60000)
        timer.querySelector('[data-u="d"]').textContent = Math.floor(m / 1440)
        timer.querySelector('[data-u="h"]').textContent = Math.floor((m % 1440) / 60)
        timer.querySelector('[data-u="m"]').textContent = m % 60
      }
      tick()
      const id = setInterval(tick, 30000)
      cleanup(() => clearInterval(id))
    }

    // случайная статья
    root.querySelectorAll(".avh-random").forEach((btn) => {
      on(btn, "click", async () => {
        const data = await loadIndex()
        const pool = Object.entries(data)
          .filter(([slug, v]) => !slug.startsWith("tags/") && slug !== "index" && (v.content || "").length > 200)
          .map(([slug]) => slug)
        if (pool.length) goTo(pool[Math.floor(Math.random() * pool.length)])
      })
    })
  }

  // ================= Карта мира =================
  function initMap(root) {
    const map = root.querySelector(".avh-map")
    if (!map) return
    const els = [...map.querySelectorAll("[data-key]")]
    const set = (key) => els.forEach((el) => el.classList.toggle("is-active", el.dataset.key === key))
    els.forEach((el) => {
      on(el, "mouseenter", () => set(el.dataset.key))
      on(el, "focus", () => set(el.dataset.key))
      on(el, "mouseleave", () => set(null))
      on(el, "blur", () => set(null))
    })
  }

  // ================= 4. Паутина мира (граф) =================
  const GROUPS = [
    { key: "Персонажи", test: (s) => s.includes("/персонажи/") || s.includes("/персонажи-игроков/"), color: "#D4AF37" },
    { key: "Локации", test: (s) => s.includes("/локации/"), color: "#4FA3A0" },
    { key: "Фракции", test: (s) => s.includes("/фракции/"), color: "#D9534F" },
    { key: "Технологии", test: (s) => s.includes("/технологии/"), color: "#D4893A" },
    { key: "История", test: (s) => s.includes("/история-и-события/"), color: "#C1121F" },
    { key: "Королевство Звёзд", test: (s) => s.includes("королевство-звёзд"), color: "#8E7FD6" },
    { key: "Кампания", test: (s) => s.startsWith("кампания-"), color: "#6F8FB3" },
    { key: "Остальное", test: () => true, color: "#8C8C8C" },
  ]

  function initGraph(root) {
    const stage = root.querySelector(".avh-web-stage")
    if (!stage) return
    const canvas = stage.querySelector("canvas")
    const label = stage.querySelector(".avh-web-label")
    const legend = stage.querySelector(".avh-web-legend")
    const ctx = canvas.getContext("2d")
    let alive = true
    cleanup(() => (alive = false))

    loadIndex().then((data) => {
      if (!alive) return
      const slugs = Object.keys(data).filter((s) => !s.startsWith("tags/"))
      const known = new Set(slugs)
      const resolve = (l) => (known.has(l) ? l : known.has(l + "/index") ? l + "/index" : null)
      const nodes = slugs.map((slug) => ({
        slug,
        title: data[slug].title || slug,
        group: GROUPS.findIndex((g) => g.test(slug)),
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        deg: 0,
      }))
      const bySlug = new Map(nodes.map((n) => [n.slug, n]))
      const linkSet = new Set()
      const links = []
      for (const n of nodes) {
        for (const raw of data[n.slug].links || []) {
          const t = resolve(raw)
          if (!t || t === n.slug) continue
          const key = [n.slug, t].sort().join("→")
          if (linkSet.has(key)) continue
          linkSet.add(key)
          const m = bySlug.get(t)
          links.push([n, m])
          n.deg++
          m.deg++
        }
      }
      // убираем пустые папки без связей
      const shown = nodes.filter((n) => n.deg > 0)
      shown.forEach((n, i) => {
        const a = (i / shown.length) * Math.PI * 2
        const r = 60 + (i % 7) * 18
        n.x = Math.cos(a) * r
        n.y = Math.sin(a) * r
      })
      const radius = (n) => 3 + Math.sqrt(n.deg) * 1.6
      // подписываем только самые связанные узлы (~8 штук)
      const degs = shown.map((n) => n.deg).sort((a, b) => b - a)
      const bigDegFor = (w) => degs[Math.min(w < 500 ? 3 : 7, degs.length - 1)] || 1

      // легенда
      const usedGroups = [...new Set(shown.map((n) => n.group))].sort((a, b) => a - b)
      let focusGroup = null
      legend.innerHTML = usedGroups
        .map(
          (g) =>
            `<li><button type="button" data-g="${g}" aria-pressed="false"><i style="--c:${GROUPS[g].color}"></i>${GROUPS[g].key}</button></li>`,
        )
        .join("")
      legend.querySelectorAll("button").forEach((b) =>
        on(b, "click", () => {
          const g = Number(b.dataset.g)
          focusGroup = focusGroup === g ? null : g
          legend
            .querySelectorAll("button")
            .forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.g) === focusGroup)))
          draw()
        }),
      )

      // размеры
      let W = 0,
        H = 0,
        dpr = 1,
        scale = 1
      const resize = () => {
        const r = stage.getBoundingClientRect()
        dpr = window.devicePixelRatio || 1
        W = r.width
        H = r.height
        canvas.width = W * dpr
        canvas.height = H * dpr
        draw()
      }
      // вписываем граф в рамку
      let cx = 0,
        cy = 0
      const fit = () => {
        let x0 = Infinity,
          x1 = -Infinity,
          y0 = Infinity,
          y1 = -Infinity
        for (const n of shown) {
          x0 = Math.min(x0, n.x)
          x1 = Math.max(x1, n.x)
          y0 = Math.min(y0, n.y)
          y1 = Math.max(y1, n.y)
        }
        const target = Math.min((W - 60) / (x1 - x0 || 1), (H - 110) / (y1 - y0 || 1), 2.2)
        const tx = (x0 + x1) / 2,
          ty = (y0 + y1) / 2
        // плавно, чтобы граф не дёргался
        scale = scale === 1 && !fit.done ? target : scale + (target - scale) * 0.15
        cx = fit.done ? cx + (tx - cx) * 0.15 : tx
        cy = fit.done ? cy + (ty - cy) * 0.15 : ty
        fit.done = true
      }
      const ro = new ResizeObserver(resize)
      ro.observe(stage)
      cleanup(() => ro.disconnect())

      // физика
      let dragged = null,
        downAt = null,
        moved = false
      let alpha = 1
      const step = () => {
        const k = alpha
        for (let i = 0; i < shown.length; i++) {
          const a = shown[i]
          for (let j = i + 1; j < shown.length; j++) {
            const b = shown[j]
            let dx = a.x - b.x,
              dy = a.y - b.y
            let d2 = dx * dx + dy * dy || 0.01
            if (d2 > 90000) continue
            const f = (1800 / d2) * k
            const d = Math.sqrt(d2)
            dx /= d
            dy /= d
            a.vx += dx * f
            a.vy += dy * f
            b.vx -= dx * f
            b.vy -= dy * f
          }
        }
        for (const [a, b] of links) {
          const dx = b.x - a.x,
            dy = b.y - a.y
          const d = Math.sqrt(dx * dx + dy * dy) || 1
          const f = (d - 60) * 0.02 * k
          a.vx += (dx / d) * f
          a.vy += (dy / d) * f
          b.vx -= (dx / d) * f
          b.vy -= (dy / d) * f
        }
        for (const n of shown) {
          n.vx -= n.x * 0.006 * k
          n.vy -= n.y * 0.006 * k
          if (n === dragged) continue
          n.vx *= 0.82
          n.vy *= 0.82
          n.x += n.vx
          n.y += n.vy
        }
        alpha *= 0.985
      }

      // отрисовка
      let hover = null
      const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
      function draw() {
        if (!W) return
        const lineColor = css("--gray") || "#6F8FB3"
        const textColor = css("--darkgray") || "#E4DCC8"
        const bigDeg = bigDegFor(W)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.clearRect(0, 0, W, H)
        if (!dragged) fit()
        ctx.translate(W / 2, H / 2 - 24)
        ctx.scale(scale, scale)
        ctx.translate(-cx, -cy)
        const neighbours = new Set()
        if (hover) {
          neighbours.add(hover)
          for (const [a, b] of links) {
            if (a === hover) neighbours.add(b)
            if (b === hover) neighbours.add(a)
          }
        }
        const dim = (n) =>
          (hover && !neighbours.has(n)) || (focusGroup !== null && n.group !== focusGroup && !neighbours.has(n))

        ctx.lineWidth = 0.8 / scale
        for (const [a, b] of links) {
          const lit = hover && (a === hover || b === hover)
          ctx.strokeStyle = lit ? GROUPS[hover.group].color : lineColor
          ctx.globalAlpha = lit ? 0.9 : dim(a) || dim(b) ? 0.06 : 0.28
          ctx.beginPath()
          ctx.moveTo(a.x, a.y)
          ctx.lineTo(b.x, b.y)
          ctx.stroke()
        }
        for (const n of shown) {
          ctx.globalAlpha = dim(n) ? 0.18 : 1
          ctx.fillStyle = GROUPS[n.group].color
          ctx.beginPath()
          ctx.arc(n.x, n.y, radius(n), 0, Math.PI * 2)
          ctx.fill()
          if (n === hover) {
            ctx.strokeStyle = textColor
            ctx.lineWidth = 1.5 / scale
            ctx.stroke()
            ctx.lineWidth = 0.8 / scale
          }
        }
        // подписи крупных узлов
        ctx.font = `${12 / scale}px ${css("--bodyFont") || "serif"}`
        ctx.textAlign = "center"
        ctx.fillStyle = textColor
        for (const n of shown) {
          const big = n.deg >= bigDeg
          if (!(big || (hover && neighbours.has(n) && n !== hover))) continue
          ctx.globalAlpha = dim(n) ? 0.15 : big ? 0.85 : 1
          ctx.fillText(n.title, n.x, n.y + radius(n) + 13 / scale)
        }
        ctx.globalAlpha = 1
      }

      let raf = 0
      const loop = () => {
        if (!alive) return
        step()
        draw()
        if (alpha > 0.02 || dragged) raf = requestAnimationFrame(loop)
        else raf = 0
      }
      const kick = (a = 0.5) => {
        alpha = Math.max(alpha, a)
        if (!raf) raf = requestAnimationFrame(loop)
      }
      cleanup(() => cancelAnimationFrame(raf))
      if (reduceMotion()) {
        for (let i = 0; i < 400; i++) step()
        alpha = 0
      }
      resize()
      if (!reduceMotion()) kick(1)

      // взаимодействие
      const toWorld = (e) => {
        const r = canvas.getBoundingClientRect()
        return {
          x: (e.clientX - r.left - W / 2) / scale + cx,
          y: (e.clientY - r.top - H / 2 + 24) / scale + cy,
          sx: e.clientX - r.left,
          sy: e.clientY - r.top,
        }
      }
      const pick = (p) => {
        let best = null,
          bd = Infinity
        for (const n of shown) {
          const d = Math.hypot(n.x - p.x, n.y - p.y)
          if (d < radius(n) + 6 / scale && d < bd) {
            best = n
            bd = d
          }
        }
        return best
      }
      on(canvas, "pointermove", (e) => {
        const p = toWorld(e)
        if (dragged) {
          if (Math.hypot(p.sx - downAt.sx, p.sy - downAt.sy) > 4) moved = true
          dragged.x = p.x
          dragged.y = p.y
          dragged.vx = dragged.vy = 0
          kick(0.3)
        }
        const n = dragged || pick(p)
        if (n !== hover) {
          hover = n
          canvas.classList.toggle("is-hover", !!n)
          if (!raf) draw()
        }
        if (n) {
          label.hidden = false
          label.textContent = n.title
          label.style.left = p.sx + "px"
          label.style.top = p.sy + "px"
        } else label.hidden = true
      })
      on(canvas, "pointerleave", () => {
        if (dragged) return
        hover = null
        label.hidden = true
        canvas.classList.remove("is-hover")
        if (!raf) draw()
      })
      on(canvas, "pointerdown", (e) => {
        const p = toWorld(e)
        const n = pick(p)
        if (!n) return
        dragged = n
        downAt = p
        moved = false
        canvas.setPointerCapture(e.pointerId)
      })
      on(canvas, "pointerup", (e) => {
        if (!dragged) return
        const n = dragged
        dragged = null
        canvas.releasePointerCapture(e.pointerId)
        if (!moved) goTo(n.slug)
        else kick(0.2)
      })
      on(document, "themechange", () => draw())
    })
  }

  // ================= 5. Фоновый звук (генерируется в браузере) =================
  function createAmbient() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ac = new AC()
    const master = ac.createGain()
    master.gain.value = 0
    master.connect(ac.destination)

    // гул плавилен: коричневый шум через фильтр
    const len = ac.sampleRate * 4
    const buf = ac.createBuffer(1, len, ac.sampleRate)
    const d = buf.getChannelData(0)
    let last = 0
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
      d[i] = last * 3.2
    }
    const noise = ac.createBufferSource()
    noise.buffer = buf
    noise.loop = true
    const low = ac.createBiquadFilter()
    low.type = "lowpass"
    low.frequency.value = 220
    const rumble = ac.createGain()
    rumble.gain.value = 0.55
    noise.connect(low).connect(rumble).connect(master)
    noise.start()

    // медленно дышащий низкий тон
    const drone = ac.createGain()
    drone.gain.value = 0.06
    drone.connect(master)
    ;[55, 82.4, 110.3].forEach((f, i) => {
      const o = ac.createOscillator()
      o.type = i === 1 ? "triangle" : "sine"
      o.frequency.value = f
      o.detune.value = (i - 1) * 6
      o.connect(drone)
      o.start()
    })
    const lfo = ac.createOscillator()
    const lfoGain = ac.createGain()
    lfo.frequency.value = 0.06
    lfoGain.gain.value = 0.035
    lfo.connect(lfoGain).connect(drone.gain)
    lfo.start()

    // эхо для далёких ударов металла
    const delay = ac.createDelay(2)
    delay.delayTime.value = 0.42
    const fb = ac.createGain()
    fb.gain.value = 0.38
    const echoLp = ac.createBiquadFilter()
    echoLp.type = "lowpass"
    echoLp.frequency.value = 1800
    delay.connect(echoLp).connect(fb).connect(delay)
    echoLp.connect(master)

    let clankTimer = 0
    const clank = () => {
      const t = ac.currentTime
      const base = 180 + Math.random() * 420
      const out = ac.createGain()
      out.gain.setValueAtTime(0, t)
      out.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, t + 0.005)
      out.gain.exponentialRampToValueAtTime(0.0001, t + 1.8)
      const pan = ac.createStereoPanner ? ac.createStereoPanner() : null
      if (pan) pan.pan.value = Math.random() * 1.6 - 0.8
      ;[1, 2.76, 5.4, 8.93].forEach((ratio, i) => {
        const o = ac.createOscillator()
        const g = ac.createGain()
        o.frequency.value = base * ratio
        g.gain.value = 1 / (i + 1.5)
        o.connect(g).connect(out)
        o.start(t)
        o.stop(t + 1.9)
      })
      const lp = ac.createBiquadFilter()
      lp.type = "lowpass"
      lp.frequency.value = 1400
      out.connect(lp)
      if (pan) lp.connect(pan).connect(delay)
      else lp.connect(delay)
      lp.connect(master)
      clankTimer = setTimeout(clank, 3500 + Math.random() * 7000)
    }

    return {
      ac,
      playing: false,
      start() {
        ac.resume()
        master.gain.cancelScheduledValues(ac.currentTime)
        master.gain.setTargetAtTime(0.5, ac.currentTime, 0.8)
        clearTimeout(clankTimer)
        clankTimer = setTimeout(clank, 1500)
        this.playing = true
      },
      stop() {
        master.gain.cancelScheduledValues(ac.currentTime)
        master.gain.setTargetAtTime(0, ac.currentTime, 0.4)
        clearTimeout(clankTimer)
        this.playing = false
        setTimeout(() => !this.playing && ac.suspend(), 1500)
      },
    }
  }

  function initSound() {
    const flag = document.querySelector(".avh[data-ambient], .avh-flags[data-ambient]")
    document.querySelector(".avh-sound")?.remove()
    if (!flag || flag.dataset.ambient !== "on") return
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "avh-sound"
    const playing = !!window.__avhAmbient?.playing
    btn.setAttribute("aria-pressed", String(playing))
    btn.setAttribute("aria-label", "Фоновый звук мира")
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path class="avh-wave" d="M15.5 9a4 4 0 0 1 0 6"/><path class="avh-wave" d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg><span class="avh-sound-text">${playing ? "Выключить звук" : "Звук мира"}</span>`
    btn.addEventListener("click", () => {
      window.__avhAmbient = window.__avhAmbient || createAmbient()
      const a = window.__avhAmbient
      if (!a) return
      a.playing ? a.stop() : a.start()
      btn.setAttribute("aria-pressed", String(a.playing))
      btn.querySelector(".avh-sound-text").textContent = a.playing ? "Выключить звук" : "Звук мира"
    })
    document.body.appendChild(btn)
  }

  // ================= запуск =================
  function init() {
    initSound()
    const root = document.querySelector(".avh")
    if (!root || root.dataset.ready) return
    root.dataset.ready = "1"
    // постер для видео — картинка из шапки
    const poster = root.querySelector(".avh-video-facade[data-poster]")
    if (poster) poster.style.setProperty("--poster", `url("${poster.dataset.poster}")`)
    initCards(root)
    initTimeline(root)
    initMap(root)
    initLive(root)
    initGraph(root)
  }
  document.addEventListener("nav", init)
  if (document.readyState !== "loading") init()
  else document.addEventListener("DOMContentLoaded", init)
})()
