/**
 * WC-L — клиент API и навигация по разделам (прототип без фреймворка).
 *
 * Live Server (любой порт, в т.ч. 8000 в .vscode): API на тот же host, порт 8000 (uvicorn).
 * Не держите Live Server и uvicorn на одном и том же порту — задайте window.WC_L_API_BASE.
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
    // Тот же хост :8000 с uvicorn — API относительным путём; иной локальный порт (Live/Vite) → бэкенд :8000.
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
    "forgot-password",
    "faq",
    "cooperation",
    "donations",
    "register",
    "profile",
    "admin",
    "processing",
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

  /** Путь относительно каталога static (например img/avatar-1.gif) — и с :8000, и с Live Server. */
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

  const views = {
    home: document.getElementById("view-home"),
    about: document.getElementById("view-about"),
    rules: document.getElementById("view-rules"),
    news: document.getElementById("view-news"),
    connect: document.getElementById("view-connect"),
    login: document.getElementById("view-login"),
    "forgot-password": document.getElementById("view-forgot-password"),
    faq: document.getElementById("view-faq"),
    cooperation: document.getElementById("view-cooperation"),
    donations: document.getElementById("view-donations"),
    register: document.getElementById("view-register"),
    profile: document.getElementById("view-profile"),
    admin: document.getElementById("view-admin"),
    processing: document.getElementById("view-processing"),
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
    if (typeof location !== "undefined" && location.protocol === "file:") {
      return "Откройте сайт по адресу http://127.0.0.1:8000/ (не двойной клик по index.html). Сначала в терминале: uvicorn app.main:app --reload";
    }
    if (API.startsWith("http://") || API.startsWith("https://")) {
      const u = new URL(API);
      return `Сервер не отвечает (${u.host}). В корне проекта: uvicorn app.main:app --reload — затем страница http://127.0.0.1:8000/ Если API на другом порту — задайте window.WC_L_API_BASE до загрузки app.js.`;
    }
    return "Сервер не отвечает. Запустите: uvicorn app.main:app --reload и откройте http://127.0.0.1:8000/";
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

  /** Часть локальной части email видна, остальное — звёздочки (до @). */
  function maskEmailHalf(email) {
    const s = String(email || "").trim();
    if (!s) return "•••@•••";
    const at = s.indexOf("@");
    if (at < 1) {
      const half = Math.ceil(s.length / 2);
      return s.slice(0, half) + "*".repeat(Math.max(2, s.length - half));
    }
    const local = s.slice(0, at);
    const domain = s.slice(at + 1);
    const vis = Math.max(1, Math.ceil(local.length / 2));
    const maskedLocal = local.slice(0, vis) + "*".repeat(Math.max(2, local.length - vis));
    return `${maskedLocal}@${domain}`;
  }

  function resetForgotPasswordUi() {
    const stepForm = document.getElementById("forgot-password-step-form");
    const stepSent = document.getElementById("forgot-password-step-sent");
    const msg = document.getElementById("forgot-password-message");
    const form = document.getElementById("form-forgot-password");
    if (stepForm) stepForm.classList.remove("hidden");
    if (stepSent) stepSent.classList.add("hidden");
    if (msg) {
      msg.textContent = "";
      msg.className = "flash";
    }
    form?.reset();
  }

  function resetCooperationUi() {
    const msg = document.getElementById("cooperation-message");
    const form = document.getElementById("form-cooperation");
    if (msg) {
      msg.textContent = "";
      msg.className = "flash";
    }
    form?.reset();
  }

  const staffState = {
    cache: { admin: null, processing: null },
    selectedId: { admin: null, processing: null },
    myId: null,
  };

  const STAFF_SELECTORS = {
    admin: {
      list: "admin-user-list",
      detail: "admin-user-detail",
      search: "admin-user-search",
      msg: "admin-message",
    },
    processing: {
      list: "processing-user-list",
      detail: "processing-user-detail",
      search: "processing-user-search",
      msg: "processing-message",
    },
  };

  function getStaffEls(mode) {
    const s = STAFF_SELECTORS[mode];
    if (!s) return null;
    return {
      list: document.getElementById(s.list),
      detail: document.getElementById(s.detail),
      search: document.getElementById(s.search),
      msg: document.getElementById(s.msg),
    };
  }

  function userMatchesStaffQuery(u, q) {
    const s = (q || "").trim().toLowerCase();
    if (!s) return true;
    return (
      (u.username && u.username.toLowerCase().includes(s)) ||
      (u.email && String(u.email).toLowerCase().includes(s)) ||
      String(u.id).includes(s)
    );
  }

  function syncStaffListAndDetail(mode) {
    const users = staffState.cache[mode];
    const els = getStaffEls(mode);
    if (!els || !els.list || !els.detail) return;
    if (!users) return;
    const q = els.search ? els.search.value : "";
    const filtered = users.filter((u) => userMatchesStaffQuery(u, q));
    const sel = staffState.selectedId[mode];
    if (sel != null && !filtered.some((u) => u.id === sel)) {
      staffState.selectedId[mode] = null;
    }
    renderStaffUserList(mode, users, q);
    const selId = staffState.selectedId[mode];
    const u = selId != null ? users.find((x) => x.id === selId) : null;
    renderStaffUserDetail(mode, u, staffState.myId);
  }

  function renderStaffUserList(mode, users, query) {
    const els = getStaffEls(mode);
    if (!els || !els.list) return;
    const filtered = users.filter((u) => userMatchesStaffQuery(u, query));
    const sel = staffState.selectedId[mode];
    els.list.innerHTML = "";
    filtered.forEach((u) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      const initials = escapeHtml(profileInitials(u.username));
      const hue = profileHue(u.username);
      const variantId = resolveMcVariantForUser(u);
      const chain = avatarUrlChain(u.username, variantId, 48, u.id);
      const avSrc = chain[0] || "";
      const isSel = sel === u.id;
      const imgOrPh = avSrc
        ? `<img src="${escapeHtml(avSrc)}" alt="" width="40" height="40" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
        : `<span class="staff-user-item-fallback">${initials}</span>`;
      li.innerHTML = `
        <button type="button" class="staff-user-item${isSel ? " is-selected" : ""}" data-staff-pick="${mode}" data-user-id="${u.id}">
          <div class="staff-user-item-avatar" style="--avatar-hue:${hue}">
            ${imgOrPh}
          </div>
          <span class="staff-user-item-text">
            <span class="staff-user-item-name">${escapeHtml(u.username)}</span>
            <span class="staff-user-item-sub">#${u.id} · ${escapeHtml(u.email || "—")}</span>
          </span>
        </button>
      `;
      els.list.appendChild(li);
    });
  }

  function renderStaffUserDetail(mode, u, myId) {
    const els = getStaffEls(mode);
    if (!els || !els.detail) return;
    if (!u) {
      els.detail.innerHTML = `<div class="staff-user-detail-empty"><p>Выберите игрока в списке слева.</p></div>`;
      return;
    }
    const isSelf = u.id === myId;
    const guardianBadge = u.is_admin
      ? '<span class="profile-badge profile-badge-guardian">Хранитель</span>'
      : '<span class="profile-badge">Игрок</span>';
    const banBadge = u.is_banned
      ? '<span class="profile-badge profile-badge-exile">Изгнан</span>'
      : '<span class="profile-badge profile-badge-warden">В цитадели</span>';

    const initials = escapeHtml(profileInitials(u.username));
    const hue = profileHue(u.username);
    const variantId = resolveMcVariantForUser(u);
    const chain = avatarUrlChain(u.username, variantId, MC_HEAD_MAIN, u.id);
    const avSrc = chain[0] || "";

    let actionsHtml = "";
    if (isSelf) {
      actionsHtml = '<p class="staff-detail-self-note">Это вы — действия с собой недоступны.</p>';
    } else {
      const banBtn = u.is_banned
        ? `<button type="button" class="btn btn-small" data-staff-act="ban" data-staff-mode="${mode}" data-user-id="${u.id}" data-to="false">Разбан</button>`
        : `<button type="button" class="btn btn-small btn-danger" data-staff-act="ban" data-staff-mode="${mode}" data-user-id="${u.id}" data-to="true">Бан</button>`;
      const admBtn = u.is_admin
        ? `<button type="button" class="btn btn-small" data-staff-act="admin" data-staff-mode="${mode}" data-user-id="${u.id}" data-to="false">Снять админа</button>`
        : `<button type="button" class="btn btn-small btn-primary" data-staff-act="admin" data-staff-mode="${mode}" data-user-id="${u.id}" data-to="true">Сделать админом</button>`;
      actionsHtml = `<div class="staff-detail-actions-inner">
        ${banBtn}
        ${admBtn}
        <button type="button" class="btn btn-small btn-ghost" disabled title="Скоро">Метки</button>
      </div>`;
    }

    els.detail.innerHTML = `
      <div class="staff-detail-card">
        <div class="staff-detail-top">
          <div class="staff-detail-avatar-wrap">
            <div class="profile-avatar-frame staff-detail-avatar-frame" data-avatar-variant="${escapeHtml(variantId)}" style="--avatar-hue:${hue}">
              <div class="profile-avatar-inner">
                ${avSrc ? `<img class="profile-avatar-img" src="${escapeHtml(avSrc)}" alt="" width="${MC_HEAD_MAIN}" height="${MC_HEAD_MAIN}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />` : ""}
                <div class="profile-avatar-fallback" aria-hidden="true">${initials}</div>
              </div>
            </div>
          </div>
          <div class="staff-detail-heading">
            <h3 class="staff-detail-name">${escapeHtml(u.username)}</h3>
          </div>
        </div>
        <dl class="staff-detail-dl">
          <div><dt>ID</dt><dd>${u.id}</dd></div>
          <div><dt>Email</dt><dd>${escapeHtml(u.email || "—")}</dd></div>
        </dl>
        <div class="staff-detail-badges-wrap" aria-labelledby="staff-badges-h-${mode}">
          <h4 id="staff-badges-h-${mode}" class="staff-detail-badges-title">Метки</h4>
          <div class="profile-hero-badges" aria-label="Роль и статус">${guardianBadge}${banBadge}</div>
        </div>
        <div class="staff-detail-actions">${actionsHtml}</div>
      </div>
    `;
    const card = els.detail.querySelector(".staff-detail-card");
    if (card && avSrc) {
      card.dataset.profileUserId = String(u.id);
      bindProfileAvatarImage(card, u.username, variantId);
    }
  }

  async function loadStaffUsers(mode, opts) {
    const keepSelection = opts && opts.keepSelection;
    const els = getStaffEls(mode);
    if (!els || !els.list) return;
    if (els.msg) {
      els.msg.textContent = "";
      els.msg.className = "flash";
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
      if (!me.is_admin) {
        showView("profile");
        return;
      }
      staffState.myId = me.id;
      const users = await apiFetch("/admin/users");
      staffState.cache[mode] = users;
      if (!keepSelection) {
        staffState.selectedId[mode] = null;
      }
      syncStaffListAndDetail(mode);
    } catch (err) {
      if (els.msg) {
        els.msg.classList.add("flash-error");
        els.msg.textContent = err.message;
      }
    }
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
    if (name === "admin") loadStaffUsers("admin");
    if (name === "forgot-password") resetForgotPasswordUi();
    if (name === "cooperation") resetCooperationUi();
    if (name === "processing") loadStaffUsers("processing");
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
        const data = await apiFetch("/auth/login", { method: "POST", body: { login, password } });
        if (!data.access_token) {
          throw new Error("Сервер не вернул токен входа.");
        }
        setToken(data.access_token);
        msg.classList.add("flash-success");
        msg.textContent = "Добро пожаловать в цитадель!";
        showView("profile");
      } catch (err) {
        msg.classList.add("flash-error");
        let text = err && err.message ? String(err.message) : "Ошибка входа";
        if (text === "Invalid credentials") text = "Неверный логин или пароль.";
        msg.textContent = text;
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

  document.getElementById("form-cooperation")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const msg = document.getElementById("cooperation-message");
    const fd = new FormData(form);
    const contact = String(fd.get("contact") || "").trim();
    const skills = String(fd.get("skills") || "").trim();
    if (contact.length < 3 || skills.length < 10) {
      if (msg) {
        msg.className = "flash flash-error";
        msg.textContent = "Заполните все поля заявки чуть подробнее.";
      }
      return;
    }
    if (msg) {
      msg.className = "flash flash-success";
      msg.textContent = "Заявка принята. После подключения системы обработки она будет доступна администраторам.";
    }
    // TODO(backend): отправлять заявку на сотрудничество админам и выводить её во вкладке обработки.
    form.reset();
  });

  /** Головы mc-heads.net; в меню только превью, подписи — в title (подсказка при наведении). */
  const MC_HEAD_MAIN = 128;
  /** Превью в меню «Внешний вид» (крупнее для сетки). */
  const MC_HEAD_MENU = 48;
  const MC_AVATAR_VARIANTS = Object.freeze([
    { id: "coin_spin", headName: null, label: "Монета", asset: "img/avatar-1.gif" },
    {
      id: "lep_pair",
      headName: null,
      label: "3lEP",
      asset: "img/avatar-2.gif",
    },
    { id: "pack_4p8p", headName: null, label: "4P8P", asset: "img/avatar-3.gif", combined: true },
    {
      id: "heart_pair",
      headName: null,
      label: "Сердце",
      asset: "img/avatar-4.gif",
      backgroundAsset: "img/avatar-bg-1.gif",
    },
    { id: "cat_combo", headName: null, label: "Кот", asset: "img/avatar-5.gif", combined: true },
    {
      id: "diamond_pair",
      headName: null,
      label: "Алмаз",
      asset: "img/avatar-6.gif",
      backgroundAsset: "img/avatar-bg-2.gif",
    },
    { id: "chicken", headName: "MHF_Chicken", label: "Курица" },
    { id: "pig", headName: "MHF_Pig", label: "Свинья" },
  ]);
  /** Раньше был «По нику» (скин mc-heads); теперь по умолчанию — монета. */
  const DEFAULT_MC_AVATAR_VARIANT = "coin_spin";
  const MC_AVATAR_STORAGE_KEY = "wc_l_mc_avatar_variant_by_user";
  /** Декоративная рамка поверх аватарки (PNG поверх круга). */
  const PROFILE_FRAME_VARIANTS = Object.freeze([
    { id: "none", label: "Без рамки", asset: null },
    { id: "pngwing_1", label: "Рамка 1", asset: "img/avatar-frame-1.png" },
  ]);
  const DEFAULT_PROFILE_FRAME = "none";
  const PROFILE_FRAME_STORAGE_KEY = "wc_l_profile_frame_by_user";

  let _mcAvatarMapCache = null;
  let _profileFrameMapCache = null;
  window.addEventListener("storage", (e) => {
    if (e.key === MC_AVATAR_STORAGE_KEY) _mcAvatarMapCache = null;
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

  function renderProfileFrameTilesHtml(currentFrameId, tileSize) {
    const sz = tileSize != null ? tileSize : MC_HEAD_MENU;
    return PROFILE_FRAME_VARIANTS.map((v) => {
      const sel = v.id === currentFrameId ? " is-selected" : "";
      const title = escapeHtml(v.label);
      let inner = "";
      if (v.id === "none") {
        inner = '<span class="profile-frame-tile-none" aria-hidden="true">—</span>';
      } else if (v.asset) {
        const src = localStaticUrl(v.asset);
        inner = `<img src="${src}" alt="" width="${sz}" height="${sz}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`;
      }
      return `<button type="button" class="profile-frame-tile${sel}" role="menuitem" data-profile-frame="${v.id}" title="${title}" aria-label="${title}">${inner}</button>`;
    }).join("");
  }

  /** Одно меню: сверху вкладки «Аватар» / «Рамка», ниже сетка. */
  function renderProfileLookMenuHtml(username, currentVariantId, userId, currentFrameId) {
    const avatarTiles = MC_AVATAR_VARIANTS.map((v) => {
      const sel = v.id === currentVariantId ? " is-selected" : "";
      const src = mcAvatarMenuTileSrc(username, v, userId);
      const title = escapeHtml(v.label);
      return `<button type="button" class="profile-avatar-tile${sel}" role="menuitem" data-mc-variant="${v.id}" title="${title}" aria-label="${title}">
        <img src="${src}" alt="" width="${MC_HEAD_MENU}" height="${MC_HEAD_MENU}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
      </button>`;
    }).join("");
    const frameTiles = renderProfileFrameTilesHtml(currentFrameId, MC_HEAD_MENU);
    return `<div class="profile-look-menu hidden" id="profile-look-menu" role="menu" aria-label="Внешний вид профиля" aria-hidden="true">
      <div class="profile-look-menu-tabs" role="tablist" aria-label="Раздел">
        <button type="button" class="profile-look-tab is-active" role="tab" id="profile-look-tab-avatar" data-look-tab="avatar" aria-selected="true" aria-controls="profile-look-panel-avatar">Аватар</button>
        <button type="button" class="profile-look-tab" role="tab" id="profile-look-tab-frame" data-look-tab="frame" aria-selected="false" aria-controls="profile-look-panel-frame">Рамка</button>
      </div>
      <div class="profile-look-panel" id="profile-look-panel-avatar" role="tabpanel" aria-labelledby="profile-look-tab-avatar">
        <div class="profile-look-grid profile-look-grid--avatar" role="group">${avatarTiles}</div>
      </div>
      <div class="profile-look-panel hidden" id="profile-look-panel-frame" role="tabpanel" aria-labelledby="profile-look-tab-frame">
        <div class="profile-look-grid profile-look-grid--frame" role="group">${frameTiles}</div>
      </div>
    </div>`;
  }

  function setProfileLookTab(which) {
    const avatarTab = document.getElementById("profile-look-tab-avatar");
    const frameTab = document.getElementById("profile-look-tab-frame");
    const avatarPanel = document.getElementById("profile-look-panel-avatar");
    const framePanel = document.getElementById("profile-look-panel-frame");
    if (!avatarTab || !frameTab || !avatarPanel || !framePanel) return;
    const isAvatar = which === "avatar";
    avatarTab.classList.toggle("is-active", isAvatar);
    frameTab.classList.toggle("is-active", !isAvatar);
    avatarTab.setAttribute("aria-selected", isAvatar ? "true" : "false");
    frameTab.setAttribute("aria-selected", isAvatar ? "false" : "true");
    avatarPanel.classList.toggle("hidden", !isAvatar);
    framePanel.classList.toggle("hidden", isAvatar);
  }

  function closeProfileLookMenu() {
    const menu = document.getElementById("profile-look-menu");
    const btn = document.getElementById("profile-look-edit-btn");
    if (menu) {
      menu.classList.add("hidden");
      menu.setAttribute("aria-hidden", "true");
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
    setProfileLookTab("avatar");
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
    if (v === "custom_upload") return DEFAULT_MC_AVATAR_VARIANT;
    if (v) {
      for (let i = 0; i < MC_AVATAR_VARIANTS.length; i += 1) {
        if (MC_AVATAR_VARIANTS[i].id === v) return v;
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

  /** Вариант с сервера (/me, /admin/users) или из localStorage (до синхронизации). */
  function resolveMcVariantForUser(u) {
    if (!u || u.id == null) return DEFAULT_MC_AVATAR_VARIANT;
    const fromApi = u.mc_avatar_variant;
    if (fromApi && MC_AVATAR_VARIANTS.some((v) => v.id === fromApi)) {
      return fromApi;
    }
    return getStoredMcVariant(u.id);
  }

  function persistMcAvatarVariantToServer(userId, variantId) {
    return apiFetch("/auth/me", { method: "PATCH", body: { mc_avatar_variant: variantId } })
      .then(() => {
        invalidateAuthMeCache();
      })
      .catch(() => {});
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
    const menu = root.querySelector("#profile-look-menu");
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

  document.body.addEventListener("click", (e) => {
    const lookTab = e.target.closest("[data-look-tab]");
    if (lookTab && document.getElementById("profile-content")?.contains(lookTab)) {
      e.stopPropagation();
      const tab = lookTab.getAttribute("data-look-tab");
      if (tab === "avatar" || tab === "frame") setProfileLookTab(tab);
      return;
    }

    const lookBtn = e.target.closest("#profile-look-edit-btn");
    if (lookBtn && document.getElementById("profile-content")?.contains(lookBtn)) {
      e.stopPropagation();
      const menu = document.getElementById("profile-look-menu");
      if (!menu) return;
      const willOpen = menu.classList.contains("hidden");
      if (willOpen) {
        setProfileLookTab("avatar");
        menu.classList.remove("hidden");
        menu.setAttribute("aria-hidden", "false");
        lookBtn.setAttribute("aria-expanded", "true");
      } else {
        closeProfileLookMenu();
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
      setStoredMcVariant(Number(userId), variantId);
      void persistMcAvatarVariantToServer(Number(userId), variantId);
      setMainProfileAvatar(root, username, variantId);
      root.querySelectorAll("[data-mc-variant]").forEach((el) => {
        el.classList.toggle("is-selected", el.getAttribute("data-mc-variant") === variantId);
      });
      closeProfileLookMenu();
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
      closeProfileLookMenu();
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest(".profile-avatar-shell")) return;
    if (e.target.closest(".profile-hero-look-wrap")) return;
    closeProfileLookMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeProfileLookMenu();
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
      const variantId = resolveMcVariantForUser(me);
      setStoredMcVariant(me.id, variantId);
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
                </div>
              </div>
              <div class="profile-top-main">
                <div class="profile-hero-head-row">
                  <h3 class="profile-hero-name">${escapeHtml(me.username)}</h3>
                  <div class="profile-hero-badges profile-hero-badges--top" aria-label="Роль и статус">
                    ${guardianBadge}${banBadge}
                  </div>
                </div>
                <div class="profile-hero-look-wrap">
                  <div class="profile-hero-look-actions">
                    <button type="button" class="btn" id="profile-look-edit-btn" aria-expanded="false" aria-controls="profile-look-menu" aria-haspopup="true">Аватар</button>
                    <button type="button" class="btn btn-ghost" id="btn-profile-change-name-inline">Сменить имя</button>
                  </div>
                  ${renderProfileLookMenuHtml(me.username, variantId, me.id, profileFrameId)}
                </div>
              </div>
            </div>
            <div class="profile-top-divider" aria-hidden="true"></div>
          </div>
          <div class="profile-cabinet-spacer" aria-hidden="true"></div>
        </div>
      `;

      box.dataset.profileUserId = String(me.id);
      box.dataset.profileUsername = me.username;
      const guardiansBtn = document.getElementById("btn-profile-guardians");
      const processingBtn = document.getElementById("btn-profile-processing");
      if (guardiansBtn) guardiansBtn.classList.toggle("hidden", !me.is_admin);
      if (processingBtn) processingBtn.classList.toggle("hidden", !me.is_admin);
      bindProfileAvatarImage(box, me.username, variantId);
      bindMcAvatarMenuTiles(box);
      applyProfileFrameOverlay(box, me.id);
    } catch (err) {
      msg.classList.add("flash-error");
      msg.textContent = err.message;
    }
  }

  document.addEventListener("click", (e) => {
    const pick = e.target.closest("[data-staff-pick]");
    if (!pick) return;
    const mode = pick.getAttribute("data-staff-pick");
    if (mode !== "admin" && mode !== "processing") return;
    const id = Number(pick.getAttribute("data-user-id"), 10);
    staffState.selectedId[mode] = id;
    syncStaffListAndDetail(mode);
  });

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-staff-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-staff-act");
    const mode = btn.getAttribute("data-staff-mode");
    const id = Number(btn.getAttribute("data-user-id"), 10);
    const toTrue = btn.getAttribute("data-to") === "true";
    if (!mode || (mode !== "admin" && mode !== "processing")) return;
    const els = getStaffEls(mode);
    const msg = els && els.msg;
    btn.disabled = true;
    try {
      if (act === "ban") {
        await apiFetch(`/admin/users/${id}/ban`, { method: "PATCH", body: { is_banned: toTrue } });
      } else if (act === "admin") {
        await apiFetch(`/admin/users/${id}/admin`, { method: "PATCH", body: { is_admin: toTrue } });
      } else {
        return;
      }
      if (msg) {
        msg.className = "flash flash-success";
        msg.textContent = "Сохранено.";
      }
      await loadStaffUsers(mode, { keepSelection: true });
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

  ["admin", "processing"].forEach((mode) => {
    const els = getStaffEls(mode);
    els.search?.addEventListener("input", () => syncStaffListAndDetail(mode));
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
  const profileModalChangePassword = document.getElementById("profile-modal-change-password");
  const profileModalForgotPassword = document.getElementById("profile-modal-forgot-password");
  const profileModalResetPassword = document.getElementById("profile-modal-reset-password");

  function closeProfileModals() {
    if (!profileModalOverlay) return;
    profileModalOverlay.classList.add("hidden");
    profileModalOverlay.setAttribute("aria-hidden", "true");
    profileModalChange?.classList.add("hidden");
    profileModalChangePassword?.classList.add("hidden");
    profileModalForgotPassword?.classList.add("hidden");
    profileModalResetPassword?.classList.add("hidden");
  }

  function resetProfileForgotModal() {
    const msg = document.getElementById("profile-modal-forgot-msg");
    if (msg) {
      msg.textContent = "";
      msg.className = "flash";
    }
  }

  function openForgotPasswordFromProfileModal() {
    if (!profileModalOverlay || !profileModalForgotPassword) return;
    profileModalChange?.classList.add("hidden");
    profileModalChangePassword?.classList.add("hidden");
    profileModalResetPassword?.classList.add("hidden");
    resetProfileForgotModal();
    profileModalForgotPassword.classList.remove("hidden");
    profileModalOverlay.classList.remove("hidden");
    profileModalOverlay.setAttribute("aria-hidden", "false");
    fetchAuthMeCached()
      .then((me) => {
        const masked = document.getElementById("profile-forgot-email-masked");
        if (masked) masked.textContent = maskEmailHalf(me && me.email ? me.email : "");
        // TODO(backend): автоматически вызывать отправку письма при открытии этой модалки.
        document.getElementById("btn-profile-forgot-done")?.focus();
      })
      .catch(() => {
        const masked = document.getElementById("profile-forgot-email-masked");
        if (masked) masked.textContent = "ваш*****@почта.ru";
        document.getElementById("btn-profile-forgot-done")?.focus();
      });
  }

  function openResetPasswordModal() {
    if (!profileModalOverlay || !profileModalResetPassword) return;
    // TODO(backend): открывать эту модалку после проверки reset-token из ссылки письма.
    profileModalChange?.classList.add("hidden");
    profileModalChangePassword?.classList.add("hidden");
    profileModalForgotPassword?.classList.add("hidden");
    profileModalResetPassword.classList.remove("hidden");
    profileModalOverlay.classList.remove("hidden");
    profileModalOverlay.setAttribute("aria-hidden", "false");
    const mini = document.getElementById("profile-modal-reset-password-msg");
    if (mini) {
      mini.textContent = "";
      mini.className = "flash";
    }
    const form = document.getElementById("form-profile-reset-password");
    if (form) form.reset();
    document.getElementById("input-profile-reset-password-new")?.focus();
  }

  function openChangeNameModal() {
    closeProfileLookMenu();
    if (!profileModalOverlay || !profileModalChange) return;
    profileModalResetPassword?.classList.add("hidden");
    profileModalForgotPassword?.classList.add("hidden");
    profileModalChangePassword?.classList.add("hidden");
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

  function openChangePasswordModal() {
    if (!profileModalOverlay || !profileModalChangePassword) return;
    profileModalChange?.classList.add("hidden");
    profileModalResetPassword?.classList.add("hidden");
    profileModalForgotPassword?.classList.add("hidden");
    profileModalChangePassword.classList.remove("hidden");
    profileModalOverlay.classList.remove("hidden");
    profileModalOverlay.setAttribute("aria-hidden", "false");
    const mini = document.getElementById("profile-modal-password-msg");
    if (mini) {
      mini.textContent = "";
      mini.className = "flash";
    }
    const form = document.getElementById("form-profile-change-password");
    if (form) form.reset();
    document.getElementById("input-profile-password-current")?.focus();
  }

  document.getElementById("view-profile")?.addEventListener("click", (e) => {
    if (e.target.closest("#btn-profile-change-name-inline")) {
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
      openChangePasswordModal();
      return;
    }
  });

  document.getElementById("form-forgot-password")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = document.getElementById("forgot-password-message");
    const fd = new FormData(e.target);
    const email = String(fd.get("email") || "").trim();
    const basicOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!email || !basicOk) {
      if (msg) {
        msg.className = "flash flash-error";
        msg.textContent = "Введите корректный адрес электронной почты.";
      }
      return;
    }
    if (msg) {
      msg.textContent = "";
      msg.className = "flash";
    }
    // TODO(backend): заменить локальный успех реальным POST /auth/password/forgot
    // и показывать одинаковый ответ независимо от существования email.
    const masked = document.getElementById("forgot-email-masked");
    if (masked) masked.textContent = maskEmailHalf(email);
    document.getElementById("forgot-password-step-form")?.classList.add("hidden");
    document.getElementById("forgot-password-step-sent")?.classList.remove("hidden");
  });

  document.getElementById("btn-profile-forgot-password")?.addEventListener("click", () => {
    openForgotPasswordFromProfileModal();
  });

  document.getElementById("btn-profile-forgot-done")?.addEventListener("click", closeProfileModals);

  document.getElementById("btn-profile-modal-cancel")?.addEventListener("click", closeProfileModals);
  document.getElementById("btn-profile-password-cancel")?.addEventListener("click", closeProfileModals);
  document.getElementById("btn-profile-reset-password-cancel")?.addEventListener("click", closeProfileModals);
  document.getElementById("profile-modal-scrim")?.addEventListener("click", closeProfileModals);

  document.getElementById("form-profile-reset-password")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const msg = document.getElementById("profile-modal-reset-password-msg");
    const fd = new FormData(e.target);
    const a = String(fd.get("new_password") || "");
    const b = String(fd.get("new_password_confirm") || "");
    if (a !== b) {
      if (msg) {
        msg.className = "flash flash-error";
        msg.textContent = "Новый пароль и повтор не совпадают.";
      }
      return;
    }
    if (a.length < 8) {
      if (msg) {
        msg.className = "flash flash-error";
        msg.textContent = "Пароль должен быть не короче 8 символов.";
      }
      return;
    }
    // TODO(backend): заменить заглушку реальным POST/PATCH reset-password
    // с token/code из ссылки письма и новым паролем.
    if (msg) {
      msg.className = "flash flash-info";
      msg.textContent =
        "Интерфейс готов. Сохранение нового пароля по ссылке из письма заработает после подключения сервера восстановления.";
    }
  });

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

  document.getElementById("form-profile-change-password")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("profile-modal-password-msg");
    const fd = new FormData(e.target);
    const currentPassword = String(fd.get("current_password") || "");
    const newPassword = String(fd.get("new_password") || "");
    const newPasswordConfirm = String(fd.get("new_password_confirm") || "");

    if (newPassword !== newPasswordConfirm) {
      if (msg) {
        msg.className = "flash flash-error";
        msg.textContent = "Новый пароль и повтор не совпадают.";
      }
      return;
    }
    if (newPassword.length < 8) {
      if (msg) {
        msg.className = "flash flash-error";
        msg.textContent = "Новый пароль должен быть не короче 8 символов.";
      }
      return;
    }
    if (msg) {
      msg.textContent = "";
      msg.className = "flash";
    }
    try {
      await apiFetch("/auth/me/password", {
        method: "PATCH",
        body: { current_password: currentPassword, new_password: newPassword },
      });
      closeProfileModals();
      const pm = document.getElementById("profile-message");
      if (pm) {
        pm.className = "flash flash-success";
        pm.textContent = "Пароль обновлён.";
      }
    } catch (err) {
      if (msg) {
        msg.className = "flash flash-error";
        const detail = err.message || "";
        const ru =
          detail === "Current password is incorrect"
            ? "Старый пароль введён неверно."
            : detail === "New password must differ from the current password"
              ? "Новый пароль должен отличаться от текущего."
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

    /**
     * Нижний край шапки в px от верха viewport.
     * Важно: не добавляем scrollY, иначе при прокрутке вниз "потолок" едет вниз и прижимает монеты.
     */
    function headerBottomDocY() {
      const el = document.querySelector(".site-header");
      if (!el) return 0;
      return el.getBoundingClientRect().bottom;
    }

    /** Верхний край полосы футера — монеты не ниже (как «рамка» снизу, симметрично шапке) */
    function footerTopDocY() {
      const el = document.querySelector(".site-footer");
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
    const STAR_GIF_NAMES = ["spark-1.gif", "spark-2.gif", "spark-3.gif", "spark-4.gif"];
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
  try {
    const p = new URLSearchParams(window.location.search);
    if (p.get("wc_l_reset") === "1") {
      requestAnimationFrame(() => openResetPasswordModal());
      const u = new URL(window.location.href);
      u.searchParams.delete("wc_l_reset");
      history.replaceState({}, "", u.pathname + u.search + u.hash);
    }
  } catch (_) {}
})();
