// Страница «О мире»: маятник, сравнение сторон, эпохи истории.
// Quartz работает как SPA — запуск на событие "nav", снятие через addCleanup.
;(function () {
  if (window.__avwLoaded) return
  window.__avwLoaded = true

  function init() {
    const root = document.querySelector(".avw")
    if (!root || root.dataset.ready) return
    root.dataset.ready = "1"
    const cleanups = []
    const on = (el, ev, fn, o) => {
      if (!el) return
      el.addEventListener(ev, fn, o)
      cleanups.push(() => el.removeEventListener(ev, fn, o))
    }
    if (typeof window.addCleanup === "function") window.addCleanup(() => cleanups.forEach((f) => f()))
    const $$ = (s, el = root) => [...el.querySelectorAll(s)]

    // ---- маятник: стрелка проходит от «Жертвы Героя» к «сейчас», когда блок появляется на экране ----
    const dial = root.querySelector(".avw-dial")
    if (dial) {
      if (!("IntersectionObserver" in window)) dial.classList.add("is-on")
      else {
        const io = new IntersectionObserver(
          (es) => {
            if (es.some((e) => e.isIntersecting)) {
              dial.classList.add("is-on")
              io.disconnect()
            }
          },
          { threshold: 0.4 },
        )
        io.observe(dial)
        cleanups.push(() => io.disconnect())
      }
    }
    // половины круга: Свет / Тьма
    const halves = $$(".avw-half")
    const setHalf = (k) => {
      halves.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.half === k)))
      if (dial) dial.dataset.half = k
    }
    halves.forEach((b) => {
      on(b, "click", () => setHalf(b.dataset.half))
      on(b, "mouseenter", () => setHalf(b.dataset.half))
    })
    if (dial) dial.dataset.half = "dark"

    // ---- вкладки сравнения сторон ----
    const tabs = $$(".avw-tab")
    const aspects = $$(".avw-aspect")
    const showAspect = (i, focus) => {
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t.dataset.aspect === String(i))))
      aspects.forEach((p) => (p.hidden = p.dataset.aspect !== String(i)))
      if (focus) tabs.find((t) => t.dataset.aspect === String(i))?.focus()
    }
    tabs.forEach((t, n) => {
      on(t, "click", () => showAspect(t.dataset.aspect))
      on(t, "keydown", (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
        if (!d) return
        e.preventDefault()
        showAspect(tabs[(n + d + tabs.length) % tabs.length].dataset.aspect, true)
      })
    })

    // ---- эпохи истории ----
    const eraBtns = $$(".avw-era-btn")
    const eras = $$(".avw-era")
    let cur = eras.findIndex((e) => !e.hidden)
    const showEra = (i, focus) => {
      i = Math.max(0, Math.min(eras.length - 1, i))
      cur = i
      eraBtns.forEach((b) => b.setAttribute("aria-selected", String(+b.dataset.era === i)))
      eras.forEach((e) => {
        const show = +e.dataset.era === i
        e.hidden = !show
        if (show) {
          e.classList.remove("is-in")
          void e.offsetWidth
          e.classList.add("is-in")
        }
      })
      if (focus) eraBtns[i]?.focus()
    }
    eraBtns.forEach((b) => {
      on(b, "click", () => showEra(+b.dataset.era))
      on(b, "keydown", (e) => {
        const d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1 }[e.key]
        if (!d) return
        e.preventDefault()
        showEra(cur + d, true)
      })
    })
    $$(".avw-step").forEach((b) => on(b, "click", () => showEra(cur + +b.dataset.step)))

    // ---- плавная прокрутка по ссылкам в шапке ----
    $$(".avw-jump a").forEach((a) =>
      on(a, "click", (e) => {
        const t = root.querySelector(a.getAttribute("href"))
        if (!t) return
        e.preventDefault()
        t.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" })
      }),
    )
  }

  document.addEventListener("nav", init)
  if (document.readyState !== "loading") init()
  else document.addEventListener("DOMContentLoaded", init)
})()
