/**
 * WC-L — клиент API и навигация по разделам (прототип без фреймворка).
 *
 * Live Server (порт 5500/5501): запросы идут на тот же host, порт 8000 (uvicorn).
 * Свой API: перед app.js задайте window.WC_L_API_BASE = "http://127.0.0.1:9000/api/v1";
 */
(function () {
  const API = (function resolveApiBase() {
    if (typeof window.WC_L_API_BASE === "string" && window.WC_L_API_BASE.trim()) {
      return window.WC_L_API_BASE.replace(/\/$/, "");
    }
    if (location.protocol === "file:") {
      return "http://127.0.0.1:8000/api/v1";
    }
    const h = location.hostname;
    const isLocal = h === "localhost" || h === "127.0.0.1" || h === "[::1]";
    const port = location.port;
    // Страница с uvicorn :8000 — API относительным путём; иначе Live Server/Vite на любом порту → бэкенд :8000.
    if (isLocal && port === "8000") {
      return "/api/v1";
    }
    if (isLocal && port && port !== "8000") {
      return `${location.protocol}//${h}:8000/api/v1`;
    }
    return "/api/v1";
  })();
  const TOKEN_KEY = "wc_l_access_token";
  const VIEW_STORAGE_KEY = "wc_l_last_view";
  const KNOWN_VIEWS = Object.freeze([
    "home",
    "about",
    "rules",
    "news",
    "connect",
    "login",
    "register",
    "profile",
    "admin",
  ]);

  function persistCurrentView(name) {
    try {
      sessionStorage.setItem(VIEW_STORAGE_KEY, name);
    } catch (_) {}
  }

  function readStoredView() {
    try {
      const s = sessionStorage.getItem(VIEW_STORAGE_KEY);
      if (s && KNOWN_VIEWS.includes(s)) return s;
    } catch (_) {}
    return "home";
  }

  function apiOrigin() {
    if (API.startsWith("http://") || API.startsWith("https://")) {
      return new URL(API).origin;
    }
    return "";
  }

  /** Путь относительно каталога static (например img/coin-spin.gif) — и с :8000, и с Live Server. */
  function localStaticUrl(pathWithinStatic) {
    const raw = String(pathWithinStatic || "").replace(/^\/+/, "");
    if (!raw) return "";
    const qIdx = raw.indexOf("?");
    const pathPart = qIdx >= 0 ? raw.slice(0, qIdx) : raw;
    const query = qIdx >= 0 ? raw.slice(qIdx) : "";
    const encoded = pathPart
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    const p = encoded + query;
    const o = apiOrigin();
    if (o) return `${o}/static/${p}`;
    if (typeof location !== "undefined" && location.protocol !== "file:") {
      return `/static/${p}`;
    }
    return `static/${p}`;
  }

  (function patchFooterLinks() {
    const origin = apiOrigin();
    const docs = document.getElementById("wc-l-link-docs");
    const health = document.getElementById("wc-l-link-health");
    const hint = document.getElementById("wc-l-live-hint");
    if (docs) docs.href = origin ? `${origin}/docs` : "/docs";
    if (health) health.href = origin ? `${origin}/api/v1/health` : "/api/v1/health";
    if (hint && origin) hint.style.display = "block";
  })();

  function healthUrl() {
    if (API.startsWith("http://") || API.startsWith("https://")) {
      return new URL(API).origin + "/api/v1/health";
    }
    return "/api/v1/health";
  }

  async function checkApiStatus() {
    if (document.visibilityState !== "visible") return;
    const dot = document.getElementById("wc-l-api-status");
    const txt = document.getElementById("wc-l-api-status-text");
    if (!dot || !txt) return;
    dot.className = "api-status api-status-unknown";
    txt.textContent = "Проверка API…";
    try {
      const res = await fetch(healthUrl(), { method: "GET", cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== "ok") throw new Error("bad");
      dot.className = "api-status api-status-ok";
      txt.textContent = "API в сети";
    } catch {
      dot.className = "api-status api-status-fail";
      txt.textContent = "API недоступно (запустите uvicorn :8000)";
    }
  }

  const views = {
    home: document.getElementById("view-home"),
    about: document.getElementById("view-about"),
    rules: document.getElementById("view-rules"),
    news: document.getElementById("view-news"),
    connect: document.getElementById("view-connect"),
    login: document.getElementById("view-login"),
    register: document.getElementById("view-register"),
    profile: document.getElementById("view-profile"),
    admin: document.getElementById("view-admin"),
  };

  const navButtons = document.querySelectorAll("[data-nav]");
  const btnLogout = document.getElementById("btn-logout");
  const guestBlock = document.getElementById("nav-guest");
  const userBlock = document.getElementById("nav-user");
  const userLabel = document.getElementById("nav-user-label");

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token) {
    invalidateAuthMeCache();
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    updateAuthNav();
  }

  function authHeaders() {
    const t = getToken();
    return t ? { Authorization: "Bearer " + t } : {};
  }

  function apiUnreachableMessage() {
    if (API.startsWith("http://") || API.startsWith("https://")) {
      const u = new URL(API);
      return `Не удаётся связаться с API (${u.host}). Запустите бэкенд: uvicorn на порту 8000 и откройте страницу с того же компьютера.`;
    }
    return "Не удаётся связаться с API. Запустите сервер (uvicorn) и откройте сайт с того же хоста.";
  }

  async function apiFetch(path, options = {}) {
    const headers = { ...authHeaders(), ...(options.headers || {}) };
    if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    let res;
    try {
      res = await fetch(API + path, { ...options, headers });
    } catch (e) {
      const msg = e && e.message === "Failed to fetch" ? apiUnreachableMessage() : (e && e.message) || "Ошибка сети";
      throw new Error(msg);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const detail =
        data && typeof data === "object" && data.detail !== undefined
          ? typeof data.detail === "string"
            ? data.detail
            : JSON.stringify(data.detail)
          : res.statusText;
      throw new Error(detail || "Ошибка запроса");
    }
    return data;
  }

  /** Кэш GET /auth/me: меньше дублей при открытии профиля после шапки; параллельные вызовы — один fetch. */
  let _authMeCache = null;
  let _authMeCacheAt = 0;
  let _authMePending = null;
  const AUTH_ME_TTL_MS = 12000;

  function invalidateAuthMeCache() {
    _authMeCache = null;
    _authMeCacheAt = 0;
    _authMePending = null;
  }

  async function fetchAuthMeCached() {
    const token = getToken();
    if (!token) return null;
    const now = Date.now();
    if (_authMeCache && now - _authMeCacheAt < AUTH_ME_TTL_MS) return _authMeCache;
    if (_authMePending) return _authMePending;
    _authMePending = apiFetch("/auth/me")
      .then((me) => {
        _authMeCache = me;
        _authMeCacheAt = Date.now();
        _authMePending = null;
        return me;
      })
      .catch((err) => {
        _authMePending = null;
        invalidateAuthMeCache();
        throw err;
      });
    return _authMePending;
  }

  function showView(name) {
    persistCurrentView(name);
    document.body.setAttribute("data-view", name);
    Object.keys(views).forEach((key) => {
      const el = views[key];
      if (!el) return;
      el.classList.toggle("is-visible", key === name);
    });
    navButtons.forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-nav") === name);
    });
    if (name === "profile") loadProfile();
    if (name === "admin") loadAdminUsers();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    requestAnimationFrame(() => document.dispatchEvent(new CustomEvent("wc-l-layout-refresh")));
  }

  function updateAuthNav() {
    const token = getToken();
    if (guestBlock) guestBlock.classList.toggle("hidden", !!token);
    if (userBlock) userBlock.classList.toggle("hidden", !token);
    if (!token) {
      return;
    }
    fetchAuthMeCached()
      .then((me) => {
        if (!me) return;
        if (userLabel) userLabel.textContent = me.username;
      })
      .catch(() => {
        setToken(null);
      });
  }

  document.body.addEventListener("click", (e) => {
    const navEl = e.target.closest("[data-nav]");
    if (!navEl || navEl.closest("a[href]")) return;
    const name = navEl.getAttribute("data-nav");
    if (!name) return;
    e.preventDefault();
    showView(name);
  });

  document.querySelectorAll("[data-go-home]").forEach((el) => {
    el.addEventListener("click", () => showView("home"));
  });

  function logout() {
    setToken(null);
    showView("home");
  }

  if (btnLogout) btnLogout.addEventListener("click", logout);
  document.getElementById("btn-logout-2")?.addEventListener("click", logout);

  /* ——— Формы ——— */
  const loginForm = document.getElementById("form-login");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("login-message");
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      msg.textContent = "";
      msg.className = "flash";
      const fd = new FormData(loginForm);
      const login = fd.get("login");
      const password = fd.get("password");
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.label = submitBtn.textContent;
        submitBtn.textContent = "Входим…";
      }
      try {
        const res = await fetch(API + "/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ login, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            typeof data.detail === "string" ? data.detail : data.detail?.[0]?.msg || "Неверный логин или пароль"
          );
        }
        if (!data.access_token) {
          throw new Error("Сервер не вернул токен входа.");
        }
        setToken(data.access_token);
        msg.classList.add("flash-success");
        msg.textContent = "Добро пожаловать в цитадель!";
        showView("profile");
        checkApiStatus();
      } catch (err) {
        msg.classList.add("flash-error");
        msg.textContent = err.message;
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.label || "Войти";
        }
      }
    });
  }

  const registerForm = document.getElementById("form-register");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("register-message");
      const submitBtn = registerForm.querySelector('button[type="submit"]');
      msg.textContent = "";
      msg.className = "flash";
      const fd = new FormData(registerForm);
      const payload = {
        username: fd.get("username"),
        email: fd.get("email"),
        password: fd.get("password"),
      };
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.label = submitBtn.textContent;
        submitBtn.textContent = "Создаём…";
      }
      try {
        await apiFetch("/auth/register", { method: "POST", body: payload });
        msg.classList.add("flash-success");
        msg.textContent = "Учётная запись создана. Войдите.";
        registerForm.reset();
        setTimeout(() => showView("login"), 800);
        checkApiStatus();
      } catch (err) {
        msg.classList.add("flash-error");
        msg.textContent = err.message;
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset.label || "Зарегистрироваться";
        }
      }
    });
  }

  /** Головы mc-heads.net; в меню только превью, подписи — в title (подсказка при наведении). */
  const MC_HEAD_MAIN = 128;
  const MC_HEAD_MENU = 32;
  const MC_AVATAR_VARIANTS = Object.freeze([
    { id: "coin_spin", headName: null, label: "Монета", asset: "img/coin-spin.gif" },
    {
      id: "lep_pair",
      headName: null,
      label: "3lEP",
      asset: "img/3lEP.gif",
    },
    { id: "pack_4p8p", headName: null, label: "4P8P", asset: "img/4P8P-slow.gif?cb=3", combined: true },
    {
      id: "heart_pair",
      headName: null,
      label: "Сердце",
      asset: "img/mxjfiles-heart-22297-slow.gif?cb=2",
      backgroundAsset: "img/WBVi.gif",
    },
    { id: "cat_combo", headName: null, label: "Кот", asset: "img/u_iglgsndacj-cat-6147.gif", combined: true },
    {
      id: "diamond_pair",
      headName: null,
      label: "Алмаз",
      asset: "img/pikura-diamond-20755.gif",
      backgroundAsset: "img/HDso.gif",
    },
    { id: "chicken", headName: "MHF_Chicken", label: "Курица" },
    { id: "pig", headName: "MHF_Pig", label: "Свинья" },
    { id: "custom_upload", headName: null, label: "С устройства" },
  ]);
  /** Раньше был «По нику» (скин mc-heads); теперь по умолчанию — монета. */
  const DEFAULT_MC_AVATAR_VARIANT = "coin_spin";
  const MC_AVATAR_STORAGE_KEY = "wc_l_mc_avatar_variant_by_user";
  const WC_L_CUSTOM_AVATAR_KEY = "wc_l_custom_avatar_data_by_user";
  /** Декоративная рамка поверх аватарки (PNG поверх круга). */
  const PROFILE_FRAME_VARIANTS = Object.freeze([
    { id: "none", label: "Без рамки", asset: null },
    { id: "pngwing_1", label: "Рамка 1", asset: "img/pngwing.com (1).png" },
  ]);
  const DEFAULT_PROFILE_FRAME = "none";
  const PROFILE_FRAME_STORAGE_KEY = "wc_l_profile_frame_by_user";
  /** Превью плитки «с устройства», пока файл не выбран. */
  const CUSTOM_AVATAR_MENU_PLACEHOLDER_SRC =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="%23221818"/><path fill="none" stroke="%23c9a627" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M7 22l12-12 3 3-12 12H7v-3z"/><path fill="%23c9a627" d="M19 10l3 3 1.5-1.5L20.5 8.5 19 10z"/></svg>'
    );

  let _mcAvatarMapCache = null;
  let _customAvatarMapCache = null;
  let _profileFrameMapCache = null;
  window.addEventListener("storage", (e) => {
    if (e.key === MC_AVATAR_STORAGE_KEY) _mcAvatarMapCache = null;
    if (e.key === WC_L_CUSTOM_AVATAR_KEY) _customAvatarMapCache = null;
    if (e.key === PROFILE_FRAME_STORAGE_KEY) _profileFrameMapCache = null;
  });

  function readProfileFrameMap() {
    if (_profileFrameMapCache) return _profileFrameMapCache;
    try {
      const raw = localStorage.getItem(PROFILE_FRAME_STORAGE_KEY);
      _profileFrameMapCache = raw ? JSON.parse(raw) : {};
      if (!_profileFrameMapCache || typeof _profileFrameMapCache !== "object") _profileFrameMapCache = {};
    } catch {
      _profileFrameMapCache = {};
    }
    return _profileFrameMapCache;
  }

  function writeProfileFrameMap(map) {
    localStorage.setItem(PROFILE_FRAME_STORAGE_KEY, JSON.stringify(map));
    _profileFrameMapCache = map;
  }

  function getProfileFrameDef(frameId) {
    for (let i = 0; i < PROFILE_FRAME_VARIANTS.length; i += 1) {
      if (PROFILE_FRAME_VARIANTS[i].id === frameId) return PROFILE_FRAME_VARIANTS[i];
    }
    return PROFILE_FRAME_VARIANTS[0];
  }

  function getStoredProfileFrame(userId) {
    const v = readProfileFrameMap()[String(userId)];
    if (v) {
      for (let i = 0; i < PROFILE_FRAME_VARIANTS.length; i += 1) {
        if (PROFILE_FRAME_VARIANTS[i].id === v) return v;
      }
    }
    return DEFAULT_PROFILE_FRAME;
  }

  function setStoredProfileFrame(userId, frameId) {
    let ok = false;
    for (let i = 0; i < PROFILE_FRAME_VARIANTS.length; i += 1) {
      if (PROFILE_FRAME_VARIANTS[i].id === frameId) {
        ok = true;
        break;
      }
    }
    if (!ok) return;
    const map = { ...readProfileFrameMap() };
    map[String(userId)] = frameId;
    writeProfileFrameMap(map);
  }

  function applyProfileFrameOverlay(root, userId) {
    const deco = root.querySelector(".profile-avatar-frame-deco");
    if (!deco) return;
    const fid = getStoredProfileFrame(userId);
    const def = getProfileFrameDef(fid);
    if (!def.asset) {
      deco.classList.add("is-hidden");
      deco.removeAttribute("src");
      return;
    }
    deco.classList.remove("is-hidden");
    deco.src = localStaticUrl(def.asset);
  }

  function renderProfileFrameMenuHtml(currentFrameId) {
    const tiles = PROFILE_FRAME_VARIANTS.map((v) => {
      const sel = v.id === currentFrameId ? " is-selected" : "";
      const title = escapeHtml(v.label);
      let inner = "";
      if (v.id === "none") {
        inner = '<span class="profile-frame-tile-none" aria-hidden="true">—</span>';
      } else if (v.asset) {
        const src = localStaticUrl(v.asset);
        inner = `<img src="${src}" alt="" width="32" height="32" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
      }
      return `<button type="button" class="profile-frame-tile${sel}" role="menuitem" data-profile-frame="${v.id}" title="${title}" aria-label="${title}">${inner}</button>`;
    }).join("");
    return `<div class="profile-frame-menu hidden" id="profile-frame-menu" role="menu" aria-label="Рамка аватара" aria-hidden="true">
      <div class="profile-frame-menu-grid" role="group">${tiles}</div>
    </div>`;
  }

  function closeProfileFrameMenu() {
    const menu = document.getElementById("profile-frame-menu");
    const btn = document.getElementById("profile-frame-edit-btn");
    if (menu) {
      menu.classList.add("hidden");
      menu.setAttribute("aria-hidden", "true");
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  function readMcAvatarMap() {
    if (_mcAvatarMapCache) return _mcAvatarMapCache;
    try {
      const raw = localStorage.getItem(MC_AVATAR_STORAGE_KEY);
      _mcAvatarMapCache = raw ? JSON.parse(raw) : {};
      if (!_mcAvatarMapCache || typeof _mcAvatarMapCache !== "object") _mcAvatarMapCache = {};
    } catch {
      _mcAvatarMapCache = {};
    }
    return _mcAvatarMapCache;
  }

  function writeMcAvatarMap(map) {
    _mcAvatarMapCache = map;
    localStorage.setItem(MC_AVATAR_STORAGE_KEY, JSON.stringify(map));
  }

  function readCustomAvatarMap() {
    if (_customAvatarMapCache) return _customAvatarMapCache;
    try {
      const raw = localStorage.getItem(WC_L_CUSTOM_AVATAR_KEY);
      _customAvatarMapCache = raw ? JSON.parse(raw) : {};
      if (!_customAvatarMapCache || typeof _customAvatarMapCache !== "object") _customAvatarMapCache = {};
    } catch {
      _customAvatarMapCache = {};
    }
    return _customAvatarMapCache;
  }

  function writeCustomAvatarMap(map) {
    localStorage.setItem(WC_L_CUSTOM_AVATAR_KEY, JSON.stringify(map));
    _customAvatarMapCache = map;
  }

  function getCustomAvatarDataUrl(userId) {
    const s = readCustomAvatarMap()[String(userId)];
    return typeof s === "string" && s.startsWith("data:image/") ? s : "";
  }

  function setCustomAvatarDataUrl(userId, dataUrl) {
    const map = { ...readCustomAvatarMap() };
    map[String(userId)] = dataUrl;
    try {
      writeCustomAvatarMap(map);
    } catch {
      throw new Error("quota");
    }
  }

  function downscaleImageFileToDataUrl(file, maxEdge, maxChars, minQuality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read"));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          try {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            if (!w || !h) {
              reject(new Error("size"));
              return;
            }
            const scale = Math.min(1, maxEdge / Math.max(w, h));
            const cw = Math.max(1, Math.round(w * scale));
            const ch = Math.max(1, Math.round(h * scale));
            const canvas = document.createElement("canvas");
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("canvas"));
              return;
            }
            ctx.drawImage(img, 0, 0, cw, ch);
            let q = 0.88;
            let dataUrl = canvas.toDataURL("image/jpeg", q);
            const floor = minQuality != null ? minQuality : 0.42;
            while (dataUrl.length > maxChars && q > floor) {
              q -= 0.08;
              dataUrl = canvas.toDataURL("image/jpeg", q);
            }
            if (dataUrl.length > maxChars) {
              reject(new Error("large"));
              return;
            }
            resolve(dataUrl);
          } catch (e) {
            reject(e);
          }
        };
        img.onerror = () => reject(new Error("decode"));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function getMcVariantDef(variantId) {
    for (let i = 0; i < MC_AVATAR_VARIANTS.length; i += 1) {
      if (MC_AVATAR_VARIANTS[i].id === variantId) return MC_AVATAR_VARIANTS[i];
    }
    for (let i = 0; i < MC_AVATAR_VARIANTS.length; i += 1) {
      if (MC_AVATAR_VARIANTS[i].id === DEFAULT_MC_AVATAR_VARIANT) return MC_AVATAR_VARIANTS[i];
    }
    return MC_AVATAR_VARIANTS[0];
  }

  function getStoredMcVariant(userId) {
    const v = readMcAvatarMap()[String(userId)];
    if (v) {
      for (let i = 0; i < MC_AVATAR_VARIANTS.length; i += 1) {
        if (MC_AVATAR_VARIANTS[i].id === v) {
          if (v === "custom_upload" && !getCustomAvatarDataUrl(userId)) return DEFAULT_MC_AVATAR_VARIANT;
          return v;
        }
      }
    }
    return DEFAULT_MC_AVATAR_VARIANT;
  }

  function setStoredMcVariant(userId, variantId) {
    let ok = false;
    for (let i = 0; i < MC_AVATAR_VARIANTS.length; i += 1) {
      if (MC_AVATAR_VARIANTS[i].id === variantId) {
        ok = true;
        break;
      }
    }
    if (!ok) return;
    const map = { ...readMcAvatarMap() };
    map[String(userId)] = variantId;
    writeMcAvatarMap(map);
  }

  function minecraftValidUsername(username) {
    return /^[a-zA-Z0-9_]{3,16}$/.test(String(username).trim());
  }

  /** Имя скина для fallback (minotar и т.д.): по варианту или по нику сайта. */
  function effectiveMcSkinName(username, variantId) {
    const v = getMcVariantDef(variantId);
    if (v.headName != null) return v.headName;
    const u = String(username).trim();
    if (minecraftValidUsername(u)) return u;
    return "Steve";
  }

  /**
   * «По нику»: при невалидном нике — bust Steve (fallback); при нике Steve — helm вместо avatar.
   */
  function buildMcAvatarUrl(username, variantId, size, userId) {
    const v = getMcVariantDef(variantId);
    if (v.id === "custom_upload") {
      return userId != null ? getCustomAvatarDataUrl(Number(userId)) : "";
    }
    if (v.asset) {
      return localStaticUrl(v.asset);
    }
    if (v.headName != null) {
      return `https://mc-heads.net/avatar/${encodeURIComponent(v.headName)}/${size}`;
    }
    const u = String(username).trim();
    if (minecraftValidUsername(u)) {
      if (u.toLowerCase() === "steve") {
        return `https://mc-heads.net/helm/${encodeURIComponent(u)}/${size}`;
      }
      return `https://mc-heads.net/avatar/${encodeURIComponent(u)}/${size}`;
    }
    return `https://mc-heads.net/bust/Steve/${size}`;
  }

  function mcAvatarMenuTileSrc(username, v, userId) {
    if (v.id === "custom_upload") {
      const d = userId != null ? getCustomAvatarDataUrl(Number(userId)) : "";
      return d || CUSTOM_AVATAR_MENU_PLACEHOLDER_SRC;
    }
    return buildMcAvatarUrl(username, v.id, MC_HEAD_MENU, userId);
  }

  function dedupeAvatarUrls(urls) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < urls.length; i += 1) {
      const u = urls[i];
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  }

  /** Если mc-heads недоступен — minotar, потом запасной Steve; иначе остаются инициалы (например «AD» у admin). */
  function avatarUrlChain(username, variantId, size, userId) {
    const v = getMcVariantDef(variantId);
    if (v.id === "custom_upload") {
      const d = userId != null ? getCustomAvatarDataUrl(Number(userId)) : "";
      return d ? [d] : [];
    }
    if (v.asset) {
      return [localStaticUrl(v.asset)];
    }
    const primary = buildMcAvatarUrl(username, variantId, size, userId);
    const skin = effectiveMcSkinName(username, variantId);
    return dedupeAvatarUrls([
      primary,
      `https://minotar.net/avatar/${encodeURIComponent(skin)}/${size}`,
      `https://minotar.net/helm/${encodeURIComponent(skin)}/${size}`,
      `https://mc-heads.net/avatar/Steve/${size}`,
    ]);
  }

  function renderMcAvatarMenuHtml(username, currentVariantId, userId) {
    const tiles = MC_AVATAR_VARIANTS.map((v) => {
      const sel = v.id === currentVariantId ? " is-selected" : "";
      const src = mcAvatarMenuTileSrc(username, v, userId);
      const title = escapeHtml(v.label);
      return `<button type="button" class="profile-avatar-tile${sel}" role="menuitem" data-mc-variant="${v.id}" title="${title}" aria-label="${title}">
        <img src="${src}" alt="" width="${MC_HEAD_MENU}" height="${MC_HEAD_MENU}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      </button>`;
    }).join("");
    return `<div class="profile-avatar-menu hidden" id="profile-avatar-menu" role="menu" aria-label="Выбор головы Minecraft" aria-hidden="true">
      <div class="profile-avatar-menu-grid" role="group">${tiles}</div>
    </div>`;
  }

  function bindProfileAvatarImage(box, username, variantId) {
    const frame = box.querySelector(".profile-avatar-frame");
    const img = box.querySelector(".profile-avatar-img");
    if (!img || !frame) return;
    const uid = box.dataset.profileUserId !== undefined ? Number(box.dataset.profileUserId, 10) : null;
    const chain = avatarUrlChain(username, variantId, MC_HEAD_MAIN, uid);
    if (!chain.length) {
      img.classList.add("is-hidden");
      frame.classList.add("show-fallback");
      return;
    }
    let attempt = 0;
    img.onload = function () {
      img.classList.remove("is-hidden");
      frame.classList.remove("show-fallback");
    };
    img.onerror = function () {
      attempt += 1;
      if (attempt < chain.length) {
        img.src = chain[attempt];
        return;
      }
      img.classList.add("is-hidden");
      frame.classList.add("show-fallback");
    };
  }

  function bindMcAvatarMenuTiles(root) {
    const menu = root.querySelector("#profile-avatar-menu");
    const un = root.dataset.profileUsername;
    const uid = root.dataset.profileUserId !== undefined ? Number(root.dataset.profileUserId, 10) : null;
    if (!menu || un === undefined) return;
    menu.querySelectorAll(".profile-avatar-tile img").forEach((imgEl) => {
      const tile = imgEl.closest("[data-mc-variant]");
      const variantId = tile?.getAttribute("data-mc-variant");
      if (!variantId) return;
      const chain = avatarUrlChain(un, variantId, MC_HEAD_MENU, uid);
      if (!chain.length) {
        imgEl.onload = function () {
          imgEl.style.opacity = "";
        };
        return;
      }
      let attempt = 0;
      imgEl.onerror = function () {
        attempt += 1;
        if (attempt < chain.length) {
          imgEl.src = chain[attempt];
          return;
        }
        imgEl.style.opacity = "0.35";
      };
      imgEl.onload = function () {
        imgEl.style.opacity = "";
      };
    });
  }

  function setMainProfileAvatar(box, username, variantId) {
    const img = box.querySelector(".profile-avatar-img");
    const frame = box.querySelector(".profile-avatar-frame");
    if (!img || !frame) return;
    frame.setAttribute("data-avatar-variant", variantId);
    const uid = box.dataset.profileUserId !== undefined ? Number(box.dataset.profileUserId, 10) : null;
    const chain = avatarUrlChain(username, variantId, MC_HEAD_MAIN, uid);
    frame.classList.remove("show-fallback");
    img.classList.remove("is-hidden");
    if (!chain.length) {
      img.removeAttribute("src");
      img.classList.add("is-hidden");
      frame.classList.add("show-fallback");
      bindProfileAvatarImage(box, username, variantId);
      return;
    }
    img.src = chain[0];
    bindProfileAvatarImage(box, username, variantId);
  }

  function closeMcAvatarMenu() {
    const menu = document.getElementById("profile-avatar-menu");
    const editBtn = document.getElementById("profile-avatar-edit-btn");
    if (menu) {
      menu.classList.add("hidden");
      menu.setAttribute("aria-hidden", "true");
    }
    if (editBtn) editBtn.setAttribute("aria-expanded", "false");
  }

  document.body.addEventListener("click", (e) => {
    const uploadBtn = e.target.closest("#profile-avatar-upload-btn");
    if (uploadBtn && document.getElementById("profile-content")?.contains(uploadBtn)) {
      e.stopPropagation();
      document.getElementById("profile-avatar-file-input")?.click();
      return;
    }

    const editBtn = e.target.closest("#profile-avatar-edit-btn");
    if (editBtn && document.getElementById("profile-content")?.contains(editBtn)) {
      e.stopPropagation();
      const menu = document.getElementById("profile-avatar-menu");
      if (!menu) return;
      const open = menu.classList.contains("hidden");
      if (open) {
        closeProfileFrameMenu();
        menu.classList.remove("hidden");
        menu.setAttribute("aria-hidden", "false");
        editBtn.setAttribute("aria-expanded", "true");
      } else {
        closeMcAvatarMenu();
      }
      return;
    }

    const frameBtn = e.target.closest("#profile-frame-edit-btn");
    if (frameBtn && document.getElementById("profile-content")?.contains(frameBtn)) {
      e.stopPropagation();
      const menu = document.getElementById("profile-frame-menu");
      if (!menu) return;
      const willOpen = menu.classList.contains("hidden");
      if (willOpen) {
        closeMcAvatarMenu();
        menu.classList.remove("hidden");
        menu.setAttribute("aria-hidden", "false");
        frameBtn.setAttribute("aria-expanded", "true");
      } else {
        closeProfileFrameMenu();
      }
      return;
    }

    const item = e.target.closest("[data-mc-variant]");
    const root = document.getElementById("profile-content");
    if (item && root?.contains(item)) {
      e.stopPropagation();
      const userId = root.dataset.profileUserId;
      const username = root.dataset.profileUsername;
      if (userId === undefined || username === undefined) return;
      const variantId = item.getAttribute("data-mc-variant");
      if (!variantId || !MC_AVATAR_VARIANTS.some((v) => v.id === variantId)) return;
      if (variantId === "custom_upload" && !getCustomAvatarDataUrl(Number(userId, 10))) {
        document.getElementById("profile-avatar-file-input")?.click();
        return;
      }
      setStoredMcVariant(Number(userId), variantId);
      setMainProfileAvatar(root, username, variantId);
      root.querySelectorAll("[data-mc-variant]").forEach((el) => {
        el.classList.toggle("is-selected", el.getAttribute("data-mc-variant") === variantId);
      });
      closeMcAvatarMenu();
    }

    const frameItem = e.target.closest("[data-profile-frame]");
    const frameRoot = document.getElementById("profile-content");
    if (frameItem && frameRoot?.contains(frameItem)) {
      e.stopPropagation();
      const userIdStr = frameRoot.dataset.profileUserId;
      if (userIdStr === undefined) return;
      const frameId = frameItem.getAttribute("data-profile-frame");
      if (!frameId || !PROFILE_FRAME_VARIANTS.some((v) => v.id === frameId)) return;
      const uid = Number(userIdStr, 10);
      setStoredProfileFrame(uid, frameId);
      applyProfileFrameOverlay(frameRoot, uid);
      frameRoot.querySelectorAll("[data-profile-frame]").forEach((el) => {
        el.classList.toggle("is-selected", el.getAttribute("data-profile-frame") === frameId);
      });
      closeProfileFrameMenu();
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".profile-avatar-shell")) return;
    closeMcAvatarMenu();
    closeProfileFrameMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMcAvatarMenu();
      closeProfileFrameMenu();
    }
  });

  document.getElementById("profile-avatar-file-input")?.addEventListener("change", async (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    input.value = "";
    if (!file || !String(file.type || "").startsWith("image/")) return;
    const root = document.getElementById("profile-content");
    const userIdStr = root && root.dataset.profileUserId;
    if (!root || userIdStr === undefined) return;
    const uid = Number(userIdStr, 10);
    const username = root.dataset.profileUsername;
    const msg = document.getElementById("profile-message");
    try {
      const dataUrl = await downscaleImageFileToDataUrl(file, 256, 480000, 0.42);
      setCustomAvatarDataUrl(uid, dataUrl);
      setStoredMcVariant(uid, "custom_upload");
      if (username !== undefined) {
        setMainProfileAvatar(root, username, "custom_upload");
        root.querySelectorAll("[data-mc-variant]").forEach((el) => {
          el.classList.toggle("is-selected", el.getAttribute("data-mc-variant") === "custom_upload");
        });
        const tileImg = root.querySelector('[data-mc-variant="custom_upload"] img');
        if (tileImg) tileImg.src = dataUrl;
        bindMcAvatarMenuTiles(root);
        closeMcAvatarMenu();
      }
      if (msg) {
        msg.className = "flash";
        msg.textContent = "";
      }
    } catch (err) {
      const code = err && err.message;
      if (msg) {
        msg.className = "flash flash-error";
        if (code === "quota") {
          msg.textContent = "Не хватает места в хранилище браузера. Освободите данные сайта или выберите файл меньше.";
        } else if (code === "large") {
          msg.textContent = "Файл слишком большой после сжатия. Выберите другое изображение.";
        } else {
          msg.textContent = "Не удалось загрузить изображение. Попробуйте другой файл (JPG, PNG).";
        }
      }
    }
  });

  function profileInitials(username) {
    const t = String(username || "").trim();
    if (!t) return "?";
    const segs = t.split(/[\s_]+/).filter(Boolean);
    if (segs.length >= 2) return (segs[0][0] + segs[1][0]).toUpperCase();
    return t.slice(0, 2).toUpperCase();
  }

  function profileHue(username) {
    let h = 2166136261;
    const s = String(username || "");
    for (let i = 0; i < s.length; i += 1) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    return Math.abs(h) % 360;
  }

  async function loadProfile() {
    const box = document.getElementById("profile-content");
    const msg = document.getElementById("profile-message");
    if (!box) return;
    box.innerHTML = "";
    delete box.dataset.profileUserId;
    delete box.dataset.profileUsername;
    msg.textContent = "";
    msg.className = "flash";
    if (!getToken()) {
      showView("login");
      return;
    }
    try {
      const me = await fetchAuthMeCached();
      if (!me) {
        showView("login");
        return;
      }
      const variantId = getStoredMcVariant(me.id);
      const profileFrameId = getStoredProfileFrame(me.id);
      const hue = profileHue(me.username);
      const initials = escapeHtml(profileInitials(me.username));
      const avatarChain = avatarUrlChain(me.username, variantId, MC_HEAD_MAIN, me.id);
      const avatarUrl =
        avatarChain[0] ||
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

      const guardianBadge = me.is_admin
        ? '<span class="profile-badge profile-badge-guardian">Хранитель</span>'
        : '<span class="profile-badge">Игрок</span>';
      const banBadge = me.is_banned
        ? '<span class="profile-badge profile-badge-exile">Изгнан</span>'
        : '<span class="profile-badge profile-badge-warden">В цитадели</span>';

      const adminBlock = me.is_admin
        ? '<div class="profile-hero-admin"><button type="button" class="btn btn-primary" data-nav="admin">Зал хранителей</button></div>'
        : "";

      box.innerHTML = `
        <div class="profile-layout">
          <div class="profile-top-band">
            <div class="profile-top-inner">
              <div class="profile-avatar-shell">
                <div class="profile-avatar-column">
                  <div class="profile-avatar-stack">
                    <div class="profile-avatar-frame" data-avatar-variant="${escapeHtml(variantId)}" style="--avatar-hue: ${hue}">
                      <div class="profile-avatar-inner">
                        <img class="profile-avatar-img" src="${avatarUrl}" alt="" width="${MC_HEAD_MAIN}" height="${MC_HEAD_MAIN}" loading="eager" decoding="async" fetchpriority="high" referrerpolicy="no-referrer" />
                        <div class="profile-avatar-fallback" aria-hidden="true">${initials}</div>
                      </div>
                    </div>
                    <img class="profile-avatar-frame-deco is-hidden" alt="" width="${MC_HEAD_MAIN}" height="${MC_HEAD_MAIN}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
                  </div>
                  <div class="profile-avatar-bookmarks" role="toolbar" aria-label="Голова Minecraft, рамка, свой аватар">
                    <div class="profile-avatar-bookmark">
                      <div class="profile-avatar-bookmark-tab">
                        <button type="button" class="profile-avatar-edit-btn" id="profile-avatar-edit-btn" aria-expanded="false" aria-controls="profile-avatar-menu" aria-haspopup="true" title="Выбрать голову Minecraft">✎</button>
                      </div>
                      ${renderMcAvatarMenuHtml(me.username, variantId, me.id)}
                    </div>
                    <div class="profile-avatar-bookmark">
                      <div class="profile-avatar-bookmark-tab">
                        <button type="button" class="profile-avatar-frame-btn" id="profile-frame-edit-btn" aria-expanded="false" aria-controls="profile-frame-menu" aria-haspopup="true" title="Рамка аватара" aria-label="Выбор рамки">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><rect x="7" y="7" width="10" height="10" rx="1" ry="1"/></svg>
                        </button>
                      </div>
                      ${renderProfileFrameMenuHtml(profileFrameId)}
                    </div>
                    <div class="profile-avatar-bookmark">
                      <div class="profile-avatar-bookmark-tab">
                        <button type="button" class="profile-avatar-upload-btn" id="profile-avatar-upload-btn" title="Загрузить аватар с устройства" aria-label="Загрузить аватар с устройства">
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5l6.74-6.74z"/><line x1="16" y1="8" x2="2" y2="22"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="profile-top-main">
                <h3 class="profile-hero-name">${escapeHtml(me.username)}</h3>
                <div class="profile-hero-badges">${guardianBadge}${banBadge}</div>
                ${adminBlock}
              </div>
            </div>
            <div class="profile-top-divider" aria-hidden="true"></div>
          </div>
          <div class="profile-cabinet-spacer" aria-hidden="true"></div>
        </div>
      `;

      box.dataset.profileUserId = String(me.id);
      box.dataset.profileUsername = me.username;
      bindProfileAvatarImage(box, me.username, variantId);
      bindMcAvatarMenuTiles(box);
      applyProfileFrameOverlay(box, me.id);
    } catch (err) {
      msg.classList.add("flash-error");
      msg.textContent = err.message;
    }
  }

  function adminUsersQuery() {
    const r = document.querySelector('input[name="admin-filter"]:checked');
    if (!r) return "";
    if (r.value === "admins") return "?is_admin=true";
    if (r.value === "players") return "?is_admin=false";
    return "";
  }

  async function loadAdminUsers() {
    const tbody = document.querySelector("#admin-users tbody");
    const msg = document.getElementById("admin-message");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (msg) {
      msg.textContent = "";
      msg.className = "flash";
    }
    if (!getToken()) {
      showView("login");
      return;
    }
    try {
      const me = await fetchAuthMeCached();
      if (!me) {
        showView("login");
        return;
      }
      const myId = me.id;
      const users = await apiFetch("/admin/users" + adminUsersQuery());
      users.forEach((u) => {
        const tr = document.createElement("tr");
        const isSelf = u.id === myId;
        let actionsHtml;
        if (isSelf) {
          actionsHtml = '<span style="color:var(--text-muted);font-size:0.9rem">Это вы</span>';
        } else {
          const banBtn = u.is_banned
            ? `<button type="button" class="btn btn-small" data-act="ban" data-id="${u.id}" data-to="false">Снять бан</button>`
            : `<button type="button" class="btn btn-small btn-danger" data-act="ban" data-id="${u.id}" data-to="true">Бан</button>`;
          const admBtn = u.is_admin
            ? `<button type="button" class="btn btn-small" data-act="admin" data-id="${u.id}" data-to="false">Снять админа</button>`
            : `<button type="button" class="btn btn-small btn-primary" data-act="admin" data-id="${u.id}" data-to="true">Сделать админом</button>`;
          actionsHtml = `<div class="admin-actions-inner">${banBtn}${admBtn}</div>`;
        }
        tr.innerHTML = `
          <td>${u.id}</td>
          <td>${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.email)}</td>
          <td><span class="badge ${u.is_admin ? "badge-yes" : "badge-no"}">${u.is_admin ? "Да" : "Нет"}</span></td>
          <td><span class="badge ${u.is_banned ? "badge-yes" : "badge-no"}">${u.is_banned ? "Да" : "Нет"}</span></td>
          <td class="admin-actions">${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      if (msg) {
        msg.classList.add("flash-error");
        msg.textContent = err.message;
      }
    }
  }

  document.querySelectorAll('input[name="admin-filter"]').forEach((inp) => {
    inp.addEventListener("change", () => {
      if (views.admin && views.admin.classList.contains("is-visible")) loadAdminUsers();
    });
  });

  document.getElementById("btn-admin-refresh")?.addEventListener("click", () => loadAdminUsers());

  document.querySelector("#admin-users tbody")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    const id = Number(btn.getAttribute("data-id"), 10);
    const toTrue = btn.getAttribute("data-to") === "true";
    const msg = document.getElementById("admin-message");
    btn.disabled = true;
    try {
      if (act === "ban") {
        await apiFetch(`/admin/users/${id}/ban`, { method: "PATCH", body: { is_banned: toTrue } });
      } else if (act === "admin") {
        await apiFetch(`/admin/users/${id}/admin`, { method: "PATCH", body: { is_admin: toTrue } });
      }
      if (msg) {
        msg.className = "flash flash-success";
        msg.textContent = "Сохранено.";
      }
      await loadAdminUsers();
      updateAuthNav();
    } catch (err) {
      if (msg) {
        msg.className = "flash flash-error";
        msg.textContent = err.message;
      }
    } finally {
      btn.disabled = false;
    }
  });

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  document.getElementById("btn-copy-ip")?.addEventListener("click", () => {
    const ip = document.getElementById("server-ip")?.textContent?.trim() || "";
    navigator.clipboard.writeText(ip).then(
      () => {
        const el = document.getElementById("copy-ip-feedback");
        if (el) {
          el.textContent = "Скопировано в свиток!";
          setTimeout(() => {
            el.textContent = "";
          }, 2000);
        }
      },
      () => {}
    );
  });

  const profileModalOverlay = document.getElementById("profile-modal-overlay");
  const profileModalChange = document.getElementById("profile-modal-change-name");
  const profileModalPasswordHint = document.getElementById("profile-modal-password-hint");
  const profileModalForgot = document.getElementById("profile-modal-forgot");

  function closeProfileModals() {
    if (!profileModalOverlay) return;
    profileModalOverlay.classList.add("hidden");
    profileModalOverlay.setAttribute("aria-hidden", "true");
    profileModalChange?.classList.add("hidden");
    profileModalPasswordHint?.classList.add("hidden");
    profileModalForgot?.classList.add("hidden");
  }

  function openPasswordHintModal() {
    if (!profileModalOverlay || !profileModalPasswordHint) return;
    profileModalChange?.classList.add("hidden");
    profileModalForgot?.classList.add("hidden");
    profileModalPasswordHint.classList.remove("hidden");
    profileModalOverlay.classList.remove("hidden");
    profileModalOverlay.setAttribute("aria-hidden", "false");
  }

  function openChangeNameModal() {
    if (!profileModalOverlay || !profileModalChange) return;
    profileModalPasswordHint?.classList.add("hidden");
    profileModalForgot?.classList.add("hidden");
    profileModalChange.classList.remove("hidden");
    profileModalOverlay.classList.remove("hidden");
    profileModalOverlay.setAttribute("aria-hidden", "false");
    const mini = document.getElementById("profile-modal-change-msg");
    if (mini) {
      mini.textContent = "";
      mini.className = "flash";
    }
    fetchAuthMeCached()
      .then((me) => {
        const inp = document.getElementById("input-profile-username");
        if (inp && me) inp.value = me.username;
        inp?.focus();
      })
      .catch(() => {});
  }

  function openForgotModal() {
    if (!profileModalOverlay || !profileModalForgot) return;
    profileModalChange?.classList.add("hidden");
    profileModalPasswordHint?.classList.add("hidden");
    profileModalForgot.classList.remove("hidden");
    profileModalOverlay.classList.remove("hidden");
    profileModalOverlay.setAttribute("aria-hidden", "false");
  }

  document.getElementById("view-profile")?.addEventListener("click", (e) => {
    if (e.target.closest("#btn-profile-change-name")) {
      if (!getToken()) {
        showView("login");
        return;
      }
      openChangeNameModal();
      return;
    }
    if (e.target.closest("#btn-profile-change-password")) {
      if (!getToken()) {
        showView("login");
        return;
      }
      openPasswordHintModal();
      return;
    }
  });

  document.getElementById("btn-profile-password-hint-cancel")?.addEventListener("click", closeProfileModals);
  document.getElementById("btn-profile-password-hint-to-forgot")?.addEventListener("click", openForgotModal);

  document.getElementById("btn-profile-modal-cancel")?.addEventListener("click", closeProfileModals);
  document.getElementById("btn-profile-forgot-close")?.addEventListener("click", closeProfileModals);
  document.getElementById("profile-modal-scrim")?.addEventListener("click", closeProfileModals);

  document.getElementById("form-profile-change-username")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("profile-modal-change-msg");
    const fd = new FormData(e.target);
    const username = String(fd.get("username") || "").trim();
    if (username.length < 3) {
      if (msg) {
        msg.className = "flash flash-error";
        msg.textContent = "Минимум 3 символа в имени.";
      }
      return;
    }
    if (msg) {
      msg.textContent = "";
      msg.className = "flash";
    }
    try {
      await apiFetch("/auth/me", { method: "PATCH", body: { username } });
      invalidateAuthMeCache();
      updateAuthNav();
      closeProfileModals();
      const pm = document.getElementById("profile-message");
      if (pm) {
        pm.className = "flash flash-success";
        pm.textContent = "Имя героя обновлено.";
      }
      if (document.body.getAttribute("data-view") === "profile") loadProfile();
    } catch (err) {
      if (msg) {
        msg.className = "flash flash-error";
        const detail = err.message || "";
        const ru =
          detail === "Username already taken"
            ? "Это имя уже занято."
            : detail === "This username is reserved"
              ? "Это имя зарезервировано."
              : detail === "Username must be at least 3 characters"
                ? "Минимум 3 символа в имени."
                : detail;
        msg.textContent = ru;
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!profileModalOverlay || profileModalOverlay.classList.contains("hidden")) return;
    closeProfileModals();
  });

  /** Фоновые монеты: координаты страницы (скролл), столкновения, звёзды-GIF при ударе. */
  (function initGoldOrbs() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const layer = document.createElement("div");
    layer.className = "fx-orbs-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.prepend(layer);

    const conn = typeof navigator !== "undefined" ? navigator.connection : undefined;
    const saveData = conn && conn.saveData;
    const lowCpu =
      typeof navigator !== "undefined" &&
      navigator.hardwareConcurrency != null &&
      navigator.hardwareConcurrency > 0 &&
      navigator.hardwareConcurrency <= 4;
    let count = window.matchMedia("(max-width: 640px)").matches ? 7 : 11;
    if (saveData || lowCpu) count = Math.min(count, 6);
    const particles = [];
    let mx = 0;
    let my = 0;
    let w0 = window.innerWidth;
    let h0 = document.documentElement.scrollHeight;
    let hbCache = 0;
    let ftCache = 0;

    function syncLayerHeight() {
      h0 = document.documentElement.scrollHeight;
      w0 = window.innerWidth;
    }

    function refreshLayoutMetrics() {
      syncLayerHeight();
      hbCache = headerBottomDocY();
      ftCache = footerTopDocY();
    }

    let layoutRaf = 0;
    function scheduleLayoutRefresh() {
      if (layoutRaf) return;
      layoutRaf = requestAnimationFrame(() => {
        layoutRaf = 0;
        refreshLayoutMetrics();
      });
    }

    /** Нижний край шапки (лого, навигация) в координатах документа — монеты не выше этого уровня */
    function headerBottomDocY() {
      const el = document.querySelector(".site-header");
      if (!el) return 0;
      return el.getBoundingClientRect().bottom + window.scrollY;
    }

    /** Верхний край полосы футера — монеты не ниже (как «рамка» снизу, симметрично шапке) */
    function footerTopDocY() {
      const el = document.querySelector(".site-footer-band");
      if (!el) return document.documentElement.scrollHeight;
      return el.getBoundingClientRect().top + window.scrollY;
    }

    let pmRaf = 0;
    let pmLast = null;
    document.addEventListener(
      "pointermove",
      (e) => {
        pmLast = e;
        if (pmRaf) return;
        pmRaf = requestAnimationFrame(() => {
          pmRaf = 0;
          if (!pmLast) return;
          mx = pmLast.clientX + window.scrollX;
          my = pmLast.clientY + window.scrollY;
        });
      },
      { passive: true }
    );

    const ORB_MAX_SPEED = 2.8;
    /** Лёгкий случайный дрейф, чтобы монеты медленно ползли без курсора */
    const ORB_IDLE_DRIFT = 0.024;
    const WALL_BOUNCE = 0.88;
    const COIN_RESTITUTION = 0.82;
    const STAR_GIF_NAMES = [
      "звизда 1.gif",
      "звезда 2_export_Анимация.gif",
      "звезда 3.gif",
      "звезда 4.gif",
    ];
    function starGifUrl(index) {
      return "static/img/" + encodeURIComponent(STAR_GIF_NAMES[index]);
    }
    let sparksThisFrame = 0;
    const SPARK_CAP_PER_FRAME = 24;
    const pairSparkNext = Object.create(null);

    const STAR_STAGGER_MS = 55;
    const ORB_SIZE_PX = 40;

    /** На удар — ровно 4 звезды с небольшой задержкой между появлениями */
    function spawnSparks(px, py) {
      for (let s = 0; s < 4; s += 1) {
        window.setTimeout(() => {
          if (sparksThisFrame >= SPARK_CAP_PER_FRAME) return;
          sparksThisFrame += 1;
          const idx = Math.floor(Math.random() * 4);
          const wrap = document.createElement("span");
          wrap.className = "fx-spark";
          wrap.style.left = `${px + (Math.random() - 0.5) * 24}px`;
          wrap.style.top = `${py + (Math.random() - 0.5) * 24}px`;
          const ang = Math.random() * Math.PI * 2;
          const dist = 88 + Math.random() * 92;
          wrap.style.setProperty("--spark-tx", `${Math.cos(ang) * dist}px`);
          wrap.style.setProperty("--spark-ty", `${Math.sin(ang) * dist}px`);
          const img = document.createElement("img");
          img.src = starGifUrl(idx);
          img.alt = "";
          img.draggable = false;
          img.decoding = "async";
          wrap.appendChild(img);
          layer.appendChild(wrap);
          window.setTimeout(() => {
            if (wrap.parentNode) wrap.remove();
          }, 780);
        }, s * STAR_STAGGER_MS);
      }
    }

    refreshLayoutMetrics();
    mx = w0 * 0.5;
    my = h0 * 0.5;

    const r0 = ORB_SIZE_PX * 0.5;
    const pad0 = r0 + 10;
    const yMin0 = hbCache + pad0;
    let yMax0 = ftCache - pad0;
    if (yMax0 < yMin0 + 30) {
      yMax0 = h0 - pad0;
    }
    const ySpawnSpan = Math.max(40, yMax0 - yMin0);
    for (let i = 0; i < count; i += 1) {
      const el = document.createElement("div");
      el.className = "fx-orb";
      el.style.setProperty("--orb-size", `${ORB_SIZE_PX}px`);
      layer.appendChild(el);
      particles.push({
        el,
        r: r0,
        x: pad0 + Math.random() * Math.max(40, w0 - 2 * pad0),
        y: yMin0 + Math.random() * ySpawnSpan,
        vx: 0,
        vy: 0,
      });
    }

    window.addEventListener(
      "resize",
      () => {
        refreshLayoutMetrics();
        for (let i = 0; i < particles.length; i += 1) {
          const p = particles[i];
          const pad = p.r + 10;
          const yTop = hbCache + pad;
          let yBottom = ftCache - pad;
          if (yBottom <= yTop) {
            yBottom = h0 - pad;
          }
          p.x = Math.min(w0 - pad, Math.max(pad, p.x));
          p.y = Math.min(yBottom, Math.max(yTop, p.y));
        }
      },
      { passive: true }
    );

    window.addEventListener("scroll", scheduleLayoutRefresh, { passive: true });

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => scheduleLayoutRefresh()).observe(document.documentElement);
    }
    document.addEventListener("wc-l-layout-refresh", () => scheduleLayoutRefresh());

    let rafId = 0;
    let tickFrame = 0;
    function tick() {
      tickFrame += 1;
      sparksThisFrame = 0;
      const infl = Math.min(w0, h0) * 0.22;
      const hb = hbCache;
      const ft = ftCache;

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        const pad = p.r + 10;
        const yTop = hb + pad;
        let yBottom = ft - pad;
        if (yBottom <= yTop) {
          yBottom = h0 - pad;
        }
        const dx = p.x - mx;
        const dy = p.y - my;
        const d = Math.hypot(dx, dy);
        if (d < infl && d > 1) {
          const f = ((infl - d) / infl) ** 1.35;
          const inv = 1 / d;
          const kick = 2.4 * f;
          p.vx += dx * inv * kick;
          p.vy += dy * inv * kick;
        }
        p.vx += (Math.random() - 0.5) * ORB_IDLE_DRIFT;
        p.vy += (Math.random() - 0.5) * ORB_IDLE_DRIFT;
        p.vx *= 0.987;
        p.vy *= 0.987;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > ORB_MAX_SPEED) {
          p.vx = (p.vx / sp) * ORB_MAX_SPEED;
          p.vy = (p.vy / sp) * ORB_MAX_SPEED;
        }
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < pad) {
          p.x = pad;
          p.vx = Math.abs(p.vx) * WALL_BOUNCE;
        } else if (p.x > w0 - pad) {
          p.x = w0 - pad;
          p.vx = -Math.abs(p.vx) * WALL_BOUNCE;
        }
        if (p.y < yTop) {
          p.y = yTop;
          p.vy = Math.abs(p.vy) * WALL_BOUNCE;
        } else if (p.y > yBottom) {
          p.y = yBottom;
          p.vy = -Math.abs(p.vy) * WALL_BOUNCE;
        }
      }

      /* Сетка: при ~1000 монетах полный O(n²) неприемлем */
      const COLL_CELL = 64;
      const collisionPasses = count > 8 ? 2 : 1;
      for (let pass = 0; pass < collisionPasses; pass += 1) {
        const grid = new Map();
        for (let i = 0; i < particles.length; i += 1) {
          const p = particles[i];
          const key = `${Math.floor(p.x / COLL_CELL)},${Math.floor(p.y / COLL_CELL)}`;
          let bucket = grid.get(key);
          if (!bucket) {
            bucket = [];
            grid.set(key, bucket);
          }
          bucket.push(i);
        }
        for (let i = 0; i < particles.length; i += 1) {
          const p = particles[i];
          const cx = Math.floor(p.x / COLL_CELL);
          const cy = Math.floor(p.y / COLL_CELL);
          for (let dcx = -1; dcx <= 1; dcx += 1) {
            for (let dcy = -1; dcy <= 1; dcy += 1) {
              const bucket = grid.get(`${cx + dcx},${cy + dcy}`);
              if (!bucket) continue;
              for (let b = 0; b < bucket.length; b += 1) {
                const j = bucket[b];
                if (j <= i) continue;
                const q = particles[j];
                let dx = q.x - p.x;
                let dy = q.y - p.y;
                const minDist = p.r + q.r + 4;
                const minDistSq = minDist * minDist;
                const distSq = dx * dx + dy * dy;
                if (distSq < minDistSq && distSq > 0.0001) {
                  const dist = Math.sqrt(distSq);
                  const nx = dx / dist;
                  const ny = dy / dist;
                  const overlap = minDist - dist;
                  const sx = nx * overlap * 0.5;
                  const sy = ny * overlap * 0.5;
                  const rvx = q.vx - p.vx;
                  const rvy = q.vy - p.vy;
                  const vnBefore = rvx * nx + rvy * ny;
                  p.x -= sx;
                  p.y -= sy;
                  q.x += sx;
                  q.y += sy;
                  if (vnBefore < 0) {
                    const impulse = (-(1 + COIN_RESTITUTION) * vnBefore) / 2;
                    p.vx -= impulse * nx;
                    p.vy -= impulse * ny;
                    q.vx += impulse * nx;
                    q.vy += impulse * ny;
                  }
                  const pairKey = `${i},${j}`;
                  if (tickFrame >= (pairSparkNext[pairKey] || 0) && vnBefore < -0.12) {
                    pairSparkNext[pairKey] = tickFrame + 18;
                    spawnSparks((p.x + q.x) * 0.5, (p.y + q.y) * 0.5);
                  }
                }
              }
            }
          }
        }
      }

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        const pad = p.r + 10;
        const yTop = hb + pad;
        let yBottom = ft - pad;
        if (yBottom <= yTop) {
          yBottom = h0 - pad;
        }
        if (p.y < yTop) p.y = yTop;
        if (p.y > yBottom) p.y = yBottom;
      }

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        p.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`;
      }
      rafId = requestAnimationFrame(tick);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        cancelAnimationFrame(rafId);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    });
    rafId = requestAnimationFrame(tick);
  })();

  updateAuthNav();
  showView(readStoredView());
  checkApiStatus();
  /* Реже опрос health — меньше фоновых запросов при открытой вкладке. */
  setInterval(checkApiStatus, 120000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkApiStatus();
  });
})();
