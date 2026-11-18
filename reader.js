"use strict";

const sampleTitle = "潮汐之间";
const samplePages = [
  { title: "封面" },
  { title: "出发之前", kicker: "准备", copy: "同一片海岸，两次到访可能截然不同。先确认当地潮汐预报与天气，选一段熟悉、容易撤离的岸线。", note: ["随身物品", "防滑鞋、饮水、记录本，以及可以离线查看的潮汐预报。"], photo: true },
  { title: "读懂潮线", kicker: "观察", copy: "岩石的干湿边界记录着海水刚刚经过的位置。往低处看，凹陷处留下的一汪水，可能是一座暂时与海分开的潮池。", note: ["试着比较", "在同一个位置标记两次水线，记录间隔与变化。"] },
  { title: "潮池里的邻居", kicker: "生物", copy: "停在池边安静地等一会儿。小虾可能从缝隙里游出来，附着在岩壁上的帽贝也会随着水位变化露出水面。", note: ["观察边界", "留意水面、池底与背阴处，分别记下你看见的生物。"], photo: true },
  { title: "记录与回访", kicker: "笔记", copy: "给照片留一个能辨认位置的参照物，在笔记里写下日期、潮位和天气。下一次沿同一段海岸走，试着找到原来的观察点。", note: ["一条记录", "地点、时间、潮位、看到的现象，以及下次想核对的细节。"] },
  { title: "离开海岸", kicker: "收尾", copy: "离开前回望观察点，检查随身物品，把找到的贝壳留在原处。潮水回来后，这里又会成为海的一部分。", note: ["下次再来", "换一个季节，看看同一座潮池发生了哪些变化。"] },
];

const ids = [
  "workspace", "sidebar", "toc", "scrim", "toggle-sidebar", "close-sidebar",
  "example", "open-file", "file", "document-kind", "title", "stage", "book",
  "message", "drop-layer", "previous", "next", "jump", "page-number", "total",
  "announcement", "fullscreen", "password-dialog", "password-title", "password", "cancel-password",
];
const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
const mobile = matchMedia("(max-width: 820px)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const vendor = new URL("./vendor/pdfjs/", document.baseURI);

const state = {
  page: 1,
  total: samplePages.length,
  pdf: null,
  activePdf: null,
  pendingPdf: null,
  loadId: 0,
  renderId: 0,
  renderTasks: new Set(),
  tocButtons: [],
  liveSpread: null,
  animation: null,
};

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content) node.textContent = content;
  return node;
}

function setMessage(message = "", error = false) {
  ui.message.textContent = message;
  ui.message.classList.toggle("error", error);
  ui.message.hidden = !message;
}

function visiblePages() {
  const page = state.page;
  if (mobile.matches || page === 1) return [page];
  const left = page - page % 2;
  return left < state.total ? [left, left + 1] : [left];
}

function updateControls() {
  const pages = visiblePages();
  ui.previous.disabled = pages[0] === 1;
  ui.next.disabled = pages.at(-1) >= state.total;
  ui["page-number"].value = state.page;
  ui.total.textContent = state.total;
  ui.announcement.textContent = pages.length === 2
    ? `第 ${pages[0]} 至 ${pages[1]} 页，共 ${state.total} 页`
    : `第 ${state.page} 页，共 ${state.total} 页`;

  let current;
  for (const entry of state.tocButtons) {
    if (entry.page <= state.page && (!current || entry.page >= current.page)) current = entry;
    entry.button.removeAttribute("aria-current");
  }
  current?.button.setAttribute("aria-current", "page");
}

function setToc(entries) {
  const hadFocus = ui.toc.contains(document.activeElement);
  const fragment = document.createDocumentFragment();
  const digits = Math.max(2, String(state.total).length);
  state.tocButtons = entries.map(({ title, page, depth = 0 }) => {
    const button = element("button", "toc-entry");
    button.type = "button";
    button.style.setProperty("--indent", Math.min(depth, 6));
    button.append(element("span", "", title), element("span", "toc-page", String(page).padStart(digits, "0")));
    button.addEventListener("click", () => {
      toggleSidebar(false);
      goTo(page);
    });
    fragment.append(button);
    return { button, page };
  });
  ui.toc.replaceChildren(fragment);
  ui.toc.scrollTop = 0;
  updateControls();
  if (hadFocus) (ui.toc.querySelector("[aria-current]") || ui.toc.firstElementChild)?.focus();
}

function pageEntries(total) {
  const step = Math.ceil(total / 500);
  return Array.from({ length: Math.ceil(total / step) }, (_, index) => ({
    page: index * step + 1,
    title: `第 ${index * step + 1} 页`,
  }));
}

async function pdfToc(pdf) {
  const bookmarks = await pdf.getOutline();
  const items = [];

  function collect(nodes, depth) {
    if (!nodes || depth > 24) return;
    for (const node of nodes) {
      if (items.length >= 2500) return;
      if (node.dest) items.push({ node, depth });
      collect(node.items, depth + 1);
    }
  }

  collect(bookmarks, 0);
  const entries = [];
  for (let i = 0; i < items.length && state.pdf === pdf; i += 20) {
    const rows = await Promise.allSettled(items.slice(i, i + 20).map(async ({ node, depth }) => {
      const dest = typeof node.dest === "string" ? await pdf.getDestination(node.dest) : node.dest;
      if (!Array.isArray(dest) || !dest.length) return null;
      const target = dest[0];
      if (!Number.isInteger(target) && (!target || typeof target !== "object")) return null;
      const page = (Number.isInteger(target) ? target : await pdf.getPageIndex(target)) + 1;
      return page >= 1 && page <= pdf.numPages ? { title: node.title || `第 ${page} 页`, page, depth } : null;
    }));
    entries.push(...rows.flatMap(row => row.status === "fulfilled" && row.value ? [row.value] : []));
  }
  return entries;
}

function sampleSheet(page) {
  const content = element("div", "page-content");
  const sheet = element("article", page === 1 ? "sheet sample cover" : "sheet sample");
  sheet.setAttribute("aria-label", `第 ${page} 页 · ${samplePages[page - 1].title}`);
  sheet.append(content);

  if (page === 1) {
    const title = element("h2", "", sampleTitle);
    title.replaceChildren("潮汐", document.createElement("br"), "之间");
    const english = element("p", "cover-en");
    english.replaceChildren("Between the Tides", document.createElement("br"), "A Tidepool Field Guide");
    content.append(
      element("span", "cover-series", "海岸野外笔记"),
      title,
      element("p", "cover-sub", "潮间带观察手册"),
      english,
    );
    return sheet;
  }

  const data = samplePages[page - 1];
  content.append(
    element("span", "article-kicker", data.kicker),
    element("h3", "", data.title),
    element("p", "page-copy", data.copy),
  );
  if (data.photo) {
    const photo = element("img", "shore-detail");
    photo.src = "assets/coast.jpg";
    photo.alt = "涌浪漫过岩岸";
    content.append(photo);
  }
  const feature = element("div", "page-feature");
  feature.append(element("strong", "", data.note[0]), element("span", "", data.note[1]));
  const footer = element("footer", "page-footer");
  footer.append(element("span", "", sampleTitle), element("span", "", String(page).padStart(2, "0")));
  content.append(feature, footer);
  return sheet;
}

function cancelRender() {
  state.renderId += 1;
  for (const task of state.renderTasks) task.cancel();
  state.renderTasks.clear();
  return state.renderId;
}

function showSpread(spread, direction) {
  state.animation?.cancel();
  const old = state.liveSpread;
  state.liveSpread = spread;
  ui.book.append(spread);
  if (!old) return;

  if (!direction || reducedMotion.matches || !spread.animate) {
    old.remove();
    return;
  }

  old.setAttribute("aria-hidden", "true");
  old.classList.add("leaving");
  const origin = direction > 0 ? "left center" : "right center";
  const animation = old.animate([
    { transform: "rotateY(0deg)", opacity: 1, zIndex: 1, transformOrigin: origin },
    { transform: `rotateY(${direction * -91}deg)`, opacity: 0, zIndex: 1, transformOrigin: origin },
  ], { duration: 370, easing: "cubic-bezier(.38,.08,.24,1)" });
  state.animation = animation;
  animation.finished.then(() => old.remove(), () => old.remove());
}

async function draw(direction = 0) {
  const id = cancelRender();
  const pages = visiblePages();
  const pdf = state.pdf;
  const spread = element("div", pages.length === 2 ? "spread paired" : "spread");
  ui.book.setAttribute("aria-busy", "true");

  try {
    const pdfPages = pdf ? await Promise.all(pages.map(page => pdf.getPage(page))) : [];
    if (id !== state.renderId) return;

    const boxes = pdf
      ? pdfPages.map(page => page.getViewport({ scale: 1 }))
      : pages.map(() => ({ width: 440, height: 570 }));
    const availableWidth = ui.book.clientWidth;
    const availableHeight = ui.book.clientHeight;
    if (!availableWidth || !availableHeight) return;
    const scale = Math.min(
      availableWidth / boxes.reduce((total, box) => total + box.width, 0),
      availableHeight / Math.max(...boxes.map(box => box.height)),
      pdf ? Infinity : 1.25,
    );

    const renders = pages.map(async (number, i) => {
      const { width, height } = boxes[i];
      const sheet = pdf ? element("div", "sheet") : sampleSheet(number);
      const cssWidth = width * scale;
      const cssHeight = height * scale;
      sheet.style.width = `${cssWidth}px`;
      sheet.style.height = `${cssHeight}px`;
      spread.append(sheet);
      if (!pdf) return;

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(cssWidth, cssHeight));
      const viewport = pdfPages[i].getViewport({ scale: scale * pixelRatio });
      const canvas = element("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `PDF 第 ${number} 页`);
      sheet.append(canvas);
      const task = pdfPages[i].render({ canvas, viewport });
      state.renderTasks.add(task);
      try {
        await task.promise;
      } finally {
        state.renderTasks.delete(task);
      }
    });

    await Promise.all(renders);
    if (id === state.renderId) {
      if (ui.message.dataset.kind === "render") {
        delete ui.message.dataset.kind;
        setMessage();
      }
      showSpread(spread, direction);
    }
  } catch {
    if (id === state.renderId) {
      cancelRender();
      state.liveSpread?.remove();
      state.liveSpread = null;
      ui.message.dataset.kind = "render";
      setMessage("这一页暂时无法显示，可以跳到其他页。", true);
      ui.book.setAttribute("aria-busy", "false");
    }
  } finally {
    if (id === state.renderId) ui.book.setAttribute("aria-busy", "false");
  }
}

function goTo(page) {
  const previous = state.page;
  const oldStart = visiblePages()[0];
  state.page = Math.max(1, Math.min(state.total, page));
  updateControls();
  if (oldStart !== visiblePages()[0]) void draw(Math.sign(state.page - previous));
}

function turn(direction) {
  const pages = visiblePages();
  const target = direction > 0 ? pages.at(-1) + 1 : pages[0] - 1;
  if (target >= 1 && target <= state.total) goTo(target);
}

function destroy(task) {
  if (task) void task.destroy().catch(() => {});
}

function cancelOpen() {
  state.loadId += 1;
  const task = state.pendingPdf;
  state.pendingPdf = null;
  if (ui["password-dialog"].open) ui["password-dialog"].close("cancel");
  destroy(task);
  return state.loadId;
}

function askPassword(reason, api) {
  const dialog = ui["password-dialog"];
  ui["password-title"].textContent = reason === api.PasswordResponses.INCORRECT_PASSWORD
    ? "密码不正确，请重试"
    : "输入 PDF 密码";
  ui.password.value = "";
  dialog.returnValue = "cancel";
  dialog.showModal();

  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue === "unlock" ? ui.password.value : null;
      ui.password.value = "";
      resolve(value);
    }, { once: true });
  });
}

async function openPdf(file) {
  const id = cancelOpen();
  delete ui.message.dataset.kind;
  const fail = message => {
    if (id === state.loadId) setMessage(message, true);
  };
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    fail("请选择 PDF 文件。");
    return;
  }
  if (file.size > 150 * 1024 * 1024) {
    fail("此 Demo 支持 150 MB 以内的 PDF。");
    return;
  }
  if (location.protocol === "file:") {
    fail("请在 GitHub Pages 或本地网站预览中打开 PDF。");
    return;
  }

  setMessage("正在打开 PDF…");
  let task;
  try {
    const api = await import(new URL("legacy/build/pdf.min.mjs", vendor));
    if (id !== state.loadId) return;
    api.GlobalWorkerOptions.workerSrc = new URL("legacy/build/pdf.worker.min.mjs", vendor).href;
    const data = new Uint8Array(await file.arrayBuffer());
    if (id !== state.loadId) return;

    task = api.getDocument({
      data,
      cMapUrl: new URL("cmaps/", vendor).href,
      standardFontDataUrl: new URL("standard_fonts/", vendor).href,
      iccUrl: new URL("iccs/", vendor).href,
      wasmUrl: new URL("wasm/", vendor).href,
      canvasMaxAreaInBytes: 64 * 1024 * 1024,
    });
    state.pendingPdf = task;
    task.onPassword = async (unlock, reason) => {
      if (id !== state.loadId) return;
      const password = await askPassword(reason, api);
      if (id !== state.loadId) return;
      if (password !== null) unlock(password);
      else {
        cancelOpen();
        setMessage();
      }
    };
    const pdf = await task.promise;
    await pdf.getPage(1);
    if (id !== state.loadId) return;
    const old = state.activePdf;
    state.activePdf = task;
    state.pendingPdf = null;
    state.pdf = pdf;
    state.total = pdf.numPages;
    state.page = 1;
    ui.title.textContent = file.name.replace(/\.pdf$/i, "");
    ui["document-kind"].textContent = "本地 PDF";
    ui.example.hidden = false;
    setToc(pageEntries(state.total));
    setMessage();
    void draw();
    destroy(old);
    const entries = await pdfToc(pdf).catch(() => []);
    if (state.pdf === pdf && entries.length) setToc(entries);
  } catch {
    if (id !== state.loadId) return;
    if (task && state.activePdf !== task) destroy(task);
    state.pendingPdf = null;
    fail("无法打开此 PDF。请检查文件是否完整，或选择另一个 PDF。");
  }
}

function showSample() {
  cancelOpen();
  const old = state.activePdf;
  state.activePdf = null;
  state.pdf = null;
  state.total = samplePages.length;
  state.page = 1;
  ui.title.textContent = sampleTitle;
  ui["document-kind"].textContent = "示例手册";
  ui.example.hidden = true;
  setToc(samplePages.map(({ title }, index) => ({ title, page: index + 1 })));
  delete ui.message.dataset.kind;
  setMessage();
  void draw();
  destroy(old);
}

function toggleSidebar(open, restore = true) {
  const wasOpen = ui.sidebar.classList.contains("open");
  ui.sidebar.classList.toggle("open", open);
  ui.scrim.hidden = !open;
  ui["toggle-sidebar"].setAttribute("aria-expanded", String(open));
  if (open) (ui.toc.querySelector("[aria-current]") || ui["close-sidebar"]).focus();
  if (wasOpen && !open && restore && mobile.matches) ui["toggle-sidebar"].focus();
}

ui["toggle-sidebar"].addEventListener("click", () => toggleSidebar(true));
ui["close-sidebar"].addEventListener("click", () => toggleSidebar(false));
ui.scrim.addEventListener("click", () => toggleSidebar(false));
ui["open-file"].addEventListener("click", () => ui.file.click());
ui["cancel-password"].addEventListener("click", () => ui["password-dialog"].close("cancel"));
ui.example.addEventListener("click", () => {
  showSample();
  ui["open-file"].focus();
});
ui.file.addEventListener("change", () => {
  const file = ui.file.files[0];
  ui.file.value = "";
  if (file) void openPdf(file);
});
ui.previous.addEventListener("click", () => turn(-1));
ui.next.addEventListener("click", () => turn(1));
ui.jump.addEventListener("submit", event => {
  event.preventDefault();
  const value = Number(ui["page-number"].value.trim());
  if (Number.isSafeInteger(value) && value >= 1 && value <= state.total) goTo(value);
  else updateControls();
});
ui["page-number"].addEventListener("focus", () => ui["page-number"].select());
ui["page-number"].addEventListener("blur", () => { ui["page-number"].value = state.page; });

document.addEventListener("keydown", event => {
  if (ui["password-dialog"].open || event.defaultPrevented || event.metaKey || event.altKey || event.ctrlKey) return;
  if (ui.sidebar.classList.contains("open")) {
    if (event.key === "Escape") toggleSidebar(false);
    return;
  }
  if (event.target.matches?.("input, textarea, select, [contenteditable]")) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    turn(event.key === "ArrowLeft" ? -1 : 1);
  }
});

let touch;
ui.stage.addEventListener("pointerdown", event => {
  if (event.pointerType !== "touch") return;
  if (!event.isPrimary) {
    touch = null;
    return;
  }
  touch = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
ui.stage.addEventListener("pointercancel", () => { touch = null; });
ui.stage.addEventListener("pointerup", event => {
  if (touch?.id !== event.pointerId) return;
  const dx = event.clientX - touch.x;
  const dy = event.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) >= 42 && Math.abs(dx) > Math.abs(dy) * 1.45) turn(dx < 0 ? 1 : -1);
});

let dragDepth = 0;
ui.stage.addEventListener("dragenter", event => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  dragDepth += 1;
  ui["drop-layer"].hidden = false;
});
ui.stage.addEventListener("dragover", event => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});
ui.stage.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) ui["drop-layer"].hidden = true;
});
ui.stage.addEventListener("drop", event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  dragDepth = 0;
  ui["drop-layer"].hidden = true;
  void openPdf(event.dataTransfer.files[0]);
});

ui.fullscreen.hidden = !document.fullscreenEnabled;
ui.fullscreen.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await ui.workspace.requestFullscreen();
  } catch {
    setMessage("当前无法切换全屏。", true);
  }
});
document.addEventListener("fullscreenchange", () => {
  const active = document.fullscreenElement === ui.workspace;
  const label = active ? "退出全屏" : "全屏阅读";
  ui.fullscreen.title = label;
  ui.fullscreen.setAttribute("aria-label", label);
  ui.fullscreen.querySelector("use").setAttribute("href", active ? "#i-collapse" : "#i-expand");
});

mobile.addEventListener("change", () => {
  toggleSidebar(false, false);
  updateControls();
  void draw();
});

let resizeFrame;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => void draw());
}).observe(ui.book);

showSample();
