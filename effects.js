/* ============================================================
   FoldPress — visual effects layer (purely cosmetic, no tool logic)
   ============================================================ */

/* ---------- Particle constellation in the hero ---------- */
(function initParticles() {
  const canvas = document.getElementById("particleCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const hero = canvas.closest(".hero");
  let w, h, dpr;
  let points = [];
  const COUNT = 46;
  const MAX_DIST = 130;
  let mouse = { x: -9999, y: -9999 };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = hero.clientWidth; h = hero.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed() {
    points = Array.from({ length: COUNT }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
    }));
  }

  function tick() {
    ctx.clearRect(0, 0, w, h);
    points.forEach((p) => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > w) p.vx *= -1;
      if (p.y < 0 || p.y > h) p.vy *= -1;
    });
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MAX_DIST) {
          ctx.strokeStyle = `rgba(91,107,255,${0.16 * (1 - dist / MAX_DIST)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(points[i].x, points[i].y);
          ctx.lineTo(points[j].x, points[j].y);
          ctx.stroke();
        }
      }
      const dmx = points[i].x - mouse.x, dmy = points[i].y - mouse.y;
      const dm = Math.sqrt(dmx * dmx + dmy * dmy);
      if (dm < 160) {
        ctx.strokeStyle = `rgba(55,214,167,${0.35 * (1 - dm / 160)})`;
        ctx.beginPath(); ctx.moveTo(points[i].x, points[i].y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
      }
    }
    points.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(210,215,255,.7)";
      ctx.fill();
    });
    requestAnimationFrame(tick);
  }

  hero.addEventListener("mousemove", (e) => {
    const rect = hero.getBoundingClientRect();
    mouse.x = e.clientX - rect.left; mouse.y = e.clientY - rect.top;
  });
  hero.addEventListener("mouseleave", () => { mouse.x = -9999; mouse.y = -9999; });

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.addEventListener("resize", () => { resize(); seed(); });
  resize(); seed();
  if (!reduced) requestAnimationFrame(tick);
})();

/* ---------- Scroll reveal ---------- */
(function initReveal() {
  const els = document.querySelectorAll("[data-reveal]");
  if (!els.length) return;
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add("in"); io.unobserve(entry.target); }
      });
    },
    { threshold: 0.12 }
  );
  els.forEach((el) => io.observe(el));
})();

/* ---------- Animated counters ---------- */
(function initCounters() {
  const counters = document.querySelectorAll(".counter");
  if (!counters.length) return;
  counters.forEach((el) => {
    const target = parseInt(el.dataset.count, 10) || 0;
    let current = 0;
    const step = Math.max(1, Math.round(target / 24));
    const timer = setInterval(() => {
      current = Math.min(target, current + step);
      el.textContent = current;
      if (current >= target) clearInterval(timer);
    }, 28);
  });
})();

/* ---------- 3D tilt on tool cards ---------- */
(function initTilt() {
  const cards = document.querySelectorAll(".tool-card");
  cards.forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      card.style.transform = `perspective(600px) rotateX(${(-y * 7).toFixed(2)}deg) rotateY(${(x * 9).toFixed(2)}deg) translateY(-3px)`;
    });
    card.addEventListener("mouseleave", () => { card.style.transform = ""; });
  });
})();

