/* ============================================================
   FoldPress — client-side PDF & image toolkit
   Everything below runs in the browser. No file content is
   ever sent to a server.
   ============================================================ */

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3200);
}

/* ---------- HELPERS ---------- */
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
async function fileToArrayBuffer(file) { return await file.arrayBuffer(); }

async function loadImageBitmap(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  URL.revokeObjectURL(url);
  return img;
}

/* ============================================================
   TOOL DEFINITIONS
   Each tool describes its accept type, its options UI, and a
   run() function that returns [{blob, filename}]
   ============================================================ */
const TOOLS = {
  merge: {
    title: "Merge PDF", eyebrow: "COMBINE", icon: iconLayers(),
    desc: "Combine several PDFs into one, in the order you choose.",
    accept: "application/pdf", multiple: true,
    options: [],
    async run(files, opts, onProgress) {
      const { PDFDocument } = PDFLib;
      const merged = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        const bytes = await fileToArrayBuffer(files[i]);
        const src = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
        onProgress(((i + 1) / files.length) * 90);
      }
      const bytes = await merged.save();
      onProgress(100);
      return [{ blob: new Blob([bytes], { type: "application/pdf" }), filename: "merged.pdf" }];
    },
  },

  split: {
    title: "Split PDF", eyebrow: "SEPARATE", icon: iconScissors(),
    desc: "Break a PDF into individual pages, or pull a specific range.",
    accept: "application/pdf", multiple: false,
    options: [
      { id: "range", label: "Page range (optional, e.g. 1-3,5)", type: "text", placeholder: "leave blank for all pages" },
    ],
    async run(files, opts, onProgress) {
      const { PDFDocument } = PDFLib;
      const bytes = await fileToArrayBuffer(files[0]);
      const src = await PDFDocument.load(bytes);
      const total = src.getPageCount();
      let indices = [];
      if (opts.range && opts.range.trim()) {
        opts.range.split(",").forEach((part) => {
          part = part.trim();
          if (part.includes("-")) {
            const [a, b] = part.split("-").map((n) => parseInt(n.trim(), 10));
            for (let n = a; n <= b; n++) indices.push(n - 1);
          } else if (part) indices.push(parseInt(part, 10) - 1);
        });
      } else {
        indices = [...Array(total).keys()];
      }
      indices = indices.filter((i) => i >= 0 && i < total);

      const zip = new JSZip();
      for (let i = 0; i < indices.length; i++) {
        const doc = await PDFDocument.create();
        const [page] = await doc.copyPages(src, [indices[i]]);
        doc.addPage(page);
        const pdfBytes = await doc.save();
        zip.file(`page-${indices[i] + 1}.pdf`, pdfBytes);
        onProgress(((i + 1) / indices.length) * 90);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      onProgress(100);
      return [{ blob: zipBlob, filename: "split-pages.zip" }];
    },
  },

  compress: {
    title: "Compress PDF", eyebrow: "SHRINK", icon: iconCompress(),
    desc: "Reduce file size by re-encoding pages at a chosen quality.",
    accept: "application/pdf", multiple: false,
    options: [
      { id: "quality", label: "Quality", type: "select", choices: [
        { value: "0.4|1.0", label: "Smallest file" },
        { value: "0.6|1.3", label: "Balanced (recommended)" },
        { value: "0.8|1.8", label: "Best quality" },
      ]},
    ],
    async run(files, opts, onProgress) {
      const { PDFDocument } = PDFLib;
      const [jpegQuality, scale] = (opts.quality || "0.6|1.3").split("|").map(Number);
      const bytes = await fileToArrayBuffer(files[0]);
      const loadingTask = pdfjsLib.getDocument({ data: bytes });
      const pdf = await loadingTask.promise;
      const outDoc = await PDFDocument.create();

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width; canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        const jpegDataUrl = canvas.toDataURL("image/jpeg", jpegQuality);
        const jpegBytes = await (await fetch(jpegDataUrl)).arrayBuffer();
        const jpegImage = await outDoc.embedJpg(jpegBytes);
        const outPage = outDoc.addPage([viewport.width, viewport.height]);
        outPage.drawImage(jpegImage, { x: 0, y: 0, width: viewport.width, height: viewport.height });
        onProgress((i / pdf.numPages) * 90);
      }
      const outBytes = await outDoc.save();
      onProgress(100);
      return [{ blob: new Blob([outBytes], { type: "application/pdf" }), filename: "compressed.pdf" }];
    },
  },

  pdf2img: {
    title: "PDF → Images", eyebrow: "EXPORT", icon: iconImage(),
    desc: "Turn every page into a JPG or PNG, zipped for download.",
    accept: "application/pdf", multiple: false,
    options: [
      { id: "format", label: "Format", type: "select", choices: [
        { value: "jpeg", label: "JPG" }, { value: "png", label: "PNG" },
      ]},
    ],
    async run(files, opts, onProgress) {
      const format = opts.format || "jpeg";
      const bytes = await fileToArrayBuffer(files[0]);
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const zip = new JSZip();
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width; canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        const blob = await new Promise((res) => canvas.toBlob(res, `image/${format}`, 0.9));
        zip.file(`page-${i}.${format === "jpeg" ? "jpg" : "png"}`, blob);
        onProgress((i / pdf.numPages) * 90);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      onProgress(100);
      return [{ blob: zipBlob, filename: "pdf-images.zip" }];
    },
  },

  img2pdf: {
    title: "Images → PDF", eyebrow: "COMBINE", icon: iconLayers(),
    desc: "Turn a batch of photos or screenshots into a single PDF.",
    accept: "image/*", multiple: true,
    options: [],
    async run(files, opts, onProgress) {
      const { PDFDocument } = PDFLib;
      const doc = await PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const bytes = await fileToArrayBuffer(file);
        let image;
        if (file.type === "image/png") image = await doc.embedPng(bytes);
        else if (file.type === "image/jpeg" || file.type === "image/jpg") image = await doc.embedJpg(bytes);
        else {
          const bitmap = await loadImageBitmap(file);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          canvas.getContext("2d").drawImage(bitmap, 0, 0);
          const jpegBytes = await (await fetch(canvas.toDataURL("image/jpeg", 0.92))).arrayBuffer();
          image = await doc.embedJpg(jpegBytes);
        }
        const page = doc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        onProgress(((i + 1) / files.length) * 90);
      }
      const bytes = await doc.save();
      onProgress(100);
      return [{ blob: new Blob([bytes], { type: "application/pdf" }), filename: "images.pdf" }];
    },
  },

  watermark: {
    title: "Watermark PDF", eyebrow: "STAMP", icon: iconStamp(),
    desc: "Overlay a diagonal text watermark across every page.",
    accept: "application/pdf", multiple: false,
    options: [
      { id: "text", label: "Watermark text", type: "text", placeholder: "CONFIDENTIAL", default: "CONFIDENTIAL" },
      { id: "opacity", label: "Opacity", type: "range", min: 0.1, max: 0.6, step: 0.05, default: 0.25 },
    ],
    async run(files, opts, onProgress) {
      const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;
      const bytes = await fileToArrayBuffer(files[0]);
      const doc = await PDFDocument.load(bytes);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const text = (opts.text || "CONFIDENTIAL").toUpperCase();
      const opacity = parseFloat(opts.opacity || 0.25);
      const pages = doc.getPages();
      pages.forEach((page, i) => {
        const { width, height } = page.getSize();
        const size = width / (text.length * 0.62);
        page.drawText(text, {
          x: width / 2 - (text.length * size * 0.3), y: height / 2,
          size, font, color: rgb(0.29, 0.33, 0.91), opacity, rotate: degrees(35),
        });
        onProgress(((i + 1) / pages.length) * 90);
      });
      const outBytes = await doc.save();
      onProgress(100);
      return [{ blob: new Blob([outBytes], { type: "application/pdf" }), filename: "watermarked.pdf" }];
    },
  },

  imgcompress: {
    title: "Compress Images", eyebrow: "SHRINK", icon: iconCompress(),
    desc: "Shrink JPG/PNG file size while keeping resolution.",
    accept: "image/*", multiple: true,
    options: [
      { id: "quality", label: "Target quality", type: "select", choices: [
        { value: "0.5", label: "Smallest file" },
        { value: "0.7", label: "Balanced (recommended)" },
        { value: "0.85", label: "Best quality" },
      ]},
    ],
    async run(files, opts, onProgress) {
      const quality = parseFloat(opts.quality || 0.7);
      const results = [];
      for (let i = 0; i < files.length; i++) {
        const compressed = await imageCompression(files[i], {
          initialQuality: quality, maxWidthOrHeight: 4096, useWebWorker: true,
        });
        results.push({ blob: compressed, filename: `compressed-${files[i].name}` });
        onProgress(((i + 1) / files.length) * 100);
      }
      return results;
    },
  },

  imgconvert: {
    title: "Resize & Convert", eyebrow: "RESHAPE", icon: iconImage(),
    desc: "Resize images and switch between JPG, PNG and WebP.",
    accept: "image/*", multiple: true,
    options: [
      { id: "format", label: "Output format", type: "select", choices: [
        { value: "image/jpeg", label: "JPG" }, { value: "image/png", label: "PNG" }, { value: "image/webp", label: "WebP" },
      ]},
      { id: "maxWidth", label: "Max width (px, optional)", type: "number", placeholder: "e.g. 1920" },
    ],
    async run(files, opts, onProgress) {
      const format = opts.format || "image/jpeg";
      const maxWidth = parseInt(opts.maxWidth, 10) || null;
      const results = [];
      for (let i = 0; i < files.length; i++) {
        const bitmap = await loadImageBitmap(files[i]);
        let { width, height } = bitmap;
        if (maxWidth && width > maxWidth) { height = Math.round(height * (maxWidth / width)); width = maxWidth; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise((res) => canvas.toBlob(res, format, 0.9));
        const ext = format.split("/")[1];
        const baseName = files[i].name.replace(/\.[^.]+$/, "");
        results.push({ blob, filename: `${baseName}.${ext}` });
        onProgress(((i + 1) / files.length) * 100);
      }
      return results;
    },
  },
};

/* ---------- ICONS (inline SVG strings) ---------- */
function iconLayers() { return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L18 6L10 10L2 6L10 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 10L10 14L18 10" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 14L10 18L18 14" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`; }
function iconScissors() { return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="5" cy="5" r="2.2" stroke="currentColor" stroke-width="1.5"/><circle cx="5" cy="15" r="2.2" stroke="currentColor" stroke-width="1.5"/><path d="M6.6 6.4L17 17M6.6 13.6L17 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`; }
function iconCompress() { return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 8V3H8M12 3H17V8M17 12V17H12M8 17H3V12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`; }
function iconImage() { return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2.5" y="3.5" width="15" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="8" r="1.4" stroke="currentColor" stroke-width="1.3"/><path d="M3 14.5L7.5 10.5L11 13.5L14 10.5L17.5 14" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`; }
function iconStamp() { return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="4" y="14" width="12" height="3" rx="1" stroke="currentColor" stroke-width="1.4"/><path d="M7 14V10.5C7 8 8.3 6 10 6C11.7 6 13 8 13 10.5V14" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`; }

/* ============================================================
   UI WIRING
   ============================================================ */
const toolGrid = document.getElementById("toolGrid");
Object.entries(TOOLS).forEach(([id, tool]) => {
  const card = document.createElement("button");
  card.className = "tool-card";
  card.innerHTML = `
    <div class="reg-mark small" aria-hidden="true"></div>
    <div class="tool-icon">${tool.icon}</div>
    <h3>${tool.title}</h3>
    <p>${tool.desc}</p>
    <span class="tag">${tool.eyebrow}</span>
  `;
  card.addEventListener("click", () => openTool(id));
  toolGrid.appendChild(card);
});

let currentToolId = null;
let selectedFiles = [];

const workspaceEmpty = document.getElementById("workspaceEmpty");
const workspaceActive = document.getElementById("workspaceActive");
const wsTitle = document.getElementById("wsTitle");
const wsEyebrow = document.getElementById("wsEyebrow");
const dropzone = document.getElementById("dropzone");
const dropzoneHint = document.getElementById("dropzoneHint");
const fileInput = document.getElementById("fileInput");
const fileListEl = document.getElementById("fileList");
const toolOptionsEl = document.getElementById("toolOptions");
const processBtn = document.getElementById("processBtn");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const resultListEl = document.getElementById("resultList");
const rulerEl = document.getElementById("ruler");
const rulerFill = document.getElementById("rulerFill");
const rulerLabel = document.getElementById("rulerLabel");

document.getElementById("wsClose").addEventListener("click", () => {
  workspaceActive.hidden = true; workspaceEmpty.hidden = false; currentToolId = null;
});

function openTool(id) {
  const tool = TOOLS[id];
  currentToolId = id; selectedFiles = [];
  workspaceEmpty.hidden = true; workspaceActive.hidden = false;
  wsTitle.textContent = tool.title;
  wsEyebrow.textContent = tool.eyebrow;
  fileInput.accept = tool.accept;
  fileInput.multiple = tool.multiple;
  dropzoneHint.textContent = tool.multiple ? "Drop as many files as you need" : "Drop one file to get started";
  fileListEl.innerHTML = "";
  resultListEl.innerHTML = "";
  progressWrap.hidden = true; progressBar.style.width = "0%";
  rulerEl.hidden = true;
  renderOptions(tool);
  processBtn.disabled = true;
  document.getElementById("workspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderOptions(tool) {
  toolOptionsEl.innerHTML = "";
  tool.options.forEach((opt) => {
    const wrap = document.createElement("div");
    wrap.className = "opt";
    if (opt.type === "select") {
      wrap.innerHTML = `<label for="opt-${opt.id}">${opt.label}</label>
        <select id="opt-${opt.id}">${opt.choices.map((c) => `<option value="${c.value}">${c.label}</option>`).join("")}</select>`;
    } else if (opt.type === "range") {
      wrap.innerHTML = `<label for="opt-${opt.id}">${opt.label}</label>
        <input type="range" id="opt-${opt.id}" min="${opt.min}" max="${opt.max}" step="${opt.step}" value="${opt.default}">`;
    } else if (opt.type === "number") {
      wrap.innerHTML = `<label for="opt-${opt.id}">${opt.label}</label>
        <input type="number" id="opt-${opt.id}" placeholder="${opt.placeholder || ""}">`;
    } else {
      wrap.innerHTML = `<label for="opt-${opt.id}">${opt.label}</label>
        <input type="text" id="opt-${opt.id}" placeholder="${opt.placeholder || ""}" value="${opt.default || ""}">`;
    }
    toolOptionsEl.appendChild(wrap);
  });
}

function collectOptions(tool) {
  const opts = {};
  tool.options.forEach((opt) => {
    const el = document.getElementById(`opt-${opt.id}`);
    if (el) opts[opt.id] = el.value;
  });
  return opts;
}

/* ---------- Drag & drop / file selection ---------- */
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag"); });
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault(); dropzone.classList.remove("drag");
  handleFiles(Array.from(e.dataTransfer.files));
});
fileInput.addEventListener("change", () => handleFiles(Array.from(fileInput.files)));

function handleFiles(newFiles) {
  const tool = TOOLS[currentToolId];
  if (!tool) return;
  if (!tool.multiple) selectedFiles = [];
  selectedFiles = selectedFiles.concat(newFiles);

  renderFileList();
}

function renderFileList() {
  fileListEl.innerHTML = "";
  selectedFiles.forEach((file, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="fname">${file.name}</span><span class="fsize mono">${formatBytes(file.size)}</span>`;
    const btn = document.createElement("button");
    btn.textContent = "✕";
    btn.addEventListener("click", () => { selectedFiles.splice(idx, 1); renderFileList(); });
    li.appendChild(btn);
    fileListEl.appendChild(li);
  });
  processBtn.disabled = selectedFiles.length === 0;
}

processBtn.addEventListener("click", async () => {
  const tool = TOOLS[currentToolId];
  if (!tool || selectedFiles.length === 0) return;
  processBtn.disabled = true;
  progressWrap.hidden = false; progressBar.style.width = "2%";
  resultListEl.innerHTML = "";
  const totalInputSize = selectedFiles.reduce((s, f) => s + f.size, 0);
  rulerEl.hidden = false; rulerFill.style.width = "0%";
  rulerLabel.textContent = `Input: ${formatBytes(totalInputSize)}`;

  try {
    const opts = collectOptions(tool);
    const results = await tool.run(selectedFiles, opts, (pct) => {
      progressBar.style.width = `${pct}%`;
      rulerFill.style.width = `${pct}%`;
    });
    progressBar.style.width = "100%";
    const totalOutputSize = results.reduce((s, r) => s + r.blob.size, 0);
    rulerLabel.textContent = `Input: ${formatBytes(totalInputSize)} → Output: ${formatBytes(totalOutputSize)}`;

    resultListEl.innerHTML = "";
    results.forEach((r) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `${r.filename} — ${formatBytes(r.blob.size)}`;
      const link = document.createElement("a");
      link.href = "#"; link.textContent = "Download";
      link.addEventListener("click", (e) => { e.preventDefault(); downloadBlob(r.blob, r.filename); });
      li.appendChild(label); li.appendChild(link);
      resultListEl.appendChild(li);
    });
    showToast("Done — nothing left this device.");
  } catch (err) {
    console.error(err);
    showToast("Something went wrong processing that file. Try a different file or options.");
  } finally {
    processBtn.disabled = false;
  }
});
