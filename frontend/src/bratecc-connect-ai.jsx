import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const APP_BASE = "/app";

/** Segmento de rota após /app (ex.: assoc-empresa). null se não for rota autenticada. */
function rawPageFromPathname(pathname) {
  if (!pathname || !pathname.startsWith(APP_BASE)) return null;
  const rest = pathname.slice(APP_BASE.length).replace(/^\/+/, "");
  const seg = rest.split("/")[0];
  return seg || "dashboard";
}

/** Deve coincidir com os `id` do menu admin na Sidebar */
const ADMIN_MODULE_IDS = [
  "dashboard",
  "assoc-empresa",
  "assoc-assoc",
  "univ-assoc", // Universidades × Associados (matches)
  "eventos-empresas",
  "eventos-associados",
  "eventos-assoc-empresa",
  "gestao-empresa",
  "gestao-associados",
  "gestao-eventos",
  "gestao-universidades", // CRUD universidades
  "nova-empresa",
  "novo-associado",
  "novo-evento",
  "nova-universidade", // cadastro de universidade
];

const ASSOC_MODULE_IDS = [
  "dashboard",
  "assoc-empresa",
  "assoc-assoc",
  "minhas-vagas",
  "meu-perfil",
];

const UNIV_MODULE_IDS = [
  "dashboard",
  "meus-candidatos",
  "univ-matches",
  "meu-perfil-univ",
];

function sanitizeModuleId(raw, role) {
  let id = raw && String(raw).length ? raw : "dashboard";
  if (id === "matches") id = "assoc-empresa";
  if (id === "gestao") id = "gestao-empresa";
  if (id === "b2b") id = "assoc-assoc";
  const allowed =
    role === "admin"
      ? ADMIN_MODULE_IDS
      : role === "universidade"
        ? UNIV_MODULE_IDS
        : ASSOC_MODULE_IDS;
  if (!allowed.includes(id)) return "dashboard";
  return id;
}

// ─── API Configuration ───
const API_URL = import.meta.env?.VITE_API_URL || "http://localhost:3001/api";
const TOKEN_KEY = "bratecc_jwt";

// Helper para chamadas à API (token persistido em localStorage)
const api = {
  get token() {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(TOKEN_KEY)
      : null;
  },

  setToken(token) {
    if (typeof window === "undefined") return;
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  },

  clearToken() {
    this.setToken(null);
  },

  async request(endpoint, options = {}) {
    const token = this.token;
    const headers = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers,
      });

      // 401: login público devolve "Credenciais inválidas"; demais rotas = sessão JWT inválida
      if (response.status === 401) {
        const data401 = await response.json().catch(() => ({}));
        const isLogin =
          endpoint.replace(/\?.*$/, "") === "/auth/login" ||
          endpoint.startsWith("/auth/login?");
        if (!isLogin) {
          this.clearToken();
        }
        const msg = isLogin
          ? data401.error || "Credenciais inválidas"
          : data401.error || "Sessão expirada. Faça login novamente.";
        const err = new Error(msg);
        err.status = 401;
        throw err;
      }

      const data = await response.json();

      if (!response.ok) {
        const err = new Error(data.error || "Erro na requisição");
        err.status = response.status;
        throw err;
      }

      return data;
    } catch (error) {
      // 401 em /auth/me é fluxo esperado quando token expirou ou banco foi
      // resetado (seed mínimo apaga o usuário). O caller já trata limpando
      // o token e redirecionando pro login — não precisa logar erro.
      const isExpectedAuthCheck =
        error.status === 401 && endpoint === "/auth/me";
      if (!isExpectedAuthCheck) {
        console.error(`API Error [${endpoint}]:`, error);
      }
      throw error;
    }
  },

  get(endpoint) {
    return this.request(endpoint);
  },

  post(endpoint, body) {
    return this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(body || {}),
    });
  },

  put(endpoint, body) {
    return this.request(endpoint, {
      method: "PUT",
      body: JSON.stringify(body || {}),
    });
  },

  patch(endpoint, body) {
    return this.request(endpoint, {
      method: "PATCH",
      body: JSON.stringify(body || {}),
    });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: "DELETE" });
  },
};

// ─── Hook: notificações lidas (persistido em localStorage) ───
const READ_NOTIFICATIONS_KEY = "bratecc_read_notifications";

function useReadNotifications() {
  const [readIds, setReadIds] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem(READ_NOTIFICATIONS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  // Persiste toda vez que muda
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        READ_NOTIFICATIONS_KEY,
        JSON.stringify(readIds),
      );
    } catch {
      // quota exceeded ou modo privado: ignora silenciosamente
    }
  }, [readIds]);

  const markAsRead = (id) => {
    setReadIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      // Limita crescimento: mantém só as 500 mais recentes
      return next.length > 500 ? next.slice(-500) : next;
    });
  };

  const markAllAsRead = (ids) => {
    setReadIds((prev) => {
      const combined = [...prev];
      ids.forEach((id) => {
        if (!combined.includes(id)) combined.push(id);
      });
      return combined.length > 500 ? combined.slice(-500) : combined;
    });
  };

  const clearAll = () => {
    setReadIds([]);
  };

  return { readIds, markAsRead, markAllAsRead, clearAll };
}

// ─── Hook: estado da sidebar (colapsada, seções expandidas) persistido ───
const SIDEBAR_STATE_KEY = "bratecc_sidebar_state";

function useSidebarState() {
  const [state, setState] = useState(() => {
    if (typeof window === "undefined") {
      return { collapsed: false, openSections: {} };
    }
    try {
      const stored = window.localStorage.getItem(SIDEBAR_STATE_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      return {
        collapsed: !!parsed.collapsed,
        openSections:
          parsed.openSections && typeof parsed.openSections === "object"
            ? parsed.openSections
            : {},
      };
    } catch {
      return { collapsed: false, openSections: {} };
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(state));
    } catch {
      // modo privado ou quota: ignora
    }
  }, [state]);

  const toggleCollapsed = () => {
    setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  };

  const toggleSection = (sectionId) => {
    setState((prev) => ({
      ...prev,
      openSections: {
        ...prev.openSections,
        [sectionId]: !prev.openSections[sectionId],
      },
    }));
  };

  // Retorna se a seção está aberta, considerando default (aberta se não tem info)
  const isSectionOpen = (sectionId, defaultOpen = true) => {
    if (state.openSections[sectionId] === undefined) return defaultOpen;
    return state.openSections[sectionId];
  };

  return {
    collapsed: state.collapsed,
    toggleCollapsed,
    toggleSection,
    isSectionOpen,
  };
}

// ─── Icons ───
const Icons = {
  Dashboard: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  Target: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  ),
  Handshake: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M20 7l-5 5-4-4-5 5" />
      <path d="M15 7h5v5" />
    </svg>
  ),
  Calendar: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  Building: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22V12h6v10" />
      <path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01" />
    </svg>
  ),
  Plus: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  User: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Robot: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M12 2v6" />
      <circle cx="9" cy="14" r="1.5" fill="currentColor" />
      <circle cx="15" cy="14" r="1.5" fill="currentColor" />
      <path d="M9 18h6" />
    </svg>
  ),
  Mail: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  Phone: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  ChevronRight: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  ChevronLeft: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  ChevronDown: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="14"
      height="14"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  PanelLeft: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </svg>
  ),
  Search: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Bell: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  Help: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  ArrowRight: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  Check: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Globe: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  Filter: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  Sparkles: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75L19 15z" />
    </svg>
  ),
  Brain: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.45 2.1-1.17 2.83L12 12l-2.83-3.17A4 4 0 0 1 8 6a4 4 0 0 1 4-4z" />
      <path d="M12 12l2.83 3.17A4 4 0 0 1 16 18a4 4 0 0 1-8 0c0-1.1.45-2.1 1.17-2.83L12 12z" />
      <path d="M6.5 9A2.5 2.5 0 0 0 4 11.5V12a4 4 0 0 0 4 4" />
      <path d="M17.5 9A2.5 2.5 0 0 1 20 11.5V12a4 4 0 0 1-4 4" />
    </svg>
  ),
  Zap: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  Send: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  MessageCircle: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  ),
  X: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="16"
      height="16"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Settings: () => (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="20"
      height="20"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

// ─── Initial Data ───
const initialMatchesData = [
  {
    id: 1,
    empresa: "Texas Energy Solutions",
    cidade: "Houston, TX",
    setor: "Energy",
    produto: "Trade Finance",
    associado: "FinTech Brasil",
    score: 92,
    status: "Confirmed",
  },
  {
    id: 2,
    empresa: "Lone Star Logistics",
    cidade: "Dallas, TX",
    setor: "Logistics",
    produto: "Customs Clearance",
    associado: "Global Logistics BR",
    score: 88,
    status: "Interested",
  },
  {
    id: 3,
    empresa: "Rio Grande Imports",
    cidade: "El Paso, TX",
    setor: "Food",
    produto: "Legal Compliance",
    associado: "Legal Partners",
    score: 82,
    status: "Contacted",
  },
  {
    id: 4,
    empresa: "Austin Tech Exporters",
    cidade: "Austin, TX",
    setor: "Tech",
    produto: "Financial Services",
    associado: "FinTech Brasil",
    score: 79,
    status: "Pending",
  },
  {
    id: 5,
    empresa: "Dallas Manufacturing",
    cidade: "Dallas, TX",
    setor: "Industry",
    produto: "Trade Finance",
    associado: "FinTech Brasil",
    score: 75,
    status: "Pending",
  },
  {
    id: 6,
    empresa: "Gulf Coast Trading",
    cidade: "Corpus Christi, TX",
    setor: "Energy",
    produto: "Trade Finance",
    associado: "FinTech Brasil",
    score: 71,
    status: "Pending",
  },
  {
    id: 7,
    empresa: "San Antonio Foods",
    cidade: "San Antonio, TX",
    setor: "Food",
    produto: "Export Logistics",
    associado: "Global Logistics BR",
    score: 85,
    status: "Interested",
  },
];

const initialEventosData = [
  {
    id: 1,
    nome: "Brasil Energy Breakfast 2026",
    local: "Houston Convention Center",
    data: "7 de Maio, 2026",
    participantes: 45,
    matches: 128,
    associados: 6,
    taxaMatch: 95,
    status: "Ativo",
    numero: "+1-555-BREAKFAST-2026",
  },
  {
    id: 2,
    nome: "Brazil-TX Business Forum",
    local: "Dallas Trade Center",
    data: "20 de Junho, 2026",
    participantes: 32,
    matches: 87,
    associados: 4,
    taxaMatch: 91,
    status: "Planejado",
    numero: "+1-555-FORUM-26",
  },
  {
    id: 3,
    nome: "Tech Connect 2026",
    local: "Austin Convention Center",
    data: "15 de Agosto, 2026",
    participantes: 28,
    matches: 63,
    associados: 3,
    taxaMatch: 88,
    status: "Planejado",
    numero: "+1-555-TECH-2026",
  },
];

const initialEmpresasData = [
  {
    id: 1,
    nome: "Texas Energy Solutions",
    segmento: "Energy",
    porte: "Grande",
    cidade: "Houston",
    estado: "Texas",
    tipo: "Exportador",
    email: "contact@texasenergy.com",
    produtosOferecidos:
      "Equipamentos de energia solar, painéis fotovoltaicos, inversores solares",
    produtosDemandados:
      "Trade finance, logística internacional, seguros de exportação",
    desc: "Exportação de equipamentos de energia solar para América Latina — precisa de trade finance e logística",
  },
  {
    id: 2,
    nome: "Lone Star Logistics",
    segmento: "Logistics",
    porte: "Médio",
    cidade: "Dallas",
    estado: "Texas",
    tipo: "Ambos",
    email: "info@lonestar.com",
    produtosOferecidos:
      "Serviços de desembaraço aduaneiro, armazenagem, transporte multimodal",
    produtosDemandados:
      "Parcerias com fornecedores brasileiros, consultoria jurídica",
    desc: "Desembaraço aduaneiro completo e parcerias com fornecedores brasileiros",
  },
  {
    id: 3,
    nome: "Austin Tech Exporters",
    segmento: "Technology",
    porte: "Médio",
    cidade: "Austin",
    estado: "Texas",
    tipo: "Exportador",
    email: "hello@austintech.com",
    produtosOferecidos:
      "Software empresarial, soluções SaaS, consultoria em TI",
    produtosDemandados:
      "Certificações internacionais, representação comercial, suporte legal",
    desc: "Certificações internacionais e consultoria para exportação de software e serviços TI",
  },
  {
    id: 4,
    nome: "Rio Grande Imports",
    segmento: "Food",
    porte: "Pequeno",
    cidade: "El Paso",
    estado: "Texas",
    tipo: "Importador",
    email: "contact@rgimports.com",
    produtosOferecidos: "Distribuição de alimentos importados, rede de varejo",
    produtosDemandados: "Alimentos brasileiros, bebidas, café especial, açaí",
    desc: "Importação de alimentos e bebidas brasileiras para o mercado texano",
  },
  {
    id: 5,
    nome: "Gulf Coast Trading",
    segmento: "Energy",
    porte: "Grande",
    cidade: "Corpus Christi",
    estado: "Texas",
    tipo: "Ambos",
    email: "trade@gulfcoast.com",
    produtosOferecidos: "Trading de petróleo, gás natural, etanol",
    produtosDemandados:
      "Financiamento de commodities, hedge cambial, logística marítima",
    desc: "Trading de commodities energéticas entre Brasil e Texas",
  },
];

const initialAssociadosData = [
  {
    id: 1,
    nome: "FinTech Brasil",
    segmento: "Financial Services",
    porte: "Médio",
    email: "fintech@bratecc.com",
    whatsapp: "+55 11 99999-0001",
    senha: "fintech123",
    produtosOferecidos:
      "Trade Finance Solutions, cartas de crédito internacional, seguros de exportação, assessoria em câmbio",
    produtosDemandados:
      "Empresas exportadoras de tecnologia, parceiros em energia renovável",
    servicos:
      "Trade Finance Solutions, cartas de crédito e seguros de exportação",
  },
  {
    id: 2,
    nome: "Global Logistics BR",
    segmento: "Logistics & Supply Chain",
    porte: "Grande",
    email: "logistics@bratecc.com",
    whatsapp: "+55 11 99999-0002",
    senha: "logistics123",
    produtosOferecidos:
      "Customs Clearance, desembaraço aduaneiro, transporte multimodal, armazenagem internacional",
    produtosDemandados:
      "Importadores de alimentos, empresas de e-commerce cross-border",
    servicos: "Customs Clearance e desembaraço aduaneiro",
  },
  {
    id: 3,
    nome: "Legal Partners",
    segmento: "Legal & Compliance",
    porte: "Pequeno",
    email: "legal@bratecc.com",
    whatsapp: "+55 11 99999-0003",
    senha: "legal123",
    produtosOferecidos:
      "Assessoria jurídica internacional, compliance regulatório, contratos de comércio exterior, registro de marcas",
    produtosDemandados:
      "Empresas entrando no mercado americano, startups em expansão internacional",
    servicos: "Legal Compliance e Regulatory Advisory",
  },
  {
    id: 4,
    nome: "TechBR Solutions",
    segmento: "Technology & IT",
    porte: "Médio",
    email: "tech@bratecc.com",
    whatsapp: "+55 11 99999-0004",
    senha: "tech123",
    produtosOferecidos:
      "Infraestrutura de TI, Cloud Services, desenvolvimento de software, integração de sistemas ERP",
    produtosDemandados:
      "Empresas de energia buscando digitalização, indústrias em transformação digital",
    servicos: "IT Infrastructure e Cloud Services",
  },
  {
    id: 5,
    nome: "AgroBR Consulting",
    segmento: "Agriculture & Food",
    porte: "Pequeno",
    email: "agro@bratecc.com",
    whatsapp: "+55 11 99999-0005",
    senha: "agro123",
    produtosOferecidos:
      "Consultoria Agro, Certificação USDA/FDA, Rastreabilidade, Análise de Mercado",
    produtosDemandados:
      "Importadores de alimentos, distribuidores no Texas, parcerias com supermercados",
    servicos: "Consultoria agrícola e certificações de exportação de alimentos",
  },
];

// ─── Style Constants ───
const colors = {
  bg: "#f5f7fa",
  surface: "#ffffff",
  surfaceLight: "#f0f2f5",
  border: "#e2e5ea",
  text: "#1a1d26",
  textMuted: "#6b7280",
  blue: "#4f7cff",
  green: "#00b876",
  purple: "#8b5cf6",
  orange: "#f97316",
  pink: "#ec4899",
  cyan: "#06b6d4",
  red: "#ef4444",
  yellow: "#d97706",
};

const statusColors = {
  Confirmed: {
    bg: "rgba(0,184,118,0.1)",
    text: "#00875a",
    border: "rgba(0,184,118,0.25)",
  },
  Interested: {
    bg: "rgba(79,124,255,0.1)",
    text: "#3b6de0",
    border: "rgba(79,124,255,0.25)",
  },
  Contacted: {
    bg: "rgba(139,92,246,0.1)",
    text: "#7c3aed",
    border: "rgba(139,92,246,0.25)",
  },
  Pending: {
    bg: "rgba(217,119,6,0.1)",
    text: "#b45309",
    border: "rgba(217,119,6,0.25)",
  },
  Rejected: {
    bg: "rgba(239,68,68,0.1)",
    text: "#dc2626",
    border: "rgba(239,68,68,0.25)",
  },
  Ativo: { bg: "rgba(0,184,118,0.1)", text: "#00875a" },
  Planejado: { bg: "rgba(79,124,255,0.1)", text: "#3b6de0" },
};

const statusLabels = {
  Confirmed: "Confirmado",
  Interested: "Interessado",
  Contacted: "Contatado",
  Pending: "Pendente",
  Rejected: "Rejeitado",
  CONFIRMED: "Confirmado",
  INTERESTED: "Interessado",
  CONTACTED: "Contatado",
  PENDING: "Pendente",
  REJECTED: "Rejeitado",
  Ativo: "Ativo",
  Planejado: "Planejado",
  Pendente: "Pendente",
};

// ═══════════════════════════════════
// ─── MODAL + CAMPO REUTILIZÁVEIS ───
// ═══════════════════════════════════
function EditModal({ title, isOpen, onClose, onSave, saving, children }) {
  if (!isOpen) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(10,12,20,0.55)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
      />
      <div
        style={{
          position: "relative",
          background: "#ffffff",
          borderRadius: 20,
          width: "92%",
          maxWidth: 660,
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow:
            "0 32px 100px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.05)",
          animation: "fadeSlideUp 0.25s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "20px 28px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: `${colors.blue}12`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: colors.blue,
              }}
            >
              <IconEdit />
            </div>
            <div>
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: colors.text,
                  margin: 0,
                }}
              >
                {title}
              </h3>
              <p
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  margin: 0,
                  marginTop: 2,
                }}
              >
                Preencha os campos abaixo
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "none",
              background: colors.surfaceLight,
              color: colors.textMuted,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              padding: 0,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${colors.red}12`;
              e.currentTarget.style.color = colors.red;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = colors.surfaceLight;
              e.currentTarget.style.color = colors.textMuted;
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            height: 1,
            background: colors.border,
            marginLeft: 28,
            marginRight: 28,
          }}
        />
        <div style={{ padding: "24px 28px", overflowY: "auto", flex: 1 }}>
          {children}
        </div>
        <div
          style={{
            padding: "20px 28px",
            background: colors.surfaceLight,
            borderRadius: "0 0 20px 20px",
            display: "flex",
            gap: 12,
            justifyContent: "flex-end",
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "11px 28px",
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: "#fff",
              color: colors.text,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.borderColor = colors.textMuted)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = colors.border)
            }
          >
            Cancelar
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              padding: "11px 32px",
              borderRadius: 10,
              border: "none",
              background: saving
                ? colors.surfaceLight
                : `linear-gradient(135deg, ${colors.green}, #00a066)`,
              color: "#fff",
              cursor: saving ? "wait" : "pointer",
              fontSize: 13,
              fontWeight: 700,
              transition: "all 0.2s",
              boxShadow: saving ? "none" : `0 4px 12px ${colors.green}30`,
            }}
          >
            {saving ? "⏳ Salvando..." : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children, color }) {
  return (
    <div>
      <label
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: color || colors.textMuted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          display: "block",
          marginBottom: 7,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// ─── Animated Score Circle ───
function ScoreCircle({ score, size = 48 }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 90 ? colors.green : score >= 80 ? colors.blue : colors.orange;

  return (
    <div
      style={{ position: "relative", width: size, height: size, flexShrink: 0 }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.border}
          strokeWidth="3"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.28,
          fontWeight: 700,
          color,
        }}
      >
        {score}%
      </span>
    </div>
  );
}

// ─── Status Badge ───
function StatusBadge({ status }) {
  const s = statusColors[status] || statusColors.Pending;
  const label = statusLabels[status] || status;
  return (
    <span
      style={{
        padding: "4px 12px",
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: 0.3,
        background: s.bg,
        color: s.text,
        border: s.border ? `1px solid ${s.border}` : "none",
      }}
    >
      {label}
    </span>
  );
}

// ─── Stat Card ───
function StatCard({ value, label, sub, color, delay = 0 }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${color}20`,
        borderRadius: 16,
        padding: "24px 20px",
        flex: 1,
        minWidth: 140,
        position: "relative",
        overflow: "hidden",
        animation: `fadeSlideUp 0.5s ease-out ${delay}s both`,
        boxShadow: `0 2px 8px ${color}10`,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: -20,
          right: -20,
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: `${color}08`,
        }}
      />
      <div
        style={{
          fontSize: 36,
          fontWeight: 800,
          color,
          letterSpacing: -1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
        {label}
      </div>
      {sub && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 12,
            background: `${color}10`,
            color,
            display: "inline-block",
            fontWeight: 600,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Items Manager (produtos/serviços com NCM opcional) ───
// Componente controlado: recebe `items` e `onChange`.
// `tipo`: 'OFERECIDO' ou 'DEMANDADO' (define o contexto visual).
// Cada item tem { nome, tipo, ncmCodigo?, ncmDescricao? }.
function ItemsManager({
  items = [],
  onChange,
  tipo,
  label,
  accentColor,
  placeholder,
}) {
  const [nome, setNome] = useState("");
  const [ncmQuery, setNcmQuery] = useState("");
  const [ncmResults, setNcmResults] = useState([]);
  const [ncmSelected, setNcmSelected] = useState(null);
  const [ncmSearching, setNcmSearching] = useState(false);
  const [showNcmPanel, setShowNcmPanel] = useState(false);
  const searchTimeoutRef = useRef(null);

  const color = accentColor || colors.blue;

  // Debounced NCM search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!ncmQuery || ncmQuery.trim().length < 2) {
      setNcmResults([]);
      return;
    }
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        setNcmSearching(true);
        const results = await api.get(
          `/items/ncm/search?q=${encodeURIComponent(ncmQuery.trim())}&limit=15`,
        );
        setNcmResults(Array.isArray(results) ? results : []);
      } catch (err) {
        console.error("Erro ao buscar NCM:", err);
        setNcmResults([]);
      } finally {
        setNcmSearching(false);
      }
    }, 350);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [ncmQuery]);

  const handleSelectNcm = (ncm) => {
    setNcmSelected(ncm);
    setNcmQuery(
      `${ncm.codigo} — ${ncm.descricao.slice(0, 60)}${ncm.descricao.length > 60 ? "…" : ""}`,
    );
    setNcmResults([]);
  };

  const handleClearNcm = () => {
    setNcmSelected(null);
    setNcmQuery("");
    setNcmResults([]);
  };

  const handleAdd = () => {
    const n = nome.trim();
    if (!n) return;
    const novo = {
      nome: n,
      tipo,
      ncmCodigo: ncmSelected?.codigo || null,
      ncmDescricao: ncmSelected?.descricao || null,
    };
    onChange([...items, novo]);
    setNome("");
    handleClearNcm();
    setShowNcmPanel(false);
  };

  const handleRemove = (index) => {
    const next = items.filter((_, i) => i !== index);
    onChange(next);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const formatNcm = (codigo) => {
    if (!codigo || codigo.length < 8) return codigo;
    return `${codigo.slice(0, 4)}.${codigo.slice(4, 6)}.${codigo.slice(6, 8)}`;
  };

  return (
    <div
      style={{
        border: `1px solid ${color}30`,
        borderRadius: 12,
        padding: 16,
        background: `${color}05`,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: color,
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span>{label}</span>
        <span
          style={{
            fontSize: 11,
            background: color,
            color: "#fff",
            padding: "2px 8px",
            borderRadius: 10,
            fontWeight: 700,
          }}
        >
          {items.length}
        </span>
      </div>

      {/* Lista de itens existentes */}
      {items.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginBottom: 12,
          }}
        >
          {items.map((it, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                background: "#fff",
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: colors.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {it.nome}
                </div>
                {it.ncmCodigo && (
                  <div
                    style={{
                      fontSize: 10,
                      color: colors.textMuted,
                      marginTop: 2,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    NCM {formatNcm(it.ncmCodigo)}{" "}
                    {it.ncmDescricao
                      ? `— ${it.ncmDescricao.slice(0, 45)}${it.ncmDescricao.length > 45 ? "…" : ""}`
                      : ""}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleRemove(i)}
                title="Remover"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: colors.textMuted,
                  padding: 4,
                  fontSize: 16,
                  lineHeight: 1,
                  borderRadius: 4,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formulário de adição */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              placeholder || "Adicionar item (ex: Painéis solares 400W)"
            }
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              fontSize: 13,
              background: "#fff",
              color: colors.text,
            }}
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!nome.trim()}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "none",
              background: nome.trim() ? color : colors.surfaceLight,
              color: nome.trim() ? "#fff" : colors.textMuted,
              fontWeight: 600,
              fontSize: 13,
              cursor: nome.trim() ? "pointer" : "not-allowed",
            }}
          >
            + Adicionar
          </button>
        </div>

        {/* Toggle do painel NCM */}
        <button
          type="button"
          onClick={() => setShowNcmPanel(!showNcmPanel)}
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: color,
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 0",
            textDecoration: "underline",
          }}
        >
          {showNcmPanel
            ? "▾ Ocultar busca NCM"
            : "▸ Associar código NCM (opcional)"}
        </button>

        {/* Painel de busca NCM */}
        {showNcmPanel && (
          <div
            style={{
              padding: 12,
              background: "#fff",
              borderRadius: 8,
              border: `1px dashed ${colors.border}`,
            }}
          >
            <div
              style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6 }}
            >
              Busque por código (ex: 8541) ou descrição (ex: painel solar)
            </div>
            <div style={{ position: "relative" }}>
              <input
                type="text"
                value={ncmQuery}
                onChange={(e) => {
                  setNcmQuery(e.target.value);
                  if (ncmSelected) setNcmSelected(null);
                }}
                placeholder="Buscar NCM..."
                style={{
                  width: "100%",
                  padding: "8px 32px 8px 12px",
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  fontSize: 12,
                  background: "#fff",
                  color: colors.text,
                }}
              />
              {ncmQuery && (
                <button
                  type="button"
                  onClick={handleClearNcm}
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: colors.textMuted,
                    fontSize: 14,
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {ncmSearching && (
              <div
                style={{
                  fontSize: 11,
                  color: colors.textMuted,
                  padding: "6px 0",
                }}
              >
                Buscando...
              </div>
            )}

            {!ncmSearching && ncmResults.length > 0 && !ncmSelected && (
              <div
                style={{
                  marginTop: 6,
                  maxHeight: 180,
                  overflowY: "auto",
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                }}
              >
                {ncmResults.map((r) => (
                  <button
                    type="button"
                    key={r.codigo}
                    onClick={() => handleSelectNcm(r)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      background: "#fff",
                      border: "none",
                      borderBottom: `1px solid ${colors.border}`,
                      cursor: "pointer",
                      fontSize: 11,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontWeight: 700,
                        color: color,
                      }}
                    >
                      {formatNcm(r.codigo)}
                    </div>
                    <div style={{ color: colors.textMuted, marginTop: 2 }}>
                      {r.descricao.length > 90
                        ? `${r.descricao.slice(0, 90)}…`
                        : r.descricao}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {!ncmSearching &&
              ncmQuery.trim().length >= 2 &&
              ncmResults.length === 0 &&
              !ncmSelected && (
                <div
                  style={{
                    fontSize: 11,
                    color: colors.textMuted,
                    padding: "6px 0",
                    fontStyle: "italic",
                  }}
                >
                  Nenhum NCM encontrado. O cache pode estar carregando na
                  primeira busca (leva até 60s).
                </div>
              )}

            {ncmSelected && (
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  background: `${color}10`,
                  borderRadius: 6,
                  fontSize: 11,
                }}
              >
                <div style={{ fontWeight: 700, color }}>
                  NCM selecionado: {formatNcm(ncmSelected.codigo)}
                </div>
                <div style={{ color: colors.textMuted, marginTop: 2 }}>
                  {ncmSelected.descricao}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// COMPONENTES COMPARTILHADOS DOS FORMULÁRIOS DE CADASTRO
// Usados por NovaEmpresaPage e NovoAssociadoPage para manter
// consistência visual e reduzir duplicação.
// ═══════════════════════════════════════════════════════════════

// ─── Stepper: indicador visual dos steps do wizard ───
function WizardStepper({ steps, current }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 14,
        padding: "16px 20px",
        marginBottom: 24,
      }}
    >
      {steps.map((s, i) => {
        const idx = i + 1;
        const isActive = idx === current;
        const isDone = idx < current;
        const color = isActive
          ? colors.blue
          : isDone
            ? colors.green
            : colors.textMuted;
        const bg = isActive
          ? `${colors.blue}15`
          : isDone
            ? `${colors.green}10`
            : "transparent";
        return (
          <div key={s.label} style={{ display: "contents" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 14px",
                borderRadius: 10,
                background: bg,
                flex: "0 1 auto",
                minWidth: 0,
                transition: "all 0.2s",
              }}
            >
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: "50%",
                  background: isActive || isDone ? color : "transparent",
                  border: `2px solid ${color}`,
                  color: isActive || isDone ? "#fff" : color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 800,
                  flexShrink: 0,
                }}
              >
                {isDone ? "✓" : idx}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color,
                    letterSpacing: 0.3,
                  }}
                >
                  {s.label}
                </div>
                {s.hint && (
                  <div
                    style={{
                      fontSize: 10,
                      color: colors.textMuted,
                      marginTop: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.hint}
                  </div>
                )}
              </div>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: isDone ? colors.green : colors.border,
                  minWidth: 12,
                  transition: "all 0.2s",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Seção de formulário (bloco visual com header) ───
function FormSection({ title, description, children, icon }) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 14,
        padding: 24,
        marginBottom: 18,
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: colors.text,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
            {description}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Field: label + wrapper de input com erro opcional ───
function Field({ label, required, error, hint, children, span = 1 }) {
  return (
    <div style={{ gridColumn: `span ${span}`, minWidth: 0 }}>
      {label && (
        <label
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 700,
            color: colors.textMuted,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          {label} {required && <span style={{ color: colors.red }}>*</span>}
        </label>
      )}
      {children}
      {hint && !error && (
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
          {hint}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 11, color: colors.red, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}

// ─── Input de texto padronizado ───
function InputText({
  value,
  onChange,
  placeholder,
  type = "text",
  error,
  disabled,
}) {
  const borderColor = error ? colors.red : colors.border;
  return (
    <input
      type={type}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${borderColor}`,
        background: disabled ? colors.surfaceLight : "#fff",
        color: colors.text,
        fontSize: 13,
        outline: "none",
        boxSizing: "border-box",
        transition: "all 0.15s",
      }}
      onFocus={(e) => {
        if (!error) e.target.style.borderColor = colors.blue;
      }}
      onBlur={(e) => {
        e.target.style.borderColor = borderColor;
      }}
    />
  );
}

// ─── Select padronizado ───
function SelectField({
  value,
  onChange,
  options,
  placeholder,
  error,
  disabled,
}) {
  const borderColor = error ? colors.red : colors.border;
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${borderColor}`,
        background: disabled ? colors.surfaceLight : "#fff",
        color: value ? colors.text : colors.textMuted,
        fontSize: 13,
        outline: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        boxSizing: "border-box",
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => {
        const val = typeof opt === "string" ? opt : opt.value;
        const lbl = typeof opt === "string" ? opt : opt.label;
        return (
          <option key={val} value={val}>
            {lbl}
          </option>
        );
      })}
    </select>
  );
}

// ─── Textarea padronizado ───
function TextareaField({
  value,
  onChange,
  placeholder,
  rows = 3,
  error,
  disabled,
}) {
  const borderColor = error ? colors.red : colors.border;
  return (
    <textarea
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${borderColor}`,
        background: disabled ? colors.surfaceLight : "#fff",
        color: colors.text,
        fontSize: 13,
        outline: "none",
        boxSizing: "border-box",
        resize: "vertical",
        fontFamily: "inherit",
      }}
      onFocus={(e) => {
        if (!error) e.target.style.borderColor = colors.blue;
      }}
      onBlur={(e) => {
        e.target.style.borderColor = borderColor;
      }}
    />
  );
}

// ─── Switch entre modos (manual / importar) ───
function ModeSwitch({ mode, onChange, options }) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((opt) => {
        const isActive = mode === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: isActive ? colors.blue : "transparent",
              color: isActive ? "#fff" : colors.textMuted,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "all 0.15s",
            }}
          >
            {opt.icon && <span>{opt.icon}</span>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Barra de navegação do wizard (botões) ───
function WizardNav({
  step,
  totalSteps,
  onBack,
  onNext,
  onSave,
  saving,
  canProceed = true,
  saveLabel = "Salvar",
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        marginTop: 24,
        paddingTop: 20,
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <button
        onClick={onBack}
        disabled={step === 1 || saving}
        style={{
          padding: "12px 24px",
          borderRadius: 10,
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          color: step === 1 ? colors.textMuted : colors.text,
          cursor: step === 1 || saving ? "not-allowed" : "pointer",
          fontSize: 13,
          fontWeight: 600,
          opacity: step === 1 || saving ? 0.5 : 1,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        ← Voltar
      </button>
      {step < totalSteps ? (
        <button
          onClick={onNext}
          disabled={!canProceed || saving}
          style={{
            padding: "12px 28px",
            borderRadius: 10,
            border: "none",
            background:
              canProceed && !saving
                ? `linear-gradient(135deg, ${colors.blue}, ${colors.purple})`
                : colors.surfaceLight,
            color: canProceed && !saving ? "#fff" : colors.textMuted,
            cursor: canProceed && !saving ? "pointer" : "not-allowed",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Próximo →
        </button>
      ) : (
        <button
          onClick={onSave}
          disabled={!canProceed || saving}
          style={{
            padding: "12px 28px",
            borderRadius: 10,
            border: "none",
            background:
              canProceed && !saving
                ? `linear-gradient(135deg, ${colors.green}, ${colors.cyan})`
                : colors.surfaceLight,
            color: canProceed && !saving ? "#fff" : colors.textMuted,
            cursor: canProceed && !saving ? "pointer" : "not-allowed",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {saving ? (
            <>
              <span style={{ animation: "pulse 1s infinite" }}>⏳</span>{" "}
              Salvando...
            </>
          ) : (
            <>✓ {saveLabel}</>
          )}
        </button>
      )}
    </div>
  );
}

// ─── Sidebar ───
function Sidebar({
  page,
  setPage,
  role,
  onLogout,
  matchesCount = 0,
  collapsed,
  onToggleCollapsed,
  toggleSection,
  isSectionOpen,
}) {
  // Seções mais granulares pra admin: PRINCIPAL, MATCHES, EVENTOS, GESTÃO, CADASTROS.
  // `id` é usado como chave pro estado de colapso (persistido em localStorage).
  const adminSections = [
    {
      id: "principal",
      label: "PRINCIPAL",
      items: [
        { id: "dashboard", label: "Dashboard", icon: <Icons.Dashboard /> },
      ],
    },
    {
      id: "matches",
      label: "MATCHES",
      items: [
        {
          id: "assoc-empresa",
          label: "Assoc × Empresa",
          icon: <Icons.Target />,
        },
        {
          id: "assoc-assoc",
          label: "Assoc. × Assoc.",
          icon: <Icons.Handshake />,
        },
        {
          id: "univ-assoc",
          label: "Univ. × Associados",
          icon: <Icons.Sparkles />,
        },
      ],
    },
    {
      id: "eventos",
      label: "EVENTOS",
      items: [
        {
          id: "eventos-empresas",
          label: "Eventos × Empresas",
          icon: <Icons.Calendar />,
        },
        {
          id: "eventos-associados",
          label: "Eventos × Associados",
          icon: <Icons.User />,
        },
        {
          id: "eventos-assoc-empresa",
          label: "Eventos × Assoc × Empresa",
          icon: <Icons.Sparkles />,
        },
      ],
    },
    {
      id: "gestao",
      label: "GESTÃO",
      items: [
        {
          id: "gestao-empresa",
          label: "Gestão Empresas",
          icon: <Icons.Building />,
        },
        {
          id: "gestao-associados",
          label: "Gestão Associados",
          icon: <Icons.User />,
        },
        {
          id: "gestao-eventos",
          label: "Gestão Eventos",
          icon: <Icons.Settings />,
        },
        {
          id: "gestao-universidades",
          label: "Gestão Universidades",
          icon: <Icons.Building />,
        },
      ],
    },
    {
      id: "cadastros",
      label: "CADASTROS",
      items: [
        { id: "nova-empresa", label: "Nova Empresa", icon: <Icons.Plus /> },
        { id: "novo-associado", label: "Novo Associado", icon: <Icons.User /> },
        { id: "novo-evento", label: "Novo Evento", icon: <Icons.Calendar /> },
        {
          id: "nova-universidade",
          label: "Nova Universidade",
          icon: <Icons.Plus />,
        },
      ],
    },
  ];

  const assocSections = [
    {
      id: "portal",
      label: "PORTAL",
      items: [
        { id: "dashboard", label: "Meu Dashboard", icon: <Icons.Dashboard /> },
        { id: "assoc-empresa", label: "Meus Matches", icon: <Icons.Target /> },
        {
          id: "assoc-assoc",
          label: "Assoc. × Assoc.",
          icon: <Icons.Handshake />,
        },
        { id: "minhas-vagas", label: "Minhas Vagas", icon: <Icons.Plus /> },
        { id: "meu-perfil", label: "Meu Perfil", icon: <Icons.User /> },
      ],
    },
  ];

  // Sidebar das universidades — paralelo ao do associado, mas voltado pra
  // gestão de candidatos e visualização dos matches dos próprios candidatos.
  const univSections = [
    {
      id: "portal",
      label: "PORTAL",
      items: [
        { id: "dashboard", label: "Meu Dashboard", icon: <Icons.Dashboard /> },
        {
          id: "meus-candidatos",
          label: "Meus Candidatos",
          icon: <Icons.User />,
        },
        {
          id: "univ-matches",
          label: "Matches dos Candidatos",
          icon: <Icons.Target />,
        },
        {
          id: "meu-perfil-univ",
          label: "Meu Perfil",
          icon: <Icons.Settings />,
        },
      ],
    },
  ];

  const menuSections =
    role === "admin"
      ? adminSections
      : role === "universidade"
        ? univSections
        : assocSections;
  const userName =
    role === "admin"
      ? "Administrador"
      : role === "universidade"
        ? window.__currentUser?.universidade?.nome || "Universidade"
        : "FinTech Brasil";
  const userRole =
    role === "admin"
      ? "Admin"
      : role === "universidade"
        ? "Universidade BRATECC"
        : "Associado BRATECC";

  const sb = {
    bg: "#1e1f36",
    bgLight: "#282a4a",
    border: "#333560",
    text: "#e2e4f0",
    muted: "#8486a9",
  };
  const width = collapsed ? 64 : 240;

  return (
    <div
      style={{
        width,
        background: sb.bg,
        borderRight: `1px solid ${sb.border}`,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        position: "fixed",
        left: 0,
        top: 0,
        zIndex: 100,
        transition: "width 0.22s ease",
      }}
    >
      {/* Logo + toggle */}
      <div
        style={{
          padding: collapsed ? "16px 8px" : "20px 16px",
          borderBottom: `1px solid ${sb.border}`,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 64,
        }}
      >
        <div
          onClick={() => setPage("dashboard")}
          style={{
            cursor: "pointer",
            textAlign: "center",
            flex: 1,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 900,
              letterSpacing: 2,
              lineHeight: 1.1,
            }}
          >
            {collapsed ? (
              <span
                style={{ fontSize: 14, color: "#ffffff", display: "block" }}
              >
                BC
              </span>
            ) : (
              <>
                <span
                  style={{ fontSize: 20, color: "#ffffff", display: "block" }}
                >
                  BRATECC
                </span>
                <span
                  style={{ fontSize: 20, color: "#c41e3a", display: "block" }}
                >
                  CONNEX
                </span>
              </>
            )}
          </div>
        </div>

        {/* Botão retrair/expandir: flutua no canto direito da área do logo */}
        <button
          onClick={onToggleCollapsed}
          title={collapsed ? "Expandir menu" : "Retrair menu"}
          aria-label={collapsed ? "Expandir menu" : "Retrair menu"}
          style={{
            position: "absolute",
            right: collapsed ? "50%" : -12,
            bottom: collapsed ? -12 : "50%",
            transform: collapsed ? "translate(50%, 0)" : "translate(0, 50%)",
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: sb.bgLight,
            border: `1px solid ${sb.border}`,
            color: sb.text,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            zIndex: 2,
          }}
        >
          {collapsed ? <Icons.ChevronRight /> : <Icons.ChevronLeft />}
        </button>
      </div>

      {/* Nav */}
      <div
        className="scroll-dark"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: collapsed ? "12px 6px" : "12px 8px",
        }}
      >
        {menuSections.map((section) => {
          // Seções iniciam fechadas por padrão, mas a seção que contém a página
          // atualmente ativa expande automaticamente para dar contexto de navegação.
          const hasActiveItem = section.items.some((it) => it.id === page);
          const defaultOpen = hasActiveItem;
          const isOpen = isSectionOpen(section.id, defaultOpen);
          // Quando colapsada, não mostramos header de seção nem permitimos dobrar:
          // a lista de ícones fica sempre visível para não perder acessibilidade.
          const showHeader = !collapsed;
          const showItems = collapsed || isOpen;

          return (
            <div key={section.id} style={{ marginBottom: collapsed ? 10 : 14 }}>
              {showHeader && (
                <button
                  onClick={() => toggleSection(section.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "6px 10px",
                    marginBottom: 4,
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    color: sb.muted,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 1.5,
                    textAlign: "left",
                  }}
                >
                  <span>{section.label}</span>
                  <span
                    style={{
                      color: sb.muted,
                      display: "inline-flex",
                      transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
                      transition: "transform 0.18s ease",
                    }}
                  >
                    <Icons.ChevronDown />
                  </span>
                </button>
              )}

              {/* Pequeno separador entre seções quando colapsada */}
              {collapsed && section.id !== "principal" && (
                <div
                  style={{
                    height: 1,
                    background: sb.border,
                    margin: "6px 10px",
                  }}
                />
              )}

              {showItems &&
                section.items.map((item) => {
                  const active = page === item.id;
                  const btn = (
                    <button
                      key={item.id}
                      onClick={() => setPage(item.id)}
                      title={collapsed ? item.label : undefined}
                      aria-label={item.label}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: collapsed ? 0 : 10,
                        justifyContent: collapsed ? "center" : "flex-start",
                        padding: collapsed ? "10px 0" : "10px 12px",
                        borderRadius: 10,
                        border: "none",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: active ? 600 : 400,
                        color: active ? sb.text : sb.muted,
                        transition: "all 0.2s",
                        background: active
                          ? `linear-gradient(135deg, ${colors.blue}25, ${colors.purple}15)`
                          : "transparent",
                        borderLeft:
                          active && !collapsed
                            ? `3px solid ${colors.blue}`
                            : "3px solid transparent",
                        position: "relative",
                      }}
                    >
                      <span
                        style={{
                          color: active ? colors.blue : sb.muted,
                          flexShrink: 0,
                        }}
                      >
                        {item.icon}
                      </span>
                      {!collapsed && (
                        <span style={{ flex: 1, textAlign: "left" }}>
                          {item.label}
                        </span>
                      )}
                      {!collapsed && item.badge && (
                        <span
                          style={{
                            marginLeft: "auto",
                            background: colors.red,
                            color: "#fff",
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 7px",
                            borderRadius: 10,
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                      {/* Quando colapsada, badge vira um dot vermelho pequeno no canto do ícone */}
                      {collapsed && item.badge && (
                        <span
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 8,
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            background: colors.red,
                            color: "#fff",
                            fontSize: 9,
                            fontWeight: 800,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: `2px solid ${sb.bg}`,
                          }}
                        >
                          {item.badge > 9 ? "9+" : item.badge}
                        </span>
                      )}
                    </button>
                  );
                  return btn;
                })}
            </div>
          );
        })}
      </div>

      {/* User */}
      <div
        style={{
          padding: collapsed ? 8 : 16,
          borderTop: `1px solid ${sb.border}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: collapsed ? "center" : "flex-start",
            gap: 10,
            marginBottom: collapsed ? 8 : 10,
          }}
        >
          <div
            style={{
              width: collapsed ? 32 : 34,
              height: collapsed ? 32 : 34,
              borderRadius: 10,
              background:
                role === "admin"
                  ? `linear-gradient(135deg, ${colors.blue}, ${colors.purple})`
                  : `linear-gradient(135deg, ${colors.green}, ${colors.cyan})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              flexShrink: 0,
            }}
            title={collapsed ? `${userName} · ${userRole}` : undefined}
          >
            {role === "admin" ? "A" : "M"}
          </div>
          {!collapsed && (
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: sb.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {userName}
              </div>
              <div style={{ fontSize: 10, color: sb.muted }}>{userRole}</div>
            </div>
          )}
        </div>
        <button
          onClick={onLogout}
          title={collapsed ? "Sair" : undefined}
          style={{
            width: "100%",
            padding: collapsed ? "8px 0" : "8px 12px",
            borderRadius: 8,
            border: `1px solid ${sb.border}`,
            background: "transparent",
            color: sb.muted,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            transition: "all 0.2s",
          }}
        >
          {collapsed ? "🚪" : "🚪 Sair do Sistema"}
        </button>
      </div>
    </div>
  );
}

// ─── Top Bar ───
function TopBar({
  title,
  notifications = [],
  onNotificationClick,
  readIds = [],
  onMarkAsRead,
  onMarkAllAsRead,
}) {
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef(null);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter(
    (n) => !readIds.includes(n.id),
  ).length;

  const markAsRead = (id) => {
    if (onMarkAsRead) onMarkAsRead(id);
  };

  const markAllAsRead = () => {
    if (onMarkAllAsRead) onMarkAllAsRead(notifications.map((n) => n.id));
  };

  const getTimeAgo = (date) => {
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Agora";
    if (minutes < 60) return `${minutes}min`;
    if (hours < 24) return `${hours}h`;
    return `${days}d`;
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        padding: "12px 28px",
        borderBottom: `1px solid ${colors.border}`,
        background: "#fff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Sino de Notificações */}
        <div ref={notifRef} style={{ position: "relative" }}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            style={{
              background: showNotifications
                ? colors.blue + "15"
                : colors.surfaceLight,
              border: `1px solid ${showNotifications ? colors.blue + "30" : colors.border}`,
              borderRadius: 10,
              padding: "8px 10px",
              color: showNotifications ? colors.blue : colors.textMuted,
              cursor: "pointer",
              position: "relative",
              transition: "all 0.2s",
            }}
          >
            <Icons.Bell />
            {unreadCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 9,
                  background: colors.red,
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 4px",
                  animation: "pulse 2s infinite",
                }}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {/* Dropdown de Notificações */}
          {showNotifications && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                width: 380,
                background: "#fff",
                borderRadius: 16,
                boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
                border: `1px solid ${colors.border}`,
                zIndex: 1000,
                overflow: "hidden",
                animation: "fadeSlideUp 0.2s ease-out",
              }}
            >
              {/* Header */}
              <div
                style={{
                  padding: "16px 20px",
                  borderBottom: `1px solid ${colors.border}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <h3
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: colors.text,
                      margin: 0,
                    }}
                  >
                    Notificações
                  </h3>
                  <span style={{ fontSize: 12, color: colors.textMuted }}>
                    {unreadCount > 0
                      ? `${unreadCount} não lida${unreadCount > 1 ? "s" : ""}`
                      : "Todas lidas"}
                  </span>
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    style={{
                      background: "none",
                      border: "none",
                      color: colors.blue,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Marcar todas como lidas
                  </button>
                )}
              </div>

              {/* Lista de Notificações */}
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {notifications.length > 0 ? (
                  notifications.map((notif, i) => {
                    const isRead = readIds.includes(notif.id);
                    return (
                      <div
                        key={notif.id}
                        onClick={() => {
                          markAsRead(notif.id);
                          if (notif.action) onNotificationClick?.(notif.action);
                        }}
                        style={{
                          padding: "14px 20px",
                          borderBottom:
                            i < notifications.length - 1
                              ? `1px solid ${colors.border}`
                              : "none",
                          background: isRead
                            ? "transparent"
                            : `${colors.blue}05`,
                          cursor: "pointer",
                          transition: "background 0.2s",
                          display: "flex",
                          gap: 14,
                          alignItems: "flex-start",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background =
                            colors.surfaceLight)
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = isRead
                            ? "transparent"
                            : `${colors.blue}05`)
                        }
                      >
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 12,
                            background: `${notif.color}15`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 18,
                            flexShrink: 0,
                          }}
                        >
                          {notif.icon}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: isRead ? 500 : 600,
                              color: colors.text,
                              marginBottom: 4,
                            }}
                          >
                            {notif.title}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: colors.textMuted,
                              lineHeight: 1.4,
                            }}
                          >
                            {notif.message}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: colors.textMuted,
                              marginTop: 6,
                            }}
                          >
                            {getTimeAgo(notif.time)}
                          </div>
                        </div>
                        {!isRead && (
                          <div
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: "50%",
                              background: colors.blue,
                              marginTop: 6,
                            }}
                          />
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div style={{ padding: 40, textAlign: "center" }}>
                    <span
                      style={{
                        fontSize: 40,
                        display: "block",
                        marginBottom: 12,
                      }}
                    >
                      🔔
                    </span>
                    <span style={{ fontSize: 14, color: colors.textMuted }}>
                      Nenhuma notificação
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          style={{
            background: colors.surfaceLight,
            border: `1px solid ${colors.border}`,
            borderRadius: 10,
            padding: "8px 14px",
            color: colors.textMuted,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
          }}
        >
          <Icons.Help /> Ajuda
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════
// ─── DASHBOARD PAGE ───
// ═════════════════════════════
function DashboardPage({
  setPage,
  matchesData,
  empresas,
  associados,
  eventos,
  onRegenerateMatches,
}) {
  const [isRegenerating, setIsRegenerating] = useState(false);

  const totalEmpresas = empresas?.length || 0;
  const totalMatches = matchesData?.length || 0;
  const totalAssociados = associados?.length || 0;
  const totalEventos = eventos?.length || 0;
  const statusCounts = {
    Confirmed: matchesData?.filter((m) => m.status === "Confirmed").length || 0,
    Interested:
      matchesData?.filter((m) => m.status === "Interested").length || 0,
    Contacted: matchesData?.filter((m) => m.status === "Contacted").length || 0,
    Pending: matchesData?.filter((m) => m.status === "Pending").length || 0,
  };
  const avgScore =
    totalMatches > 0
      ? Math.round(
          matchesData.reduce((acc, m) => acc + (m.score || 0), 0) /
            totalMatches,
        )
      : 0;
  const taxaConversao =
    totalMatches > 0
      ? Math.round((statusCounts.Confirmed / totalMatches) * 100)
      : 0;
  const engajados =
    statusCounts.Confirmed + statusCounts.Interested + statusCounts.Contacted;
  const taxaEngajamento =
    totalMatches > 0 ? Math.round((engajados / totalMatches) * 100) : 0;
  const eventosAtivos =
    eventos?.filter((e) => e.status === "Ativo").length || 0;
  const setoresCounts = {};
  empresas?.forEach((e) => {
    const s = e.segmento || e.setor || "Outros";
    setoresCounts[s] = (setoresCounts[s] || 0) + 1;
  });
  const associadoMatches = {};
  matchesData?.forEach((m) => {
    if (m.associado)
      associadoMatches[m.associado] = (associadoMatches[m.associado] || 0) + 1;
  });
  const topAssociados = Object.entries(associadoMatches)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);
  const empresasPorTipo = {
    exportador: empresas?.filter((e) => e.tipo === "Exportador").length || 0,
    importador: empresas?.filter((e) => e.tipo === "Importador").length || 0,
    ambos: empresas?.filter((e) => e.tipo === "Ambos").length || 0,
  };

  // Paleta baseada em #1E1F36
  const p = {
    dark: "#1E1F36",
    mid: "#2d2f4e",
    accent: "#4f5bd5",
    accentLight: "#6c75e0",
    soft: "#eef0ff",
    text: "#1a1d26",
    sub: "#6b7280",
    bg: "#f8f9fc",
    border: "#e5e7ee",
    card: "#ffffff",
  };

  const DonutChart = ({ value, total, size = 72 }) => {
    const pct = total > 0 ? (value / total) * 100 : 0;
    const r = (size - 8) / 2 - 2;
    const c = 2 * Math.PI * r;
    const off = c - (pct / 100) * c;
    return (
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          flexShrink: 0,
        }}
      >
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={p.soft}
            strokeWidth={8}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={p.accent}
            strokeWidth={8}
            strokeDasharray={c}
            strokeDashoffset={off}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: size * 0.22,
              fontWeight: 800,
              color: p.text,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {Math.round(pct)}%
          </span>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 28, minHeight: "100%" }}>
      {/* Hero Banner */}
      <div
        style={{
          background: `linear-gradient(135deg, ${p.dark} 0%, ${p.mid} 100%)`,
          borderRadius: 16,
          padding: "24px 32px",
          marginBottom: 20,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: "#fff",
              marginBottom: 4,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Visão Geral
          </h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            ["nova-empresa", "+ Empresa"],
            ["novo-associado", "+ Associado"],
            ["novo-evento", "+ Evento"],
          ].map(([pg, lb]) => (
            <button
              key={pg}
              onClick={() => setPage(pg)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.8)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {lb}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Empresas"
          value={totalEmpresas}
          sub="cadastradas"
          color={p.accent}
        />
        <StatCard
          label="Associados"
          value={totalAssociados}
          sub="BRATECC"
          color="#6c5ce7"
          delay={0.05}
        />
        <StatCard
          label="Matches"
          value={totalMatches}
          sub={`${statusCounts.Confirmed} confirmados`}
          color="#00b894"
          delay={0.1}
        />
        <StatCard
          label="Eventos"
          value={totalEventos}
          sub={`${eventosAtivos} ativo${eventosAtivos !== 1 ? "s" : ""}`}
          color="#e17055"
          delay={0.15}
        />
      </div>

      {/* Performance + Pipeline */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            background: p.card,
            borderRadius: 14,
            border: `1px solid ${p.border}`,
            padding: "24px 28px",
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: p.text,
              marginBottom: 28,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Performance
          </h3>
          <div style={{ display: "flex", justifyContent: "space-around" }}>
            {[
              {
                label: "Conversão",
                value: taxaConversao,
                done: statusCounts.Confirmed,
                total: totalMatches,
              },
              {
                label: "Engajamento",
                value: taxaEngajamento,
                done: engajados,
                total: totalMatches,
              },
              {
                label: "Score IA",
                value: avgScore,
                done: avgScore,
                total: 100,
              },
            ].map((m, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <DonutChart value={m.done} total={m.total} size={84} />
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: p.text,
                    marginTop: 12,
                  }}
                >
                  {m.label}
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: p.accent,
                    fontVariantNumeric: "tabular-nums",
                    marginTop: 4,
                  }}
                >
                  {m.value}%
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            background: p.card,
            borderRadius: 14,
            border: `1px solid ${p.border}`,
            padding: "24px 28px",
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: p.text,
              marginBottom: 28,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Pipeline
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {[
              { label: "Pendentes", count: statusCounts.Pending, step: 1 },
              { label: "Contatados", count: statusCounts.Contacted, step: 2 },
              {
                label: "Interessados",
                count: statusCounts.Interested,
                step: 3,
              },
              { label: "Confirmados", count: statusCounts.Confirmed, step: 4 },
            ].map((s, i, arr) => {
              const maxC = Math.max(...arr.map((a) => a.count), 1);
              const w = Math.max((s.count / maxC) * 100, 8);
              const isLast = i === arr.length - 1;
              return (
                <div
                  key={i}
                  style={{ display: "flex", alignItems: "center", gap: 14 }}
                >
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: isLast ? p.accent : p.soft,
                      border: isLast ? "none" : `2px solid ${p.accent}30`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 12,
                      fontWeight: 700,
                      color: isLast ? "#fff" : p.accent,
                      flexShrink: 0,
                    }}
                  >
                    {s.step}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 5,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: isLast ? 700 : 500,
                          color: p.text,
                        }}
                      >
                        {s.label}
                      </span>
                      <span
                        style={{
                          fontSize: 16,
                          fontWeight: 800,
                          color: isLast ? p.accent : p.text,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {s.count}
                      </span>
                    </div>
                    <div
                      style={{ height: 8, borderRadius: 4, background: p.soft }}
                    >
                      <div
                        style={{
                          height: "100%",
                          borderRadius: 4,
                          width: `${w}%`,
                          background: isLast ? p.accent : p.mid,
                          opacity: isLast ? 1 : 0.3 + i * 0.2,
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Setores + Top Assoc + Perfil */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 14,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            background: p.card,
            borderRadius: 14,
            border: `1px solid ${p.border}`,
            padding: "24px 28px",
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: p.text,
              marginBottom: 20,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Setores
          </h3>
          {Object.keys(setoresCounts).length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {Object.entries(setoresCounts)
                .slice(0, 5)
                .map(([setor, count]) => {
                  const pct =
                    totalEmpresas > 0
                      ? Math.round((count / totalEmpresas) * 100)
                      : 0;
                  return (
                    <div key={setor}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 5,
                        }}
                      >
                        <span style={{ fontSize: 12, color: p.text }}>
                          {setor}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            fontVariantNumeric: "tabular-nums",
                            color: p.text,
                          }}
                        >
                          {count}
                        </span>
                      </div>
                      <div
                        style={{
                          height: 6,
                          borderRadius: 3,
                          background: p.soft,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 3,
                            width: `${pct}%`,
                            background: p.mid,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: 20,
                color: p.sub,
                fontSize: 13,
              }}
            >
              Sem dados
            </div>
          )}
        </div>

        <div
          style={{
            background: p.card,
            borderRadius: 14,
            border: `1px solid ${p.border}`,
            padding: "24px 28px",
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: p.text,
              marginBottom: 20,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Top Associados
          </h3>
          {topAssociados.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {topAssociados.map(([nome, count], i) => (
                <div
                  key={nome}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: i === 0 ? `${p.accent}08` : "transparent",
                    border:
                      i === 0
                        ? `1px solid ${p.accent}15`
                        : "1px solid transparent",
                  }}
                >
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      background: i === 0 ? p.accent : p.soft,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      color: i === 0 ? "#fff" : p.sub,
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      fontWeight: i === 0 ? 600 : 400,
                      color: p.text,
                    }}
                  >
                    {nome}
                  </span>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 800,
                      color: p.text,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: 20,
                color: p.sub,
                fontSize: 13,
              }}
            >
              Sem matches
            </div>
          )}
        </div>

        <div
          style={{
            background: p.card,
            borderRadius: 14,
            border: `1px solid ${p.border}`,
            padding: "24px 28px",
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: p.text,
              marginBottom: 20,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Perfil Empresas
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { label: "Exportadoras", count: empresasPorTipo.exportador },
              { label: "Importadoras", count: empresasPorTipo.importador },
              { label: "Ambos", count: empresasPorTipo.ambos },
            ].map((t, i) => {
              const pct =
                totalEmpresas > 0
                  ? Math.round((t.count / totalEmpresas) * 100)
                  : 0;
              return (
                <div key={i}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ fontSize: 12, color: p.text }}>
                      {t.label}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        fontVariantNumeric: "tabular-nums",
                        color: p.text,
                      }}
                    >
                      {t.count}
                    </span>
                  </div>
                  <div
                    style={{ height: 6, borderRadius: 3, background: p.soft }}
                  >
                    <div
                      style={{
                        height: "100%",
                        borderRadius: 3,
                        width: `${pct}%`,
                        background: p.mid,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Matches Recentes + Ações */}
      <div style={{ display: "grid", gridTemplateColumns: "5fr 2fr", gap: 14 }}>
        <div
          style={{
            background: p.card,
            borderRadius: 14,
            border: `1px solid ${p.border}`,
            padding: "24px 28px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <h3
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: p.text,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              Matches Recentes
            </h3>
            <button
              onClick={() => setPage("assoc-empresa")}
              style={{
                background: p.soft,
                border: "none",
                borderRadius: 8,
                padding: "6px 14px",
                color: p.accent,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Ver todos →
            </button>
          </div>
          {matchesData && matchesData.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {matchesData.slice(0, 5).map((m, i) => (
                <div
                  key={m.id || i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "12px 16px",
                    borderRadius: 10,
                    gap: 14,
                    border: `1px solid ${p.border}`,
                  }}
                >
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 10,
                      background: p.dark,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: "#fff",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {m.score}
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{ fontSize: 13, fontWeight: 600, color: p.text }}
                    >
                      {m.empresa}
                    </div>
                    <div style={{ fontSize: 11, color: p.sub }}>
                      ↔ {m.associado} · {m.produto}
                    </div>
                  </div>
                  <StatusBadge status={m.status} />
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                color: p.sub,
                fontSize: 13,
              }}
            >
              Nenhum match ainda
            </div>
          )}
        </div>

        <div
          style={{
            background: p.card,
            borderRadius: 14,
            border: `1px solid ${p.border}`,
            padding: "24px 28px",
          }}
        >
          <h3
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: p.text,
              marginBottom: 20,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Ações
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              ["assoc-empresa", "Ver Matches"],
              ["gestao-empresa", "Empresas"],
              ["gestao-associados", "Associados"],
              ["novo-evento", "Novo Evento"],
            ].map(([pg, lb], i) => (
              <button
                key={i}
                onClick={() => setPage(pg)}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: `1px solid ${p.border}`,
                  background: p.card,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 13,
                  fontWeight: 500,
                  color: p.text,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = p.soft)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = p.card)
                }
              >
                {lb}
                <span style={{ color: p.accent, fontSize: 14 }}>→</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssociadoDashboard({
  setPage,
  associadoLogado,
  matchesData = [],
  empresasData = [],
}) {
  const nomeAssociado = associadoLogado?.nome || "Associado BRATECC";
  const segmentoAssociado = associadoLogado?.segmento || "—";
  const meuId = associadoLogado?.id;

  // Helper pra normalizar o status que vem do banco em diferentes formas
  // (PENDING, Pending, pendente, etc) pra simplificar comparação.
  const normStatus = (s) => String(s || "").toUpperCase();

  // Filtra todos os matches Assoc × Empresa que pertencem ao associado logado.
  const meusMatches = (matchesData || []).filter((m) => {
    if (!meuId) return false;
    return (
      m.associadoId === meuId ||
      (m.associado?.id && m.associado.id === meuId) ||
      (typeof m.associado === "string" && m.associado === associadoLogado?.nome)
    );
  });

  // Conta matches por status
  const counts = {
    pendentes: 0,
    contatados: 0,
    interessados: 0,
    confirmados: 0,
    rejeitados: 0,
  };
  for (const m of meusMatches) {
    const s = normStatus(m.status);
    if (s === "PENDING" || s === "PENDENTE") counts.pendentes++;
    else if (s === "CONTACTED" || s === "CONTATADO") counts.contatados++;
    else if (s === "INTERESTED" || s === "INTERESSADO") counts.interessados++;
    else if (s === "CONFIRMED" || s === "CONFIRMADO") counts.confirmados++;
    else if (s === "REJECTED" || s === "REJEITADO") counts.rejeitados++;
  }
  const totalMatches = meusMatches.length;

  // ─── PARCERIAS CONFIRMADAS — empresas que aceitaram conectar ───
  // Lista as empresas com quem o associado tem match em status CONFIRMED.
  // Resolve dados completos da empresa pelo empresaId/nome do match.
  const parceriasConfirmadas = meusMatches
    .filter(
      (m) =>
        normStatus(m.status) === "CONFIRMED" ||
        normStatus(m.status) === "CONFIRMADO",
    )
    .map((m) => {
      let emp = null;
      if (m.empresa && typeof m.empresa === "object") {
        emp = m.empresa;
      } else if (m.empresaId) {
        emp = empresasData.find((e) => e.id === m.empresaId);
      } else if (typeof m.empresa === "string") {
        emp = empresasData.find((e) => e.nome === m.empresa);
      }
      return { match: m, empresa: emp };
    })
    .filter((x) => x.empresa);

  // Score médio dos matches
  const scoreMedio =
    totalMatches > 0
      ? Math.round(
          meusMatches.reduce((acc, m) => acc + (m.score || 0), 0) /
            totalMatches,
        )
      : 0;

  // Matches recentes não-rejeitados (top 4 por score)
  const matchesRecentes = meusMatches
    .filter(
      (m) =>
        normStatus(m.status) !== "REJECTED" &&
        normStatus(m.status) !== "REJEITADO",
    )
    .map((m) => {
      const emp =
        typeof m.empresa === "object" && m.empresa
          ? m.empresa
          : m.empresaId
            ? empresasData.find((e) => e.id === m.empresaId)
            : empresasData.find((e) => e.nome === m.empresa);
      return {
        id: m.id,
        empresa:
          emp?.nome || (typeof m.empresa === "string" ? m.empresa : "Empresa"),
        cidade: emp ? `${emp.cidade || "-"}, ${emp.estado || "-"}` : "-",
        tipo: emp?.tipo || "-",
        desc:
          m.observacoes ||
          m.produto ||
          emp?.necessidades ||
          "Oportunidade identificada",
        score: m.score || 0,
        status: normStatus(m.status),
        prioridade:
          (m.score || 0) >= 80
            ? "alta"
            : (m.score || 0) >= 60
              ? "media"
              : "baixa",
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return (
    <div style={{ padding: 28 }}>
      {/* Welcome Banner */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          padding: "28px 32px",
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundImage: `linear-gradient(135deg, ${colors.purple}08, ${colors.blue}05)`,
        }}
      >
        <div>
          <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 4 }}>
            Bem-vindo de volta
          </p>
          <h2
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 8,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {nomeAssociado} 👋
          </h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <span
              style={{
                padding: "4px 12px",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                background: `${colors.purple}15`,
                color: colors.purple,
              }}
            >
              {segmentoAssociado}
            </span>
          </div>
          <p style={{ fontSize: 14, color: colors.textMuted }}>
            {counts.pendentes > 0 ? (
              <>
                Você tem{" "}
                <span style={{ color: colors.orange, fontWeight: 700 }}>
                  {counts.pendentes} match{counts.pendentes > 1 ? "es" : ""}{" "}
                  pendente{counts.pendentes > 1 ? "s" : ""}
                </span>{" "}
                aguardando análise
              </>
            ) : counts.confirmados > 0 ? (
              <>
                Você tem{" "}
                <span style={{ color: colors.green, fontWeight: 700 }}>
                  {counts.confirmados} parceria
                  {counts.confirmados > 1 ? "s" : ""} confirmada
                  {counts.confirmados > 1 ? "s" : ""}
                </span>
              </>
            ) : (
              <>Nenhum match ativo no momento</>
            )}
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              onClick={() => setPage("assoc-empresa")}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: "none",
                background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
                color: "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Ver Matches
            </button>
            <button
              onClick={() => setPage("meu-perfil")}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Meu Perfil
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 90,
                height: 90,
                borderRadius: 20,
                background: `${colors.green}10`,
                border: `2px solid ${colors.green}30`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: colors.green,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {scoreMedio || "—"}
                {scoreMedio ? "%" : ""}
              </span>
              <span style={{ fontSize: 10, color: colors.textMuted }}>
                Score Médio
              </span>
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                width: 90,
                height: 90,
                borderRadius: 20,
                background: `${colors.blue}10`,
                border: `2px solid ${colors.blue}30`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: colors.blue,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {totalMatches}
              </span>
              <span style={{ fontSize: 10, color: colors.textMuted }}>
                Total Matches
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* KPIs Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {[
          {
            value: counts.pendentes,
            label: "Pendentes",
            icon: "⏳",
            color: colors.orange,
            sub: "aguardando análise",
          },
          {
            value: counts.contatados,
            label: "Contatados",
            icon: "📧",
            color: colors.cyan,
            sub: "HSM enviado",
          },
          {
            value: counts.interessados,
            label: "Interessados",
            icon: "👀",
            color: colors.blue,
            sub: "aguardando empresa",
          },
          {
            value: counts.confirmados,
            label: "Confirmadas",
            icon: "✅",
            color: colors.green,
            sub: "parcerias fechadas",
          },
        ].map((kpi, i) => (
          <div
            key={i}
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 14,
              padding: "18px 20px",
              animation: `fadeSlideUp 0.5s ease-out ${i * 0.1}s both`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 22 }}>{kpi.icon}</span>
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: kpi.color,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {kpi.value}
            </div>
            <div
              style={{
                fontSize: 12,
                color: colors.text,
                fontWeight: 600,
                marginTop: 2,
              }}
            >
              {kpi.label}
            </div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>
              {kpi.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ─── PARCERIAS CONFIRMADAS — destaque pra empresas que aceitaram ─── */}
      {parceriasConfirmadas.length > 0 && (
        <div
          style={{
            background: colors.surface,
            border: `2px solid ${colors.green}30`,
            borderRadius: 16,
            padding: 24,
            marginBottom: 24,
            backgroundImage: `linear-gradient(135deg, ${colors.green}06, transparent)`,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 18,
            }}
          >
            <div>
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: colors.text,
                  fontFamily: "'JetBrains Mono', monospace",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span>✅</span>
                <span>Parcerias Confirmadas</span>
              </h3>
              <p
                style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}
              >
                Empresas que aceitaram conectar com você. Use os dados de
                contato abaixo para finalizar a conversa de negócio diretamente.
              </p>
            </div>
            <span
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                fontSize: 12,
                fontWeight: 700,
                background: `${colors.green}15`,
                color: colors.green,
              }}
            >
              {parceriasConfirmadas.length} parceria
              {parceriasConfirmadas.length > 1 ? "s" : ""}
            </span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
              gap: 14,
            }}
          >
            {parceriasConfirmadas.map(({ match, empresa }) => (
              <div
                key={match.id}
                style={{
                  background: "#fff",
                  border: `1px solid ${colors.green}25`,
                  borderLeft: `4px solid ${colors.green}`,
                  borderRadius: 12,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: colors.text,
                        marginBottom: 3,
                      }}
                    >
                      {empresa.nome}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {empresa.setor || "Setor não informado"}
                      {empresa.cidade &&
                        ` · 📍 ${empresa.cidade}, ${empresa.estado || ""}`}
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 12,
                      fontSize: 10,
                      fontWeight: 700,
                      background: `${colors.green}15`,
                      color: colors.green,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {match.score || "—"}%
                  </span>
                </div>

                {match.produto && (
                  <div
                    style={{
                      fontSize: 12,
                      color: colors.textMuted,
                      marginBottom: 10,
                      lineHeight: 1.4,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>Sinergia: </span>
                    {match.produto}
                  </div>
                )}

                {/* Contatos da empresa */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    paddingTop: 10,
                    borderTop: `1px solid ${colors.border}`,
                  }}
                >
                  {empresa.email && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: colors.textMuted }}>📧</span>
                      <a
                        href={`mailto:${empresa.email}`}
                        style={{
                          color: colors.blue,
                          textDecoration: "none",
                          fontWeight: 600,
                        }}
                      >
                        {empresa.email}
                      </a>
                    </div>
                  )}
                  {empresa.telefone && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: colors.textMuted }}>📞</span>
                      <a
                        href={`https://wa.me/${empresa.telefone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: colors.green,
                          textDecoration: "none",
                          fontWeight: 600,
                        }}
                      >
                        {empresa.telefone}
                      </a>
                    </div>
                  )}
                  {!empresa.email && !empresa.telefone && (
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.textMuted,
                        fontStyle: "italic",
                      }}
                    >
                      Contatos não disponíveis. Fale com a BRATECC:
                      admin@bratecc.com
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline + Performance */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 24,
          }}
        >
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 20,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Seu Pipeline
          </h3>

          <div style={{ display: "flex", gap: 12 }}>
            {[
              {
                label: "Pendentes",
                count: counts.pendentes,
                color: colors.orange,
                icon: "⏳",
              },
              {
                label: "Contatados",
                count: counts.contatados,
                color: colors.purple,
                icon: "📧",
              },
              {
                label: "Interessados",
                count: counts.interessados,
                color: colors.blue,
                icon: "👀",
              },
              {
                label: "Confirmados",
                count: counts.confirmados,
                color: colors.green,
                icon: "✅",
              },
            ].map((stage, i) => (
              <div key={stage.label} style={{ flex: 1, position: "relative" }}>
                <div
                  style={{
                    background: `${stage.color}10`,
                    border: `1px solid ${stage.color}25`,
                    borderRadius: 12,
                    padding: 16,
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 18, marginBottom: 6 }}>
                    {stage.icon}
                  </div>
                  <div
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: stage.color,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {stage.count}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: colors.textMuted,
                      marginTop: 4,
                    }}
                  >
                    {stage.label}
                  </div>
                </div>
                {i < 3 && (
                  <div
                    style={{
                      position: "absolute",
                      right: -8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: colors.textMuted,
                      fontSize: 14,
                      zIndex: 1,
                    }}
                  >
                    →
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalMatches > 0 && (
            <div
              style={{
                marginTop: 20,
                padding: 16,
                background: `${colors.green}08`,
                borderRadius: 12,
                border: `1px solid ${colors.green}20`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: colors.green,
                    }}
                  >
                    Taxa de Conversão
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    Parcerias confirmadas / Total de matches
                  </div>
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    color: colors.green,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {Math.round((counts.confirmados / totalMatches) * 100)}%
                </div>
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 24,
          }}
        >
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 20,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Resumo
          </h3>
          {[
            {
              label: "Score médio",
              value: scoreMedio,
              color: colors.blue,
              display: scoreMedio ? `${scoreMedio}%` : "—",
            },
            {
              label: "Taxa de conversão",
              value:
                totalMatches > 0
                  ? Math.round((counts.confirmados / totalMatches) * 100)
                  : 0,
              color: colors.green,
              display:
                totalMatches > 0
                  ? `${Math.round((counts.confirmados / totalMatches) * 100)}%`
                  : "—",
            },
            {
              label: "Engajamento",
              value:
                totalMatches > 0
                  ? Math.round(
                      ((counts.contatados +
                        counts.interessados +
                        counts.confirmados) /
                        totalMatches) *
                        100,
                    )
                  : 0,
              color: colors.purple,
              display:
                totalMatches > 0
                  ? `${Math.round(((counts.contatados + counts.interessados + counts.confirmados) / totalMatches) * 100)}%`
                  : "—",
            },
          ].map((p) => (
            <div key={p.label} style={{ marginBottom: 16 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 12, color: colors.textMuted }}>
                  {p.label}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: p.color,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {p.display}
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 3,
                  background: colors.surfaceLight,
                }}
              >
                <div
                  style={{
                    height: "100%",
                    borderRadius: 3,
                    width: `${p.value}%`,
                    background: p.color,
                    transition: "width 1s ease-out",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Matches Recentes (todos não-rejeitados, top 4 por score) */}
      {matchesRecentes.length > 0 && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <div>
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 800,
                  color: colors.text,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Seus Matches
              </h3>
              <p
                style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}
              >
                Top {matchesRecentes.length} por compatibilidade
              </p>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
              gap: 16,
            }}
          >
            {matchesRecentes.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: 16,
                  background: colors.surfaceLight,
                  borderRadius: 14,
                  gap: 14,
                  border: `1px solid ${m.prioridade === "alta" ? colors.green : colors.border}20`,
                }}
              >
                <ScoreCircle score={m.score} size={52} />
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: colors.text,
                      }}
                    >
                      {m.empresa}
                    </span>
                    <PriorityBadge
                      prioridade={m.prioridade}
                      showLabel={false}
                    />
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: colors.textMuted,
                      marginBottom: 4,
                    }}
                  >
                    📍 {m.cidade} • {m.tipo}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted }}>
                    {m.desc}
                  </div>
                </div>
                <span
                  style={{
                    padding: "3px 10px",
                    borderRadius: 10,
                    fontSize: 10,
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                    ...(statusColors[m.status]
                      ? {
                          background: statusColors[m.status].bg,
                          color: statusColors[m.status].text,
                        }
                      : {
                          background: colors.surface,
                          color: colors.textMuted,
                        }),
                  }}
                >
                  {statusLabels[m.status] || m.status}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={() => setPage("assoc-empresa")}
            style={{
              width: "100%",
              padding: "14px 0",
              marginTop: 20,
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            Ver Todos os Matches →
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════
// ─── MEU PERFIL PAGE ───
// ═══════════════════════════════
function MeuPerfilPage({ associadoLogado, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [form, setForm] = useState({
    nome: associadoLogado?.nome || "",
    segmento: associadoLogado?.segmento || "",
    porte: associadoLogado?.porte || "",
    email: associadoLogado?.email || "",
    telefone: associadoLogado?.telefone || "",
    whatsapp: associadoLogado?.whatsapp || "",
    servicos: associadoLogado?.servicos || "",
    produtosOferecidos: associadoLogado?.produtosOferecidos || "",
    produtosDemandados: associadoLogado?.produtosDemandados || "",
  });

  const handleSave = () => {
    if (!form.nome?.trim()) return;
    setSaving(true);
    setTimeout(() => {
      if (onUpdate && associadoLogado?.id) onUpdate(associadoLogado.id, form);
      setSaving(false);
      setEditing(false);
      setSuccessMsg("Dados atualizados com sucesso!");
      setTimeout(() => setSuccessMsg(""), 4000);
    }, 800);
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm({
      nome: associadoLogado?.nome || "",
      segmento: associadoLogado?.segmento || "",
      porte: associadoLogado?.porte || "",
      email: associadoLogado?.email || "",
      telefone: associadoLogado?.telefone || "",
      whatsapp: associadoLogado?.whatsapp || "",
      servicos: associadoLogado?.servicos || "",
      produtosOferecidos: associadoLogado?.produtosOferecidos || "",
      produtosDemandados: associadoLogado?.produtosDemandados || "",
    });
  };

  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: editing ? "#fff" : colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };
  const lbl = {
    fontSize: 11,
    fontWeight: 700,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    display: "block",
    marginBottom: 7,
  };

  return (
    <div style={{ padding: 28, maxWidth: 800, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 28,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Meu Perfil
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            Dados cadastrais do associado BRATECC
          </p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: colors.purple,
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            Editar Dados
          </button>
        )}
      </div>

      {successMsg && (
        <div
          style={{
            background: `${colors.green}10`,
            border: `1px solid ${colors.green}30`,
            borderRadius: 12,
            padding: "12px 18px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>✅</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.green }}>
            {successMsg}
          </span>
        </div>
      )}

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {/* Header do card */}
        <div
          style={{
            background: `linear-gradient(135deg, ${colors.dark} 0%, ${colors.mid} 100%)`,
            padding: "24px 28px",
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "rgba(255,255,255,0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
            }}
          >
            👤
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>
              {form.nome || "Associado"}
            </div>
            <div
              style={{
                fontSize: 13,
                color: "rgba(255,255,255,0.6)",
                marginTop: 2,
              }}
            >
              {form.segmento} · {form.porte || "—"}
            </div>
          </div>
        </div>

        {/* Corpo */}
        <div style={{ padding: "28px 28px" }}>
          {/* Dados básicos */}
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 16,
            }}
          >
            Dados Básicos
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 16,
              marginBottom: 28,
            }}
          >
            <div>
              <label style={lbl}>Nome / Razão Social</label>
              {editing ? (
                <input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  style={fld}
                />
              ) : (
                <div
                  style={{ fontSize: 14, fontWeight: 600, color: colors.text }}
                >
                  {form.nome || "—"}
                </div>
              )}
            </div>
            <div>
              <label style={lbl}>Segmento</label>
              {editing ? (
                <select
                  value={form.segmento}
                  onChange={(e) =>
                    setForm({ ...form, segmento: e.target.value })
                  }
                  style={fld}
                >
                  {[
                    "Financial Services",
                    "Logistics & Supply Chain",
                    "Legal & Compliance",
                    "Technology & IT",
                    "Consulting",
                    "Agriculture & Food",
                    "Energy",
                    "Industry",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 14, color: colors.text }}>
                  {form.segmento || "—"}
                </div>
              )}
            </div>
            <div>
              <label style={lbl}>Porte</label>
              {editing ? (
                <select
                  value={form.porte}
                  onChange={(e) => setForm({ ...form, porte: e.target.value })}
                  style={fld}
                >
                  {["Pequeno", "Médio", "Grande"].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 14, color: colors.text }}>
                  {form.porte || "—"}
                </div>
              )}
            </div>
          </div>

          {/* Contato */}
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 16,
            }}
          >
            Contato
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 16,
              marginBottom: 28,
            }}
          >
            <div>
              <label style={lbl}>E-mail</label>
              {editing ? (
                <input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  style={fld}
                />
              ) : (
                <div style={{ fontSize: 14, color: colors.text }}>
                  {form.email || "—"}
                </div>
              )}
            </div>
            <div>
              <label style={lbl}>Telefone</label>
              {editing ? (
                <input
                  value={form.telefone}
                  onChange={(e) =>
                    setForm({ ...form, telefone: e.target.value })
                  }
                  style={fld}
                />
              ) : (
                <div style={{ fontSize: 14, color: colors.text }}>
                  {form.telefone || "—"}
                </div>
              )}
            </div>
            <div>
              <label style={lbl}>WhatsApp</label>
              {editing ? (
                <input
                  value={form.whatsapp}
                  onChange={(e) =>
                    setForm({ ...form, whatsapp: e.target.value })
                  }
                  style={fld}
                />
              ) : (
                <div style={{ fontSize: 14, color: colors.green }}>
                  {form.whatsapp || "—"}
                </div>
              )}
            </div>
          </div>

          {/* Serviços e Produtos */}
          <h3
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 16,
            }}
          >
            Serviços e Produtos
          </h3>
          <div style={{ marginBottom: 20 }}>
            <label style={lbl}>Serviços</label>
            {editing ? (
              <textarea
                value={form.servicos}
                onChange={(e) => setForm({ ...form, servicos: e.target.value })}
                style={{ ...fld, minHeight: 60, resize: "none" }}
              />
            ) : (
              <div
                style={{ fontSize: 13, color: colors.text, lineHeight: 1.6 }}
              >
                {form.servicos || "—"}
              </div>
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 28,
            }}
          >
            <div>
              <label style={{ ...lbl, color: colors.green }}>
                📤 Produtos/Serviços Oferecidos
              </label>
              {editing ? (
                <textarea
                  value={form.produtosOferecidos}
                  onChange={(e) =>
                    setForm({ ...form, produtosOferecidos: e.target.value })
                  }
                  style={{ ...fld, minHeight: 80, resize: "none" }}
                />
              ) : (
                <div
                  style={{
                    fontSize: 13,
                    color: colors.text,
                    lineHeight: 1.6,
                    background: `${colors.green}06`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    border: `1px solid ${colors.green}15`,
                  }}
                >
                  {form.produtosOferecidos || "—"}
                </div>
              )}
            </div>
            <div>
              <label style={{ ...lbl, color: colors.blue }}>
                📥 Produtos/Serviços Demandados
              </label>
              {editing ? (
                <textarea
                  value={form.produtosDemandados}
                  onChange={(e) =>
                    setForm({ ...form, produtosDemandados: e.target.value })
                  }
                  style={{ ...fld, minHeight: 80, resize: "none" }}
                />
              ) : (
                <div
                  style={{
                    fontSize: 13,
                    color: colors.text,
                    lineHeight: 1.6,
                    background: `${colors.blue}06`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    border: `1px solid ${colors.blue}15`,
                  }}
                >
                  {form.produtosDemandados || "—"}
                </div>
              )}
            </div>
          </div>

          {/* Ações de edição */}
          {editing && (
            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "flex-end",
                paddingTop: 16,
                borderTop: `1px solid ${colors.border}`,
              }}
            >
              <button
                onClick={cancelEdit}
                style={{
                  padding: "11px 24px",
                  borderRadius: 10,
                  border: `1px solid ${colors.border}`,
                  background: "#fff",
                  color: colors.text,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "11px 28px",
                  borderRadius: 10,
                  border: "none",
                  background: saving
                    ? colors.surfaceLight
                    : `linear-gradient(135deg, ${colors.green}, #00a066)`,
                  color: "#fff",
                  cursor: saving ? "wait" : "pointer",
                  fontSize: 13,
                  fontWeight: 700,
                  boxShadow: saving ? "none" : `0 4px 12px ${colors.green}30`,
                }}
              >
                {saving ? "⏳ Salvando..." : "Salvar alterações"}
              </button>
            </div>
          )}
        </div>
      </div>

      {!editing && (
        <div
          style={{
            background: `${colors.purple}06`,
            border: `1px solid ${colors.purple}15`,
            borderRadius: 12,
            padding: "14px 18px",
            marginTop: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>🤖</span>
          <span style={{ fontSize: 13, color: colors.textMuted }}>
            A IA usa seus dados de serviços e produtos para encontrar as
            melhores empresas parceiras. Mantenha suas informações atualizadas.
          </span>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════
// ─── ASSOCIADOS × EMPRESAS PAGE ───
// ═════════════════════════════════════
function MatchesPage({
  matchesData,
  role = "admin",
  onRegenerateMatches,
  associadoLogado,
  associados = [],
  empresas = [],
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [associadoFilter, setAssociadoFilter] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [hsmResult, setHsmResult] = useState(null);
  const [sendingIds, setSendingIds] = useState(new Set());
  const [sentIds, setSentIds] = useState(new Set());

  const isAdmin = role === "admin";

  // ─── GERAR TODAS AS COMBINAÇÕES POSSÍVEIS ENTRE ASSOC E EMPRESAS ───
  // Score = sempre o que está no banco (calculado pelo Gemini no backend).
  // Se não houver match ainda, score fica null (mostrado como "—" na UI).
  // Não calculamos score localmente — score é proximidade real entre os dois
  // perfis, gerada pela IA, e não muda por o usuário ter ou não gerado o match.
  //
  // Empresas com eventoOrigemId (inscritas via link público de evento) NÃO
  // entram nos matches normais. Elas só são visíveis no contexto do evento
  // específico que originou a inscrição.
  //
  // Mapa pra lookup rápido: empresaId → eventoOrigemId. Empresas sem entrada
  // no mapa ou com eventoOrigemId null/undefined passam.
  const empresasRestritasIds = new Set(
    empresas.filter((e) => e.eventoOrigemId).map((e) => e.id),
  );
  const empresasRestritasNomes = new Set(
    empresas.filter((e) => e.eventoOrigemId).map((e) => e.nome),
  );
  const empresasParaMatch = empresas.filter((e) => !e.eventoOrigemId);
  const allCombinations = [];

  if (isAdmin) {
    associados.forEach((assoc) => {
      empresasParaMatch.forEach((emp) => {
        const existingMatch = matchesData.find(
          (m) =>
            (m.associado === assoc.nome && m.empresa === emp.nome) ||
            (m.associadoId === assoc.id && m.empresaId === emp.id),
        );

        if (existingMatch) {
          allCombinations.push({
            ...existingMatch,
            assocObj: assoc,
            empObj: emp,
            hasMatch: true,
          });
        } else {
          // Sem match no banco ainda. Score = null. Mostra como "—" na UI.
          allCombinations.push({
            id: `potential-${assoc.id}-${emp.id}`,
            empresa: emp.nome,
            cidade: `${emp.cidade || ""}, ${emp.estado || ""}`.replace(
              /^, |, $/g,
              "",
            ),
            associado: assoc.nome,
            produto:
              emp.produtosDemandados?.split(",")[0]?.trim() ||
              emp.segmento ||
              "Serviço geral",
            score: null,
            status: "Pendente",
            assocObj: assoc,
            empObj: emp,
            hasMatch: false,
          });
        }
      });
    });
  } else {
    matchesData
      .filter((m) => m.associado === associadoLogado?.nome)
      .forEach((m) => {
        allCombinations.push({ ...m, hasMatch: true });
      });
  }

  // Defesa final: filtra QUALQUER combinação cuja empresa esteja restrita a evento.
  // Cobre o caso de matchesData ter trazido um match histórico de empresa que
  // depois virou restrita, ou de associadoLogado vir com matches de empresas
  // de evento.
  const allCombinationsFiltered = allCombinations.filter((c) => {
    if (c.empObj?.eventoOrigemId) return false;
    if (c.empresaId && empresasRestritasIds.has(c.empresaId)) return false;
    if (typeof c.empresa === "string" && empresasRestritasNomes.has(c.empresa))
      return false;
    return true;
  });
  // Substituímos a referência pra que todo o resto do componente use a versão
  // limpa sem precisar reescrever cada acesso.
  allCombinations.length = 0;
  allCombinations.push(...allCombinationsFiltered);

  // Filtrar e ordenar por score
  const allAssocNames = [...new Set(allCombinations.map((m) => m.associado))];
  const allStatuses = [...new Set(allCombinations.map((m) => m.status))];

  const filtered = allCombinations
    .filter((m) => {
      const matchSearch =
        !searchTerm ||
        m.empresa?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.associado?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.cidade?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = !statusFilter || m.status === statusFilter;
      const matchAssoc = !associadoFilter || m.associado === associadoFilter;
      return matchSearch && matchStatus && matchAssoc;
    })
    .sort(
      (a, b) =>
        (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score),
    );

  const stats = {
    total: allCombinations.length,
    matched: allCombinations.filter((m) => m.hasMatch).length,
    alta: allCombinations.filter((m) => m.score >= 80).length,
    contacted: allCombinations.filter(
      (m) => m.status === "Contacted" || m.status === "CONTACTED",
    ).length,
    confirmed: allCombinations.filter(
      (m) => m.status === "Confirmed" || m.status === "CONFIRMED",
    ).length,
  };

  const getScoreColor = (score) => {
    if (score >= 85) return colors.green;
    if (score >= 70) return colors.blue;
    if (score >= 50) return colors.orange;
    return colors.red;
  };

  const getPriorityLabel = (score) => {
    if (score == null)
      return { label: "—", color: colors.textMuted, bg: colors.surfaceLight };
    if (score >= 80)
      return { label: "ALTA", color: colors.green, bg: `${colors.green}15` };
    if (score >= 60)
      return { label: "MÉDIA", color: colors.orange, bg: `${colors.orange}15` };
    return { label: "BAIXA", color: colors.textMuted, bg: colors.surfaceLight };
  };

  const getRankBadge = (rank) => {
    if (rank === 1) return { color: colors.green, label: `${rank}º` };
    if (rank === 2) return { color: colors.blue, label: `${rank}º` };
    if (rank === 3) return { color: colors.orange, label: `${rank}º` };
    return { color: colors.textMuted, label: `${rank}º` };
  };

  const handleGenerateAndContact = async () => {
    if (!onRegenerateMatches) return;
    setIsGenerating(true);
    setHsmResult(null);
    try {
      const newMatches = await onRegenerateMatches();
      const total = Array.isArray(newMatches)
        ? newMatches.length
        : filtered.length;
      const novos = newMatches?.novos ?? 0;
      const hsmInfo = newMatches?.hsmInfo;

      if (hsmInfo && hsmInfo.errors && hsmInfo.errors.length > 0) {
        // Houve erro real no envio HSM — mostrar mensagem explicativa
        setHsmResult({
          success: false,
          message: `${total} matches no banco · ${hsmInfo.sent} hsmbra enviado(s) · ${hsmInfo.failed} falha(s). Erro: ${hsmInfo.errors[0]}`,
        });
      } else if (hsmInfo && hsmInfo.sent > 0) {
        setHsmResult({
          success: true,
          message: `${novos} novo(s) match(es) · ${hsmInfo.sent} hsmbra enviado(s) aos Associados. Quando responderem, a IA dispara o hsmbrac às Empresas automaticamente.`,
        });
      } else if (novos === 0) {
        setHsmResult({
          success: true,
          message: `Nenhum match novo (todos os pares já existem no banco). Para regerar, delete os matches existentes ou rode 'make seed-minimal'.`,
        });
      } else {
        setHsmResult({
          success: false,
          message: `${novos} match(es) gerado(s) mas o HSM não foi enviado. Verifique se os associados têm WhatsApp/telefone cadastrado e cheque os logs (docker compose logs backend).`,
        });
      }
      setTimeout(() => setHsmResult(null), 10000);
    } catch (e) {
      setHsmResult({
        success: false,
        message: `Erro: ${e.message || "verifique a conexão e os logs do backend"}`,
      });
      setTimeout(() => setHsmResult(null), 8000);
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── DISPARO WHATSAPP INDIVIDUAL POR LINHA ───
  // Regra v15 (handshake 2 etapas): SEMPRE dispara hsmbra pro associado primeiro.
  // A empresa só recebe hsmbrac depois que o associado responder com interesse.
  const handleSendWhatsApp = async (m) => {
    const matchKey = `${m.associado}-${m.empresa}`;
    setSendingIds((prev) => new Set([...prev, matchKey]));

    try {
      const empresaObj = m.empObj || empresas.find((e) => e.nome === m.empresa);
      const assocObj =
        m.assocObj || associados.find((a) => a.nome === m.associado);

      if (!empresaObj || !assocObj) {
        setHsmResult({ success: false, message: `Dados não encontrados` });
        setTimeout(() => setHsmResult(null), 4000);
        return;
      }

      // Garantir match no backend.
      // Score NÃO é problema desse fluxo — score é gerado pelo cadastro de
      // empresa/associado e atualizado pelo cron horário. Aqui só registramos
      // que o match existe pra rastrear o envio do HSM.
      let matchId = null;
      if (empresaObj.id && assocObj.id) {
        const saved = await api
          .post("/matches", {
            empresaId: empresaObj.id,
            associadoId: assocObj.id,
            produto:
              m.produto || empresaObj.produtosDemandados || "Serviço geral",
          })
          .catch(() => null);
        matchId = saved?.id;
      }

      // Enviar HSM via endpoint em lote (já vai só pro associado, com anti-duplicação)
      let sent = false;
      let skipped = false;
      let backendError = null;
      if (matchId) {
        const result = await api
          .post("/whatsapp/send-hsm-matches", { matchIds: [matchId] })
          .catch((err) => {
            backendError = err.message;
            return null;
          });
        if (result?.sent > 0) sent = true;
        if (result?.skipped > 0) skipped = true;
        // Se nada foi enviado, captura erro do primeiro detail (se houver)
        if (
          !sent &&
          !skipped &&
          Array.isArray(result?.details) &&
          result.details[0]?.error
        ) {
          backendError = String(result.details[0].error).substring(0, 200);
        }
      }

      // Fallback: se o lote falhou, manda direto MAS sempre pro associado
      if (!sent && !skipped) {
        const assocPhone = assocObj.whatsapp || assocObj.telefone;
        if (assocPhone) {
          const r = await api
            .post("/whatsapp/send-hsm", {
              to: assocPhone,
              nome: assocObj.nome,
              segmento: assocObj.segmento || "Geral",
              produtoDemandado:
                m.produto ||
                empresaObj.necessidades ||
                empresaObj.produtosDemandados ||
                "Oportunidades comerciais",
            })
            .catch((err) => {
              backendError = err.message;
              return null;
            });
          if (r?.success) sent = true;
        } else {
          backendError =
            backendError ||
            `Associado ${assocObj.nome} não tem WhatsApp/telefone cadastrado`;
        }
      }

      if (sent) {
        setSentIds((prev) => new Set([...prev, matchKey]));
        setHsmResult({
          success: true,
          message: `hsmbra enviado para ${m.associado}. Aguardando resposta para contatar ${m.empresa}.`,
        });
      } else if (skipped) {
        setHsmResult({
          success: false,
          message: `Match já foi processado anteriormente (anti-duplicação)`,
        });
      } else {
        setHsmResult({
          success: false,
          message:
            backendError ||
            `Falha no envio. Verifique os logs do backend (docker compose logs backend) e o diagnóstico em /api/whatsapp/diagnostico.`,
        });
      }
    } catch (e) {
      setHsmResult({ success: false, message: `Erro: ${e.message}` });
    } finally {
      setSendingIds((prev) => {
        const n = new Set(prev);
        n.delete(matchKey);
        return n;
      });
      setTimeout(() => setHsmResult(null), 5000);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {isAdmin ? "Assoc × Empresa" : "Minhas Oportunidades"}
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {isAdmin
              ? `${associados.length} associados × ${empresasParaMatch.length} empresas — ${allCombinations.length} combinações possíveis`
              : `Oportunidades de negócio para ${associadoLogado?.nome || "você"}`}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={handleGenerateAndContact}
            disabled={isGenerating}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              background: isGenerating
                ? colors.surfaceLight
                : `linear-gradient(135deg, ${colors.green}, ${colors.green}cc)`,
              color: isGenerating ? colors.textMuted : "#fff",
              cursor: isGenerating ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            {isGenerating ? (
              <>
                <IconLoader /> Enviando...
              </>
            ) : (
              <>
                <Icons.Sparkles /> Gerar Matches
              </>
            )}
          </button>
        )}
      </div>

      {/* HSM Result Banner */}
      {hsmResult && (
        <div
          style={{
            background: hsmResult.success
              ? `${colors.green}10`
              : `${colors.orange}10`,
            border: `1px solid ${hsmResult.success ? colors.green : colors.orange}30`,
            borderRadius: 12,
            padding: "14px 20px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              color: hsmResult.success ? colors.green : colors.orange,
              display: "flex",
            }}
          >
            {hsmResult.success ? <Icons.Check /> : <IconAlert />}
          </span>
          <span
            style={{
              fontSize: 13,
              color: hsmResult.success ? colors.green : colors.orange,
              fontWeight: 600,
            }}
          >
            {hsmResult.message}
          </span>
        </div>
      )}

      {/* Stats Cards */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard label="Combinações" value={stats.total} color={colors.blue} />
        <StatCard
          label="Com Match"
          value={stats.matched}
          color={colors.green}
          delay={0.05}
        />
        <StatCard
          label="Alta Compat."
          value={stats.alta}
          color={colors.orange}
          delay={0.1}
        />
        <StatCard
          label="Contactados"
          value={stats.contacted}
          color={colors.cyan}
          delay={0.15}
        />
        <StatCard
          label="Confirmados"
          value={stats.confirmed}
          color={colors.purple}
          delay={0.2}
        />
      </div>

      {/* Filters Bar */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: 2 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Buscar
          </label>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.textMuted,
              }}
            >
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Buscar empresa ou associado..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px 10px 38px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.text,
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 13,
              outline: "none",
              appearance: "auto",
            }}
          >
            <option value="">Todos</option>
            {allStatuses.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s] || s}
              </option>
            ))}
          </select>
        </div>
        {isAdmin && (
          <div style={{ flex: 1 }}>
            <label
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: colors.textMuted,
                letterSpacing: 0.8,
                display: "block",
                marginBottom: 8,
                textTransform: "uppercase",
              }}
            >
              Associado
            </label>
            <select
              value={associadoFilter}
              onChange={(e) => setAssociadoFilter(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.text,
                fontSize: 13,
                outline: "none",
                appearance: "auto",
              }}
            >
              <option value="">Todos</option>
              {allAssocNames.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        )}
        <button
          onClick={() => {
            setSearchTerm("");
            setStatusFilter("");
            setAssociadoFilter("");
          }}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceLight,
            color: colors.textMuted,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Limpar
        </button>
      </div>

      {/* Results Count */}
      <div style={{ marginBottom: 16, fontSize: 13, color: colors.textMuted }}>
        {filtered.length > 0 ? (
          <>
            Mostrando{" "}
            <span style={{ fontWeight: 700, color: colors.text }}>
              {filtered.length}
            </span>{" "}
            combinações por{" "}
            <span style={{ fontWeight: 700, color: colors.green }}>score</span>{" "}
            · {stats.matched} com match ativo
          </>
        ) : (
          <>
            {isAdmin
              ? "Clique em 'Gerar Matches e Enviar WhatsApp' para a IA calcular compatibilidades e contactar via HSM"
              : "Nenhuma oportunidade encontrada ainda"}
          </>
        )}
      </div>

      {/* ═══ TABELA PRINCIPAL: ASSOC × EMPRESA POR SCORE ═══ */}
      {filtered.length > 0 && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    background: colors.surfaceLight,
                  }}
                >
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      width: 60,
                    }}
                  >
                    Rank
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Associado
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Score
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Empresa
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Serviço / Produto
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Prioridade
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Status
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m, index) => {
                  const rank = index + 1;
                  const rankBadge = getRankBadge(rank);
                  const priority = getPriorityLabel(m.score);
                  const wasContacted =
                    m.status === "Contacted" ||
                    m.status === "CONTACTED" ||
                    m.status === "Confirmed" ||
                    m.status === "CONFIRMED";
                  return (
                    <tr
                      key={m.id}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        transition: "background 0.15s",
                        background:
                          rank <= 3 ? `${rankBadge.color}08` : "transparent",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = `${colors.blue}08`)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background =
                          rank <= 3 ? `${rankBadge.color}08` : "transparent")
                      }
                    >
                      {/* Rank */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: rankBadge.color,
                          }}
                        >
                          {rankBadge.label}
                        </span>
                      </td>
                      {/* Associado */}
                      <td style={{ padding: "14px 16px" }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: colors.purple,
                          }}
                        >
                          {m.associado}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: colors.textMuted,
                            marginTop: 2,
                          }}
                        >
                          {associados.find((a) => a.nome === m.associado)
                            ?.segmento || "Associado BRATECC"}
                        </div>
                      </td>
                      {/* Score */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        {m.score == null ? (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 14px",
                              borderRadius: 20,
                              background: colors.surfaceLight,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: colors.textMuted,
                                fontStyle: "italic",
                              }}
                            >
                              —
                            </span>
                          </div>
                        ) : (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 14px",
                              borderRadius: 20,
                              background: `${getScoreColor(m.score)}15`,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 17,
                                fontWeight: 800,
                                color: getScoreColor(m.score),
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              {m.score}%
                            </span>
                          </div>
                        )}
                      </td>
                      {/* Empresa */}
                      <td style={{ padding: "14px 16px" }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: colors.text,
                          }}
                        >
                          {m.empresa}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: colors.textMuted,
                            marginTop: 2,
                          }}
                        >
                          {m.cidade}
                        </div>
                      </td>
                      {/* Serviço */}
                      <td
                        style={{
                          padding: "14px 16px",
                          fontSize: 13,
                          color: colors.textMuted,
                        }}
                      >
                        {m.produto}
                      </td>
                      {/* Prioridade */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 700,
                            background: priority.bg,
                            color: priority.color,
                          }}
                        >
                          {priority.label}
                        </span>
                      </td>
                      {/* Status */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        {m.hasMatch ? (
                          <StatusBadge status={m.status} />
                        ) : (
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              background: `${colors.blue}12`,
                              color: colors.blue,
                              border: `1px dashed ${colors.blue}30`,
                            }}
                          >
                            POTENCIAL
                          </span>
                        )}
                      </td>
                      {/* Ações: WhatsApp + Email */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        {(() => {
                          const matchKey = `${m.associado}-${m.empresa}`;
                          const isSending = sendingIds.has(matchKey);
                          const wasSent = sentIds.has(matchKey) || wasContacted;
                          return (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                gap: 6,
                              }}
                            >
                              <button
                                onClick={() => handleSendWhatsApp(m)}
                                disabled={isSending || wasSent}
                                title={
                                  wasSent
                                    ? "WhatsApp já enviado"
                                    : "Enviar WhatsApp"
                                }
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: 8,
                                  border: "none",
                                  background: wasSent
                                    ? `${colors.green}15`
                                    : isSending
                                      ? colors.surfaceLight
                                      : `${colors.green}12`,
                                  color: wasSent
                                    ? colors.green
                                    : isSending
                                      ? colors.textMuted
                                      : colors.green,
                                  cursor:
                                    isSending || wasSent
                                      ? "default"
                                      : "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  padding: 0,
                                  border: `1px solid ${wasSent ? colors.green + "40" : colors.green + "30"}`,
                                }}
                              >
                                {wasSent ? (
                                  <Icons.Check />
                                ) : isSending ? (
                                  <span style={{ fontSize: 12 }}>⏳</span>
                                ) : (
                                  <Icons.Phone />
                                )}
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Rodapé da tabela */}
          <div
            style={{
              padding: "12px 20px",
              borderTop: `1px solid ${colors.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {filtered.length} resultados · Ordenados por score de
              compatibilidade (maior → menor)
            </span>
            <span
              style={{ fontSize: 11, color: colors.green, fontWeight: 600 }}
            >
              HSM: hsmbra (início, vai pro associado) → hsmbrac (avanço, vai pra
              empresa após aceite)
            </span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {filtered.length === 0 && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 60,
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "flex",
              justifyContent: "center",
              color: colors.textMuted,
              marginBottom: 16,
            }}
          >
            <Icons.Target />
          </span>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            {isAdmin
              ? "Nenhum match gerado ainda"
              : "Nenhuma oportunidade para você ainda"}
          </h3>
          <p
            style={{
              fontSize: 14,
              color: colors.textMuted,
              maxWidth: 460,
              margin: "0 auto",
            }}
          >
            {isAdmin
              ? "Clique em 'Gerar Matches' para que a IA calcule a compatibilidade entre Associados e Empresas. O sistema vai disparar o HSM hsmbra para os Associados primeiro — quando aceitarem, a IA contata as Empresas automaticamente com o hsmbrac."
              : "O administrador ainda não gerou oportunidades. Aguarde ou entre em contato."}
          </p>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════
// ─── REDE B2B PAGE ───
// ═══════════════════════
function B2BPage({
  role = "admin",
  onRegenerateMatches,
  associadoLogado,
  associados = [],
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoriaFilter, setCategoriaFilter] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [hsmResult, setHsmResult] = useState(null);
  const [sendingIds, setSendingIds] = useState(new Set());
  const [sentIds, setSentIds] = useState(new Set());

  const isAdmin = role === "admin";

  // ─── GERAR TODAS AS COMBINAÇÕES POSSÍVEIS ENTRE ASSOCIADOS ───
  // Score sempre vem do banco (Gemini). Sem cálculo local.
  const allCombinations = [];

  if (isAdmin && associados.length > 1) {
    for (let i = 0; i < associados.length; i++) {
      for (let j = i + 1; j < associados.length; j++) {
        const a1 = associados[i];
        const a2 = associados[j];

        // Score = null até o backend gerar via Gemini
        const sinergia = `${a1.segmento || "Serviço"} + ${a2.segmento || "Serviço"}`;

        allCombinations.push({
          id: `b2b-${a1.id}-${a2.id}`,
          assoc1: a1.nome,
          cat1: a1.segmento || "Geral",
          serv1:
            a1.servicos?.split(",")[0]?.trim() ||
            a1.produtosOferecidos?.split(",")[0]?.trim() ||
            a1.segmento ||
            "",
          assoc2: a2.nome,
          cat2: a2.segmento || "Geral",
          serv2:
            a2.servicos?.split(",")[0]?.trim() ||
            a2.produtosOferecidos?.split(",")[0]?.trim() ||
            a2.segmento ||
            "",
          sinergia,
          score: null,
          status: "Pendente",
          hasMatch: false,
          assoc1Obj: a1,
          assoc2Obj: a2,
        });
      }
    }
  } else if (!isAdmin) {
    // Associado vê suas parcerias
    associados.forEach((a) => {
      if (a.nome !== associadoLogado?.nome && a.id !== associadoLogado?.id) {
        allCombinations.push({
          id: `b2b-${associadoLogado?.id}-${a.id}`,
          assoc1: associadoLogado?.nome || "Você",
          cat1: associadoLogado?.segmento || "Geral",
          serv1: associadoLogado?.servicos?.split(",")[0]?.trim() || "",
          assoc2: a.nome,
          cat2: a.segmento || "Geral",
          serv2: a.servicos?.split(",")[0]?.trim() || "",
          sinergia: `${associadoLogado?.segmento || ""} + ${a.segmento || ""}`,
          score: 70,
          status: "Pendente",
          hasMatch: false,
        });
      }
    });
  }

  const allCategorias = [
    ...new Set(allCombinations.flatMap((m) => [m.cat1, m.cat2])),
  ];
  const allStatuses = [...new Set(allCombinations.map((m) => m.status))];

  const filtered = allCombinations
    .filter((m) => {
      const matchSearch =
        !searchTerm ||
        m.assoc1.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.assoc2.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.sinergia.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = !statusFilter || m.status === statusFilter;
      const matchCat =
        !categoriaFilter ||
        m.cat1 === categoriaFilter ||
        m.cat2 === categoriaFilter;
      return matchSearch && matchStatus && matchCat;
    })
    .sort(
      (a, b) =>
        (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score),
    );

  const stats = {
    total: allCombinations.length,
    matched: allCombinations.filter((m) => m.hasMatch).length,
    alta: allCombinations.filter((m) => m.score >= 80).length,
    contacted: allCombinations.filter(
      (m) => m.status === "Contacted" || m.status === "CONTACTED",
    ).length,
    confirmed: allCombinations.filter(
      (m) => m.status === "Confirmed" || m.status === "CONFIRMED",
    ).length,
  };

  const getScoreColor = (score) => {
    if (score >= 85) return colors.green;
    if (score >= 70) return colors.blue;
    if (score >= 50) return colors.orange;
    return colors.red;
  };

  const getRankBadge = (rank) => {
    if (rank === 1) return { color: colors.green, label: `${rank}º` };
    if (rank === 2) return { color: colors.blue, label: `${rank}º` };
    if (rank === 3) return { color: colors.orange, label: `${rank}º` };
    return { color: colors.textMuted, label: `${rank}º` };
  };

  const getPriorityLabel = (score) => {
    if (score == null)
      return { label: "—", color: colors.textMuted, bg: colors.surfaceLight };
    if (score >= 80)
      return { label: "ALTA", color: colors.green, bg: `${colors.green}15` };
    if (score >= 60)
      return { label: "MÉDIA", color: colors.orange, bg: `${colors.orange}15` };
    return { label: "BAIXA", color: colors.textMuted, bg: colors.surfaceLight };
  };

  const handleGenerateMatches = async () => {
    setIsGenerating(true);
    setHsmResult(null);
    try {
      // 1. Gera matches B2B no banco via IA (anti-duplicação: pares já criados são ignorados)
      const aiRes = await api.post("/ai/matches-b2b").catch((err) => {
        console.error("Erro ao gerar matches B2B:", err);
        return null;
      });

      const novos = aiRes?.sinergias || aiRes?.matches || [];
      const totalNovos = aiRes?.totalSinergias ?? novos.length;
      const matchIds = novos.map((s) => s.id).filter(Boolean);

      // 2. Atualiza estado global (puxa do backend)
      if (onRegenerateMatches) await onRegenerateMatches();

      // 3. Dispara HSM hsmbra apenas para o associado de ORIGEM de cada par novo.
      //    O destino só receberá hsmbrac quando a origem aceitar pelo WhatsApp.
      if (matchIds.length > 0) {
        const hsmRes = await api
          .post("/whatsapp/send-hsm-matches-b2b", { matchIds })
          .catch((err) => {
            console.warn("Falha no envio HSM B2B:", err);
            return null;
          });

        const sent = hsmRes?.sent ?? 0;
        const skipped = hsmRes?.skipped ?? 0;
        setHsmResult({
          success: true,
          message: `${totalNovos} sinergias geradas · HSM hsmbra enviado para ${sent} associado(s) origem${skipped > 0 ? ` (${skipped} pulado/duplicado)` : ""}. Aguardando aceite para disparar o hsmbrac aos associados destino.`,
        });
      } else {
        setHsmResult({
          success: true,
          message:
            totalNovos === 0
              ? "Nenhuma nova sinergia identificada (todas as combinações já foram processadas anteriormente)"
              : `${totalNovos} sinergias calculadas`,
        });
      }
      setTimeout(() => setHsmResult(null), 7000);
    } catch (e) {
      console.error(e);
      setHsmResult({
        success: false,
        message: `Erro ao gerar matches: ${e.message || "verifique a conexão"}`,
      });
      setTimeout(() => setHsmResult(null), 6000);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendWhatsApp = async (m) => {
    // Envio individual por linha — usa o mesmo fluxo de 2 etapas:
    // dispara hsmbra apenas para o associado de origem (menor ID).
    const matchKey = `${m.assoc1}-${m.assoc2}`;
    setSendingIds((prev) => new Set([...prev, matchKey]));
    try {
      const a1 = m.assoc1Obj || associados.find((a) => a.nome === m.assoc1);
      const a2 = m.assoc2Obj || associados.find((a) => a.nome === m.assoc2);

      if (!a1?.id || !a2?.id) {
        setHsmResult({
          success: false,
          message: `Associados não encontrados no banco`,
        });
        setTimeout(() => setHsmResult(null), 4000);
        return;
      }

      // Convenção do schema: origem = menor ID, destino = maior ID
      const [origemId, destinoId] =
        a1.id < a2.id ? [a1.id, a2.id] : [a2.id, a1.id];

      // Busca match B2B existente, ou cria via /ai/matches-b2b (que processa todos os pares).
      // Pra um par específico, melhor caminho é o endpoint AI mesmo.
      // Aqui, simplesmente disparamos o gerar e enviar para esse par via lookup:
      const aiRes = await api.post("/ai/matches-b2b").catch(() => null);
      const todos = aiRes?.sinergias || [];
      const meu = todos.find(
        (s) =>
          s.associadoOrigem === origemId && s.associadoDestino === destinoId,
      );

      if (meu?.id) {
        const hsmRes = await api
          .post("/whatsapp/send-hsm-matches-b2b", { matchIds: [meu.id] })
          .catch(() => null);
        if (hsmRes?.sent > 0) {
          setSentIds((prev) => new Set([...prev, matchKey]));
          setHsmResult({
            success: true,
            message: `hsmbra enviado para ${a1.id < a2.id ? a1.nome : a2.nome} (origem)`,
          });
        } else if (hsmRes?.skipped > 0) {
          setHsmResult({
            success: false,
            message: `Match B2B já foi processado anteriormente (anti-duplicação)`,
          });
        } else {
          setHsmResult({ success: false, message: `Falha no envio do hsmbra` });
        }
      } else {
        setHsmResult({
          success: false,
          message: `Não foi possível identificar o par no banco. Tente "Gerar Matches" antes.`,
        });
      }
    } catch (e) {
      setHsmResult({ success: false, message: `Erro: ${e.message}` });
    } finally {
      setSendingIds((prev) => {
        const n = new Set(prev);
        n.delete(matchKey);
        return n;
      });
      setTimeout(() => setHsmResult(null), 5000);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {isAdmin ? "Assoc × Assoc" : "Minhas Parcerias B2B"}
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {isAdmin
              ? `${associados.length} associados — ${allCombinations.length} combinações possíveis de sinergia`
              : `Parcerias B2B para ${associadoLogado?.nome || "você"}`}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={handleGenerateMatches}
            disabled={isGenerating}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              background: isGenerating
                ? colors.surfaceLight
                : `linear-gradient(135deg, ${colors.green}, ${colors.green}cc)`,
              color: isGenerating ? colors.textMuted : "#fff",
              cursor: isGenerating ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            {isGenerating ? (
              <>
                <IconLoader /> Enviando...
              </>
            ) : (
              <>
                <Icons.Sparkles /> Gerar Matches
              </>
            )}
          </button>
        )}
      </div>

      {/* HSM Result Banner */}
      {hsmResult && (
        <div
          style={{
            background: hsmResult.success
              ? `${colors.green}10`
              : `${colors.orange}10`,
            border: `1px solid ${hsmResult.success ? colors.green : colors.orange}30`,
            borderRadius: 12,
            padding: "14px 20px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              color: hsmResult.success ? colors.green : colors.orange,
              display: "flex",
            }}
          >
            {hsmResult.success ? <Icons.Check /> : <IconAlert />}
          </span>
          <span
            style={{
              fontSize: 13,
              color: hsmResult.success ? colors.green : colors.orange,
              fontWeight: 600,
            }}
          >
            {hsmResult.message}
          </span>
        </div>
      )}

      {/* Stats Cards */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard label="Combinações" value={stats.total} color={colors.blue} />
        <StatCard
          label="Com Match"
          value={stats.matched}
          color={colors.green}
          delay={0.05}
        />
        <StatCard
          label="Alta Compat."
          value={stats.alta}
          color={colors.orange}
          delay={0.1}
        />
        <StatCard
          label="Contactados"
          value={stats.contacted}
          color={colors.cyan}
          delay={0.15}
        />
        <StatCard
          label="Confirmados"
          value={stats.confirmed}
          color={colors.purple}
          delay={0.2}
        />
      </div>

      {/* Filters Bar */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: 2 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Buscar
          </label>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.textMuted,
              }}
            >
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Buscar associado..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px 10px 38px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.text,
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 13,
              outline: "none",
            }}
          >
            <option value="">Todos</option>
            {allStatuses.map((s) => (
              <option key={s} value={s}>
                {statusLabels[s] || s}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Categoria
          </label>
          <select
            value={categoriaFilter}
            onChange={(e) => setCategoriaFilter(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 13,
              outline: "none",
            }}
          >
            <option value="">Todas</option>
            {allCategorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            setSearchTerm("");
            setStatusFilter("");
            setCategoriaFilter("");
          }}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceLight,
            color: colors.textMuted,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Limpar
        </button>
      </div>

      {/* Results Count */}
      <div style={{ marginBottom: 16, fontSize: 13, color: colors.textMuted }}>
        {filtered.length > 0 ? (
          <>
            Mostrando{" "}
            <span style={{ fontWeight: 700, color: colors.text }}>
              {filtered.length}
            </span>{" "}
            combinações por{" "}
            <span style={{ fontWeight: 700, color: colors.green }}>score</span>{" "}
            · {stats.matched} com match ativo
          </>
        ) : (
          <>
            {isAdmin
              ? "Clique em 'Gerar Matches' para calcular sinergias entre associados"
              : "Nenhuma parceria encontrada ainda"}
          </>
        )}
      </div>

      {/* ═══ TABELA ═══ */}
      {filtered.length > 0 && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    background: colors.surfaceLight,
                  }}
                >
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      width: 60,
                    }}
                  >
                    Rank
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Associado 1
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Score
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Associado 2
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Sinergia
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Prioridade
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Status
                  </th>
                  <th
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m, index) => {
                  const rank = index + 1;
                  const rankBadge = getRankBadge(rank);
                  const priority = getPriorityLabel(m.score);
                  const matchKey = `${m.assoc1}-${m.assoc2}`;
                  const isSending = sendingIds.has(matchKey);
                  const wasSent = sentIds.has(matchKey);
                  const wasContacted =
                    m.status === "Contacted" ||
                    m.status === "CONTACTED" ||
                    m.status === "Confirmed" ||
                    m.status === "CONFIRMED";
                  return (
                    <tr
                      key={m.id}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        transition: "background 0.15s",
                        background:
                          rank <= 3 ? `${rankBadge.color}08` : "transparent",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = `${colors.blue}08`)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background =
                          rank <= 3 ? `${rankBadge.color}08` : "transparent")
                      }
                    >
                      {/* Rank */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: rankBadge.color,
                          }}
                        >
                          {rankBadge.label}
                        </span>
                      </td>
                      {/* Associado 1 */}
                      <td style={{ padding: "14px 16px" }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 700,
                            color: colors.purple,
                          }}
                        >
                          {m.assoc1}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: colors.textMuted,
                            marginTop: 2,
                          }}
                        >
                          {m.cat1} · {m.serv1}
                        </div>
                      </td>
                      {/* Score */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        {m.score == null ? (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 14px",
                              borderRadius: 20,
                              background: colors.surfaceLight,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: colors.textMuted,
                                fontStyle: "italic",
                              }}
                            >
                              —
                            </span>
                          </div>
                        ) : (
                          <div
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "6px 14px",
                              borderRadius: 20,
                              background: `${getScoreColor(m.score)}15`,
                            }}
                          >
                            <span
                              style={{
                                fontSize: 17,
                                fontWeight: 800,
                                color: getScoreColor(m.score),
                                fontFamily: "'JetBrains Mono', monospace",
                              }}
                            >
                              {m.score}%
                            </span>
                          </div>
                        )}
                      </td>
                      {/* Associado 2 */}
                      <td style={{ padding: "14px 16px" }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: colors.text,
                          }}
                        >
                          {m.assoc2}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: colors.textMuted,
                            marginTop: 2,
                          }}
                        >
                          {m.cat2} · {m.serv2}
                        </div>
                      </td>
                      {/* Sinergia */}
                      <td
                        style={{
                          padding: "14px 16px",
                          fontSize: 12,
                          color: colors.orange,
                          fontWeight: 600,
                        }}
                      >
                        {m.sinergia}
                      </td>
                      {/* Prioridade */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 700,
                            background: priority.bg,
                            color: priority.color,
                          }}
                        >
                          {priority.label}
                        </span>
                      </td>
                      {/* Status */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        {m.hasMatch ? (
                          <StatusBadge status={m.status} />
                        ) : (
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              background: `${colors.blue}12`,
                              color: colors.blue,
                              border: `1px dashed ${colors.blue}30`,
                            }}
                          >
                            POTENCIAL
                          </span>
                        )}
                      </td>
                      {/* Ações: WhatsApp + Email */}
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "center",
                            gap: 6,
                          }}
                        >
                          <button
                            onClick={() => handleSendWhatsApp(m)}
                            disabled={isSending || wasSent}
                            title={
                              wasSent
                                ? "WhatsApp já enviado"
                                : "Enviar WhatsApp"
                            }
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 8,
                              border: "none",
                              background: wasSent
                                ? `${colors.green}15`
                                : isSending
                                  ? colors.surfaceLight
                                  : `${colors.green}12`,
                              color: wasSent
                                ? colors.green
                                : isSending
                                  ? colors.textMuted
                                  : colors.green,
                              cursor:
                                isSending || wasSent ? "default" : "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: 0,
                              border: `1px solid ${wasSent ? colors.green + "40" : colors.green + "30"}`,
                            }}
                          >
                            {wasSent ? (
                              <Icons.Check />
                            ) : isSending ? (
                              <span style={{ fontSize: 12 }}>⏳</span>
                            ) : (
                              <Icons.Phone />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Rodapé da tabela */}
          <div
            style={{
              padding: "12px 20px",
              borderTop: `1px solid ${colors.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {filtered.length} resultados · Ordenados por score (maior → menor)
            </span>
            <span
              style={{ fontSize: 11, color: colors.green, fontWeight: 600 }}
            >
              HSM: hsmbra → assoc origem · hsmbrac → assoc destino (após aceite)
            </span>
          </div>
        </div>
      )}

      {/* Empty State */}
      {filtered.length === 0 && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 60,
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "flex",
              justifyContent: "center",
              color: colors.textMuted,
              marginBottom: 16,
            }}
          >
            <Icons.Target />
          </span>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            {isAdmin
              ? "Nenhuma sinergia calculada ainda"
              : "Nenhuma parceria disponível"}
          </h3>
          <p
            style={{
              fontSize: 14,
              color: colors.textMuted,
              maxWidth: 460,
              margin: "0 auto",
            }}
          >
            {isAdmin
              ? "Clique em 'Gerar Matches' para que a IA calcule sinergias entre os Associados. O HSM hsmbra é enviado primeiro pro associado de origem; quando ele aceitar, o sistema dispara o hsmbrac pro associado de destino automaticamente."
              : "O administrador ainda não gerou oportunidades de parceria. Aguarde ou entre em contato."}
          </p>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════
// ─── EVENTOS × EMPRESAS ───
// ═════════════════════════════════════════
function EventosEmpresasPage({
  eventosData = [],
  empresas = [],
  associados = [],
  matchesData = [],
  onRegenerateMatches,
  onToggleConfirmacao,
}) {
  const [selectedEventoId, setSelectedEventoId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [setorFilter, setSetorFilter] = useState("");
  const [eventoFilter, setEventoFilter] = useState("");
  const [eventoStatusFilter, setEventoStatusFilter] = useState("");
  const [eventoSort, setEventoSort] = useState("data-asc");
  const [eventoPage, setEventoPage] = useState(1);
  const [hsmResult, setHsmResult] = useState(null);
  const [invitingIds, setInvitingIds] = useState(new Set());
  const [invitedIds, setInvitedIds] = useState(new Set());
  const [bulkInviting, setBulkInviting] = useState(false);
  const EVENTOS_PER_PAGE = 5;

  const selectedEvento = eventosData.find((e) => e.id === selectedEventoId);

  const filteredEventos = eventosData
    .filter((e) => {
      const matchSearch =
        !eventoFilter ||
        e.nome?.toLowerCase().includes(eventoFilter.toLowerCase());
      const matchStatus =
        !eventoStatusFilter || e.status === eventoStatusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      if (eventoSort === "data-asc")
        return String(a.data || "").localeCompare(String(b.data || ""));
      if (eventoSort === "data-desc")
        return String(b.data || "").localeCompare(String(a.data || ""));
      if (eventoSort === "nome")
        return (a.nome || "").localeCompare(b.nome || "");
      return 0;
    });

  const totalEventoPages = Math.ceil(filteredEventos.length / EVENTOS_PER_PAGE);
  const paginatedEventos = filteredEventos.slice(
    (eventoPage - 1) * EVENTOS_PER_PAGE,
    eventoPage * EVENTOS_PER_PAGE,
  );

  const getEmpresasForEvento = (evento) => {
    if (!evento) return [];
    const eventoCats = (evento.categorias || []).map((c) => c.toLowerCase());
    const eventoNome = (evento.nome || "").toLowerCase();
    // Mapa de empresaId -> status de participação no evento. Vem do backend
    // (evento.participantesList = [{ empresaId, confirmado, createdAt }, ...]).
    const participacaoMap = new Map();
    (evento.participantesList || []).forEach((p) => {
      participacaoMap.set(p.empresaId, p.confirmado);
    });
    return empresas
      .map((emp) => {
        const setor = (emp.segmento || "").toLowerCase();
        let score = 40;
        if (eventoCats.some((c) => setor.includes(c))) score += 25;
        if (eventoNome.includes("energy") && setor.includes("energ"))
          score += 20;
        if (eventoNome.includes("tech") && setor.includes("tech")) score += 20;
        if (eventoNome.includes("food") && setor.includes("food")) score += 20;
        if (eventoNome.includes("business") || eventoNome.includes("forum"))
          score += 10;
        if (
          eventoNome.includes("trade") &&
          (setor.includes("logist") || setor.includes("financ"))
        )
          score += 15;
        if (emp.tipo === "Exportador" || emp.tipo === "Ambos") score += 5;

        // Status de participação: 'confirmada' | 'pendente' | null (não inscrita)
        let participacao = null;
        if (participacaoMap.has(emp.id)) {
          participacao = participacaoMap.get(emp.id)
            ? "confirmada"
            : "pendente";
        }

        return { ...emp, score: Math.min(score, 98), participacao };
      })
      .sort(
        (a, b) =>
          (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score),
      );
  };

  const empresasDoEvento = getEmpresasForEvento(selectedEvento);
  const allSetores = [
    ...new Set(empresasDoEvento.map((e) => e.segmento).filter(Boolean)),
  ];
  const filteredEmpresas = empresasDoEvento.filter((e) => {
    const matchSearch =
      !searchTerm ||
      e.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.segmento || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchSetor = !setorFilter || e.segmento === setorFilter;
    return matchSearch && matchSetor;
  });
  const getScoreColor = (s) =>
    s >= 85
      ? colors.green
      : s >= 70
        ? colors.blue
        : s >= 50
          ? colors.orange
          : colors.red;
  const getPriority = (s) =>
    s >= 80
      ? { label: "ALTA", color: colors.green, bg: `${colors.green}15` }
      : s >= 60
        ? { label: "MÉDIA", color: colors.orange, bg: `${colors.orange}15` }
        : { label: "BAIXA", color: colors.textMuted, bg: colors.surfaceLight };

  // ─── Convidar empresa individual para o evento ───
  const handleInviteEmpresa = async (emp) => {
    if (!selectedEvento) return;
    if (!emp?.id) return;
    if (invitingIds.has(emp.id) || invitedIds.has(emp.id)) return;

    setInvitingIds((prev) => new Set([...prev, emp.id]));
    setHsmResult(null);

    try {
      const result = await api.post("/whatsapp/send-evento-invite", {
        eventoId: selectedEvento.id,
        alvos: [{ tipo: "empresa", id: emp.id }],
      });
      if (result?.sent > 0) {
        setInvitedIds((prev) => new Set([...prev, emp.id]));
        setHsmResult({
          success: true,
          message: `Convite hsmbraevent enviado para ${emp.nome}`,
        });
      } else {
        const motivo =
          result?.details?.[0]?.error || "Falha desconhecida no envio";
        setHsmResult({
          success: false,
          message: `Falha ao convidar ${emp.nome}: ${String(motivo).substring(0, 200)}`,
        });
      }
    } catch (err) {
      setHsmResult({
        success: false,
        message: `Erro ao enviar convite: ${err.message || "verifique a conexão"}`,
      });
    } finally {
      setInvitingIds((prev) => {
        const n = new Set(prev);
        n.delete(emp.id);
        return n;
      });
      setTimeout(() => setHsmResult(null), 8000);
    }
  };

  // ─── Convidar TODAS as empresas filtradas para o evento ───
  const handleInviteAll = async () => {
    if (!selectedEvento) return;
    const candidatas = filteredEmpresas.filter(
      (e) => e?.id && !invitedIds.has(e.id),
    );
    if (candidatas.length === 0) {
      setHsmResult({
        success: false,
        message: "Nenhuma empresa elegível para convidar.",
      });
      setTimeout(() => setHsmResult(null), 4000);
      return;
    }
    if (
      !window.confirm(
        `Enviar convite hsmbraevent para ${candidatas.length} empresa(s)?`,
      )
    )
      return;

    setBulkInviting(true);
    setHsmResult(null);
    try {
      const result = await api.post("/whatsapp/send-evento-invite", {
        eventoId: selectedEvento.id,
        alvos: candidatas.map((e) => ({ tipo: "empresa", id: e.id })),
      });
      const sent = result?.sent || 0;
      const failed = result?.failed || 0;
      if (sent > 0) {
        setInvitedIds((prev) => {
          const n = new Set(prev);
          (result.details || []).forEach((d) => {
            if (d.success) n.add(d.id);
          });
          return n;
        });
      }
      setHsmResult({
        success: sent > 0,
        message:
          failed > 0
            ? `${sent}/${result.total} convites enviados · ${failed} falha(s). Verifique logs do backend.`
            : `${sent} convite(s) hsmbraevent enviado(s) com sucesso!`,
      });
    } catch (err) {
      setHsmResult({
        success: false,
        message: `Erro: ${err.message || "verifique a conexão"}`,
      });
    } finally {
      setBulkInviting(false);
      setTimeout(() => setHsmResult(null), 10000);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Eventos × Empresas
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {eventosData.length} eventos · {empresas.length} empresas
            cadastradas
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {selectedEvento && filteredEmpresas.length > 0 && (
            <button
              onClick={handleInviteAll}
              disabled={bulkInviting}
              title={`Enviar hsmbraevent para todas as empresas filtradas no evento "${selectedEvento.nome}"`}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: bulkInviting
                  ? colors.surfaceLight
                  : `linear-gradient(135deg, ${colors.purple}, ${colors.purple}cc)`,
                color: bulkInviting ? colors.textMuted : "#fff",
                cursor: bulkInviting ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              {bulkInviting ? (
                <>
                  <IconLoader /> Enviando...
                </>
              ) : (
                <>
                  Convidar todos (
                  {filteredEmpresas.filter((e) => !invitedIds.has(e.id)).length}
                  )
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {hsmResult && (
        <div
          style={{
            background: hsmResult.success
              ? `${colors.green}10`
              : `${colors.orange}10`,
            border: `1px solid ${hsmResult.success ? colors.green : colors.orange}30`,
            borderRadius: 12,
            padding: "14px 20px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              color: hsmResult.success ? colors.green : colors.orange,
              display: "flex",
            }}
          >
            {hsmResult.success ? <Icons.Check /> : <IconAlert />}
          </span>
          <span
            style={{
              fontSize: 13,
              color: hsmResult.success ? colors.green : colors.orange,
              fontWeight: 600,
            }}
          >
            {hsmResult.message}
          </span>
        </div>
      )}

      {/* Seletor de Eventos */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          marginBottom: 24,
          overflow: "hidden",
        }}
      >
        {/* Header com filtros */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: colors.text,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icons.Calendar /> Eventos
          </span>
          <div style={{ flex: 1, position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.textMuted,
              }}
            >
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Filtrar eventos..."
              value={eventoFilter}
              onChange={(e) => {
                setEventoFilter(e.target.value);
                setEventoPage(1);
              }}
              style={{
                width: "100%",
                padding: "8px 10px 8px 34px",
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.text,
                fontSize: 12,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <select
            value={eventoStatusFilter}
            onChange={(e) => {
              setEventoStatusFilter(e.target.value);
              setEventoPage(1);
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="">Todos</option>
            <option value="Ativo">Ativos</option>
            <option value="Planejado">Planejados</option>
          </select>
          <select
            value={eventoSort}
            onChange={(e) => setEventoSort(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="data-asc">Data ↑</option>
            <option value="data-desc">Data ↓</option>
            <option value="nome">Nome A-Z</option>
          </select>
        </div>
        {/* Lista paginada */}
        <div>
          {paginatedEventos.length > 0 ? (
            paginatedEventos.map((ev) => {
              const isSelected = selectedEventoId === ev.id;
              const isAtivo = ev.status === "Ativo";
              return (
                <div
                  key={ev.id}
                  onClick={() => setSelectedEventoId(isSelected ? null : ev.id)}
                  style={{
                    padding: "12px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    cursor: "pointer",
                    borderBottom: `1px solid ${colors.border}`,
                    transition: "background 0.15s",
                    background: isSelected ? `${colors.blue}10` : "transparent",
                    borderLeft: isSelected
                      ? `3px solid ${colors.blue}`
                      : "3px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = colors.surfaceLight;
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      color: isAtivo ? colors.green : colors.blue,
                      display: "flex",
                    }}
                  >
                    <Icons.Calendar />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: isSelected ? 700 : 500,
                        color: isSelected ? colors.blue : colors.text,
                      }}
                    >
                      {ev.nome}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.textMuted,
                        marginTop: 2,
                      }}
                    >
                      {ev.data} · {ev.local}
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 12,
                      fontSize: 10,
                      fontWeight: 700,
                      background: isAtivo
                        ? `${colors.green}15`
                        : `${colors.blue}15`,
                      color: isAtivo ? colors.green : colors.blue,
                    }}
                  >
                    {isAtivo ? "Ativo" : "Planejado"}
                  </span>
                  <div style={{ display: "flex", gap: 10 }}>
                    <span
                      style={{
                        fontSize: 11,
                        color: colors.orange,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Icons.User /> {ev.participantes || 0}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: colors.green,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Icons.Target /> {ev.matches || 0}
                    </span>
                  </div>
                  {isSelected && (
                    <span style={{ color: colors.blue, fontSize: 16 }}>▼</span>
                  )}
                </div>
              );
            })
          ) : (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                fontSize: 13,
                color: colors.textMuted,
              }}
            >
              Nenhum evento encontrado
            </div>
          )}
        </div>
        {/* Paginação */}
        {totalEventoPages > 1 && (
          <div
            style={{
              padding: "10px 20px",
              borderTop: `1px solid ${colors.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {filteredEventos.length} eventos · Página {eventoPage} de{" "}
              {totalEventoPages}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setEventoPage((p) => Math.max(1, p - 1))}
                disabled={eventoPage === 1}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  background:
                    eventoPage === 1 ? colors.surfaceLight : colors.surface,
                  color: eventoPage === 1 ? colors.textMuted : colors.text,
                  cursor: eventoPage === 1 ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ← Anterior
              </button>
              {Array.from({ length: totalEventoPages }, (_, i) => i + 1).map(
                (p) => (
                  <button
                    key={p}
                    onClick={() => setEventoPage(p)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      border: `1px solid ${eventoPage === p ? colors.blue : colors.border}`,
                      background:
                        eventoPage === p ? `${colors.blue}15` : colors.surface,
                      color: eventoPage === p ? colors.blue : colors.textMuted,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: eventoPage === p ? 700 : 400,
                    }}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() =>
                  setEventoPage((p) => Math.min(totalEventoPages, p + 1))
                }
                disabled={eventoPage === totalEventoPages}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  background:
                    eventoPage === totalEventoPages
                      ? colors.surfaceLight
                      : colors.surface,
                  color:
                    eventoPage === totalEventoPages
                      ? colors.textMuted
                      : colors.text,
                  cursor:
                    eventoPage === totalEventoPages ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Empresas do Evento Selecionado */}
      {selectedEvento ? (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <div>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: colors.text,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Empresas compatíveis com "{selectedEvento.nome}"
              </h3>
              <p
                style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}
              >
                {filteredEmpresas.length} empresas ordenadas por compatibilidade
              </p>
            </div>
          </div>

          {/* Filtros da tabela */}
          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 14,
              padding: "14px 20px",
              marginBottom: 16,
              display: "flex",
              gap: 14,
              alignItems: "flex-end",
            }}
          >
            <div style={{ flex: 2, position: "relative" }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors.textMuted,
                  letterSpacing: 0.8,
                  display: "block",
                  marginBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                Buscar
              </label>
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: colors.textMuted,
                  }}
                >
                  <Icons.Search />
                </span>
                <input
                  type="text"
                  placeholder="Buscar empresa..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 38px",
                    borderRadius: 10,
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceLight,
                    color: colors.text,
                    fontSize: 13,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors.textMuted,
                  letterSpacing: 0.8,
                  display: "block",
                  marginBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                Setor
              </label>
              <select
                value={setorFilter}
                onChange={(e) => setSetorFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: `1px solid ${colors.border}`,
                  background: colors.surfaceLight,
                  color: colors.text,
                  fontSize: 13,
                  outline: "none",
                }}
              >
                <option value="">Todos</option>
                {allSetores.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                setSearchTerm("");
                setSetorFilter("");
              }}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.textMuted,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Limpar
            </button>
          </div>

          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    background: colors.surfaceLight,
                  }}
                >
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      width: 50,
                    }}
                  >
                    #
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Empresa
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Setor
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Score
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Prioridade
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Participação
                  </th>
                  <th
                    style={{
                      padding: "12px 16px",
                      textAlign: "center",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEmpresas.map((emp, i) => {
                  const pr = getPriority(emp.score);
                  return (
                    <tr
                      key={emp.id}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.background = `${colors.blue}06`)
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.background = "transparent")
                      }
                    >
                      <td
                        style={{
                          padding: "12px 16px",
                          textAlign: "center",
                          fontSize: 13,
                          fontWeight: 700,
                          color: i < 3 ? colors.orange : colors.textMuted,
                        }}
                      >
                        {i + 1}
                      </td>
                      <td style={{ padding: "12px 16px" }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: colors.text,
                          }}
                        >
                          {emp.nome}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            color: colors.textMuted,
                            marginTop: 2,
                          }}
                        >
                          {emp.cidade}, {emp.estado} · {emp.tipo}
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          fontSize: 13,
                          color: colors.textMuted,
                        }}
                      >
                        {emp.segmento}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        <span
                          style={{
                            fontSize: 16,
                            fontWeight: 800,
                            color: getScoreColor(emp.score),
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {emp.score}%
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 700,
                            background: pr.bg,
                            color: pr.color,
                          }}
                        >
                          {pr.label}
                        </span>
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        {emp.participacao === "confirmada" ? (
                          <button
                            onClick={() =>
                              onToggleConfirmacao &&
                              onToggleConfirmacao(
                                selectedEvento.id,
                                emp.id,
                                false,
                              )
                            }
                            title="Clique para marcar como Pendente"
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              background: `${colors.green}15`,
                              color: colors.green,
                              border: `1px solid ${colors.green}30`,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Confirmada
                          </button>
                        ) : emp.participacao === "pendente" ? (
                          <button
                            onClick={() =>
                              onToggleConfirmacao &&
                              onToggleConfirmacao(
                                selectedEvento.id,
                                emp.id,
                                true,
                              )
                            }
                            title="Clique para confirmar a participação"
                            style={{
                              padding: "4px 12px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              background: `${colors.orange}15`,
                              color: colors.orange,
                              border: `1px solid ${colors.orange}30`,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Pendente
                          </button>
                        ) : (
                          <span
                            style={{ fontSize: 11, color: colors.textMuted }}
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        {(() => {
                          const isInviting = invitingIds.has(emp.id);
                          const wasInvited = invitedIds.has(emp.id);
                          return (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                gap: 6,
                              }}
                            >
                              <button
                                title={
                                  wasInvited
                                    ? "Convite já enviado"
                                    : isInviting
                                      ? "Enviando..."
                                      : "Convidar para o evento"
                                }
                                onClick={() => handleInviteEmpresa(emp)}
                                disabled={isInviting || wasInvited}
                                style={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: 6,
                                  border: `1px solid ${wasInvited ? colors.green : isInviting ? colors.orange : colors.green}30`,
                                  background: wasInvited
                                    ? `${colors.green}25`
                                    : isInviting
                                      ? `${colors.orange}10`
                                      : `${colors.green}10`,
                                  color: wasInvited
                                    ? colors.green
                                    : isInviting
                                      ? colors.orange
                                      : colors.green,
                                  cursor:
                                    isInviting || wasInvited
                                      ? "not-allowed"
                                      : "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  padding: 0,
                                }}
                              >
                                {wasInvited ? (
                                  <Icons.Check />
                                ) : isInviting ? (
                                  <span style={{ fontSize: 12 }}>⏳</span>
                                ) : (
                                  <Icons.Phone />
                                )}
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div
              style={{
                padding: "10px 20px",
                borderTop: `1px solid ${colors.border}`,
                fontSize: 12,
                color: colors.textMuted,
              }}
            >
              {filteredEmpresas.length} empresas · Evento: {selectedEvento.nome}
            </div>
          </div>
        </>
      ) : (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 50,
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "flex",
              justifyContent: "center",
              color: colors.textMuted,
              marginBottom: 12,
            }}
          >
            <Icons.Calendar />
          </span>
          <p style={{ fontSize: 14, color: colors.textMuted }}>
            Selecione um evento acima para ver as empresas compatíveis
          </p>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════
// ─── EVENTOS × ASSOCIADOS ───
// ═════════════════════════════════════════
function EventosAssociadosPage({
  eventosData = [],
  associados = [],
  empresas = [],
  matchesData = [],
  onRegenerateMatches,
}) {
  const [selectedEventoId, setSelectedEventoId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [segmentoFilter, setSegmentoFilter] = useState("");
  const [eventoFilter, setEventoFilter] = useState("");
  const [eventoStatusFilter, setEventoStatusFilter] = useState("");
  const [eventoSort, setEventoSort] = useState("data-asc");
  const [eventoPage, setEventoPage] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [hsmResult, setHsmResult] = useState(null);
  const [invitingIds, setInvitingIds] = useState(new Set());
  const [invitedIds, setInvitedIds] = useState(new Set());
  const [bulkInviting, setBulkInviting] = useState(false);
  const [sinergiaPending, setSinergiaPending] = useState(new Set()); // chaves "empresaId-associadoId" em envio
  const [sinergiaSent, setSinergiaSent] = useState(new Set()); // chaves já enviadas
  const [bulkSinergia, setBulkSinergia] = useState(false);
  const EVENTOS_PER_PAGE = 5;

  const selectedEvento = eventosData.find((e) => e.id === selectedEventoId);

  const filteredEventos = eventosData
    .filter((e) => {
      const matchSearch =
        !eventoFilter ||
        e.nome?.toLowerCase().includes(eventoFilter.toLowerCase());
      const matchStatus =
        !eventoStatusFilter || e.status === eventoStatusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      if (eventoSort === "data-asc")
        return String(a.data || "").localeCompare(String(b.data || ""));
      if (eventoSort === "data-desc")
        return String(b.data || "").localeCompare(String(a.data || ""));
      if (eventoSort === "nome")
        return (a.nome || "").localeCompare(b.nome || "");
      return 0;
    });

  const totalEventoPages = Math.ceil(filteredEventos.length / EVENTOS_PER_PAGE);
  const paginatedEventos = filteredEventos.slice(
    (eventoPage - 1) * EVENTOS_PER_PAGE,
    eventoPage * EVENTOS_PER_PAGE,
  );

  // ─── CRUZAR: EMPRESAS COMPATÍVEIS COM O EVENTO × ASSOCIADOS ───
  const getMatchesForEvento = (evento) => {
    if (!evento) return [];
    const eventoCats = (evento.categorias || []).map((c) => c.toLowerCase());
    const eventoNome = (evento.nome || "").toLowerCase();

    // 1. Calcular score de cada empresa com o evento
    const empresasComScore = empresas
      .map((emp) => {
        const setor = (emp.segmento || "").toLowerCase();
        let score = 40;
        if (eventoCats.some((c) => setor.includes(c))) score += 25;
        if (eventoNome.includes("energy") && setor.includes("energ"))
          score += 20;
        if (eventoNome.includes("tech") && setor.includes("tech")) score += 20;
        if (eventoNome.includes("food") && setor.includes("food")) score += 20;
        if (eventoNome.includes("business") || eventoNome.includes("forum"))
          score += 10;
        return { ...emp, eventoScore: Math.min(score, 98) };
      })
      .filter((e) => e.eventoScore >= 50); // Só empresas com boa compatibilidade

    // 2. Para cada empresa compatível, cruzar com cada associado
    const matches = [];
    empresasComScore.forEach((emp) => {
      const empText =
        `${emp.segmento || ""} ${emp.produtosDemandados || ""}`.toLowerCase();
      associados.forEach((assoc) => {
        const assocText =
          `${assoc.segmento || ""} ${assoc.produtosOferecidos || ""} ${assoc.servicos || ""}`.toLowerCase();
        let score = 35;
        // Complementaridade: empresa precisa do que o associado oferece
        const keywords = empText.split(/[\s,]+/).filter((w) => w.length > 3);
        keywords.forEach((w) => {
          if (assocText.includes(w)) score += 8;
        });
        // Bonus por setores complementares
        const empSetor = (emp.segmento || "").toLowerCase();
        const assocSeg = (assoc.segmento || "").toLowerCase();
        if (empSetor.includes("energ") && assocSeg.includes("financ"))
          score += 15;
        if (empSetor.includes("logist") && assocSeg.includes("logist"))
          score += 10;
        if (empSetor.includes("tech") && assocSeg.includes("tech")) score += 12;
        if (
          empSetor.includes("food") &&
          (assocSeg.includes("logist") || assocSeg.includes("agri"))
        )
          score += 12;
        score = Math.min(score, 98);
        matches.push({
          id: `${evento.id}-${emp.id}-${assoc.id}`,
          empresaId: emp.id,
          associadoId: assoc.id,
          empresa: emp.nome,
          empresaSetor: emp.segmento,
          associado: assoc.nome,
          associadoSegmento: assoc.segmento,
          associadoServico: assoc.servicos?.split(",")[0]?.trim() || "",
          score,
        });
      });
    });
    return matches.sort(
      (a, b) =>
        (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score),
    );
  };

  const matchesDoEvento = getMatchesForEvento(selectedEvento);
  const allSegmentos = [
    ...new Set(matchesDoEvento.map((m) => m.associadoSegmento).filter(Boolean)),
  ];
  const filteredMatches = matchesDoEvento.filter((m) => {
    const matchSearch =
      !searchTerm ||
      m.empresa.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.associado.toLowerCase().includes(searchTerm.toLowerCase());
    const matchSeg = !segmentoFilter || m.associadoSegmento === segmentoFilter;
    return matchSearch && matchSeg;
  });
  const getScoreColor = (s) =>
    s >= 85
      ? colors.green
      : s >= 70
        ? colors.blue
        : s >= 50
          ? colors.orange
          : colors.red;
  const getPriority = (s) =>
    s >= 80
      ? { label: "ALTA", color: colors.green, bg: `${colors.green}15` }
      : s >= 60
        ? { label: "MÉDIA", color: colors.orange, bg: `${colors.orange}15` }
        : { label: "BAIXA", color: colors.textMuted, bg: colors.surfaceLight };

  const handleGenerateMatches = async () => {
    setIsGenerating(true);
    setHsmResult(null);
    try {
      if (onRegenerateMatches) await onRegenerateMatches();
      setHsmResult({ success: true, message: `Matches gerados e HSM enviado` });
      setTimeout(() => setHsmResult(null), 6000);
    } catch (e) {
      setHsmResult({
        success: false,
        message: `Matches gerados. Verifique conexão para envio.`,
      });
      setTimeout(() => setHsmResult(null), 6000);
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── Convidar associado individual para o evento ───
  const handleInviteAssociado = async (assocId, assocNome) => {
    if (!selectedEvento || !assocId) return;
    if (invitingIds.has(assocId) || invitedIds.has(assocId)) return;

    setInvitingIds((prev) => new Set([...prev, assocId]));
    setHsmResult(null);

    try {
      const result = await api.post("/whatsapp/send-evento-invite", {
        eventoId: selectedEvento.id,
        alvos: [{ tipo: "associado", id: assocId }],
      });
      if (result?.sent > 0) {
        setInvitedIds((prev) => new Set([...prev, assocId]));
        setHsmResult({
          success: true,
          message: `Convite hsmbraevent enviado para ${assocNome}`,
        });
      } else {
        const motivo =
          result?.details?.[0]?.error || "Falha desconhecida no envio";
        setHsmResult({
          success: false,
          message: `Falha ao convidar ${assocNome}: ${String(motivo).substring(0, 200)}`,
        });
      }
    } catch (err) {
      setHsmResult({
        success: false,
        message: `Erro ao enviar convite: ${err.message || "verifique a conexão"}`,
      });
    } finally {
      setInvitingIds((prev) => {
        const n = new Set(prev);
        n.delete(assocId);
        return n;
      });
      setTimeout(() => setHsmResult(null), 8000);
    }
  };

  // ─── Convidar TODOS os associados únicos dos matches filtrados ───
  const handleInviteAllAssociados = async () => {
    if (!selectedEvento) return;
    // Dedupe por associadoId — mesmo associado pode aparecer em vários pares
    const idsUnicos = [
      ...new Set(filteredMatches.map((m) => m.associadoId).filter(Boolean)),
    ];
    const candidatos = idsUnicos.filter((id) => !invitedIds.has(id));
    if (candidatos.length === 0) {
      setHsmResult({
        success: false,
        message: "Nenhum associado elegível para convidar.",
      });
      setTimeout(() => setHsmResult(null), 4000);
      return;
    }
    if (
      !window.confirm(
        `Enviar convite hsmbraevent para ${candidatos.length} associado(s)?`,
      )
    )
      return;

    setBulkInviting(true);
    setHsmResult(null);
    try {
      const result = await api.post("/whatsapp/send-evento-invite", {
        eventoId: selectedEvento.id,
        alvos: candidatos.map((id) => ({ tipo: "associado", id })),
      });
      const sent = result?.sent || 0;
      const failed = result?.failed || 0;
      if (sent > 0) {
        setInvitedIds((prev) => {
          const n = new Set(prev);
          (result.details || []).forEach((d) => {
            if (d.success) n.add(d.id);
          });
          return n;
        });
      }
      setHsmResult({
        success: sent > 0,
        message:
          failed > 0
            ? `${sent}/${result.total} convites enviados · ${failed} falha(s). Verifique logs do backend.`
            : `${sent} convite(s) hsmbraevent enviado(s) com sucesso!`,
      });
    } catch (err) {
      setHsmResult({
        success: false,
        message: `Erro: ${err.message || "verifique a conexão"}`,
      });
    } finally {
      setBulkInviting(false);
      setTimeout(() => setHsmResult(null), 10000);
    }
  };

  // ─── SINERGIA: dispara HSM hsm_evento_empresa_associado pra par específico ───
  // Cria match no banco (PENDING) e envia o HSM ao associado.
  const handleSinergiaPair = async (m) => {
    if (!selectedEvento || !m?.empresaId || !m?.associadoId) return;
    const key = `${m.empresaId}-${m.associadoId}`;
    if (sinergiaPending.has(key) || sinergiaSent.has(key)) return;

    setSinergiaPending((prev) => new Set([...prev, key]));
    setHsmResult(null);

    try {
      const result = await api.post("/whatsapp/send-evento-sinergia", {
        eventoId: selectedEvento.id,
        pares: [{ empresaId: m.empresaId, associadoId: m.associadoId }],
      });
      if (result?.sent > 0) {
        setSinergiaSent((prev) => new Set([...prev, key]));
        setHsmResult({
          success: true,
          message: `Sinergia disparada: ${m.associado} foi notificado sobre ${m.empresa}`,
        });
      } else {
        const motivo =
          result?.details?.[0]?.error || "Falha desconhecida no envio";
        setHsmResult({
          success: false,
          message: `Falha ao notificar ${m.associado}: ${String(motivo).substring(0, 200)}`,
        });
      }
    } catch (err) {
      setHsmResult({
        success: false,
        message: `Erro ao enviar sinergia: ${err.message || "verifique a conexão"}`,
      });
    } finally {
      setSinergiaPending((prev) => {
        const n = new Set(prev);
        n.delete(key);
        return n;
      });
      setTimeout(() => setHsmResult(null), 10000);
    }
  };

  // ─── SINERGIA EM LOTE: todos os pares filtrados ───
  const handleSinergiaAll = async () => {
    if (!selectedEvento) return;
    const candidatos = filteredMatches
      .filter((m) => m?.empresaId && m?.associadoId)
      .filter((m) => !sinergiaSent.has(`${m.empresaId}-${m.associadoId}`));
    if (candidatos.length === 0) {
      setHsmResult({
        success: false,
        message: "Nenhum par elegível para sinergia.",
      });
      setTimeout(() => setHsmResult(null), 4000);
      return;
    }
    if (
      !window.confirm(
        `Disparar HSM de sinergia (etapa 1) para ${candidatos.length} par(es) Empresa × Associado?\n\nO HSM vai pros ASSOCIADOS. Quando responderem com interesse no WhatsApp, a IA dispara automaticamente o HSM etapa 2 pras EMPRESAS.`,
      )
    )
      return;

    setBulkSinergia(true);
    setHsmResult(null);
    try {
      const result = await api.post("/whatsapp/send-evento-sinergia", {
        eventoId: selectedEvento.id,
        pares: candidatos.map((m) => ({
          empresaId: m.empresaId,
          associadoId: m.associadoId,
        })),
      });
      const sent = result?.sent || 0;
      const failed = result?.failed || 0;
      if (sent > 0) {
        setSinergiaSent((prev) => {
          const n = new Set(prev);
          (result.details || []).forEach((d) => {
            if (d.success) n.add(`${d.empresaId}-${d.associadoId}`);
          });
          return n;
        });
      }
      setHsmResult({
        success: sent > 0,
        message:
          failed > 0
            ? `${sent}/${result.total} sinergias disparadas · ${failed} falha(s). Verifique logs do backend.`
            : `${sent} sinergia(s) disparada(s)! Aguardando associados responderem no WhatsApp.`,
      });
    } catch (err) {
      setHsmResult({
        success: false,
        message: `Erro: ${err.message || "verifique a conexão"}`,
      });
    } finally {
      setBulkSinergia(false);
      setTimeout(() => setHsmResult(null), 12000);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Eventos × Associados
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {eventosData.length} eventos · {associados.length} associados
            cadastrados
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {selectedEvento && filteredMatches.length > 0 && (
            <button
              onClick={handleSinergiaAll}
              disabled={bulkSinergia}
              title={`Disparar HSM hsm_evento_empresa_associado pra todos os pares filtrados no evento "${selectedEvento.nome}"`}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: bulkSinergia
                  ? colors.surfaceLight
                  : `linear-gradient(135deg, ${colors.pink}, ${colors.purple})`,
                color: bulkSinergia ? colors.textMuted : "#fff",
                cursor: bulkSinergia ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              {bulkSinergia ? (
                <>
                  <IconLoader /> Enviando...
                </>
              ) : (
                <>
                  Promover sinergias (
                  {
                    filteredMatches.filter(
                      (m) =>
                        m.empresaId &&
                        m.associadoId &&
                        !sinergiaSent.has(`${m.empresaId}-${m.associadoId}`),
                    ).length
                  }
                  )
                </>
              )}
            </button>
          )}
          {selectedEvento && filteredMatches.length > 0 && (
            <button
              onClick={handleInviteAllAssociados}
              disabled={bulkInviting}
              title={`Enviar hsmbraevent para todos os associados únicos no evento "${selectedEvento.nome}"`}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: bulkInviting
                  ? colors.surfaceLight
                  : `linear-gradient(135deg, ${colors.purple}, ${colors.purple}cc)`,
                color: bulkInviting ? colors.textMuted : "#fff",
                cursor: bulkInviting ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              {bulkInviting ? (
                <>
                  <IconLoader /> Enviando...
                </>
              ) : (
                <>
                  Convidar todos (
                  {
                    [
                      ...new Set(
                        filteredMatches
                          .map((m) => m.associadoId)
                          .filter(Boolean),
                      ),
                    ].filter((id) => !invitedIds.has(id)).length
                  }
                  )
                </>
              )}
            </button>
          )}
          {onRegenerateMatches && (
            <button
              onClick={handleGenerateMatches}
              disabled={isGenerating}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background: isGenerating
                  ? colors.surfaceLight
                  : `linear-gradient(135deg, ${colors.green}, ${colors.green}cc)`,
                color: isGenerating ? colors.textMuted : "#fff",
                cursor: isGenerating ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              {isGenerating ? (
                <>
                  <IconLoader /> Enviando...
                </>
              ) : (
                <>
                  <Icons.Sparkles /> Gerar Matches
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {hsmResult && (
        <div
          style={{
            background: hsmResult.success
              ? `${colors.green}10`
              : `${colors.orange}10`,
            border: `1px solid ${hsmResult.success ? colors.green : colors.orange}30`,
            borderRadius: 12,
            padding: "14px 20px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              color: hsmResult.success ? colors.green : colors.orange,
              display: "flex",
            }}
          >
            {hsmResult.success ? <Icons.Check /> : <IconAlert />}
          </span>
          <span
            style={{
              fontSize: 13,
              color: hsmResult.success ? colors.green : colors.orange,
              fontWeight: 600,
            }}
          >
            {hsmResult.message}
          </span>
        </div>
      )}

      {/* Seletor de Eventos */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          marginBottom: 24,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: colors.text,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icons.Calendar /> Eventos
          </span>
          <div style={{ flex: 1, position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.textMuted,
              }}
            >
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Filtrar eventos..."
              value={eventoFilter}
              onChange={(e) => {
                setEventoFilter(e.target.value);
                setEventoPage(1);
              }}
              style={{
                width: "100%",
                padding: "8px 10px 8px 34px",
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.text,
                fontSize: 12,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <select
            value={eventoStatusFilter}
            onChange={(e) => {
              setEventoStatusFilter(e.target.value);
              setEventoPage(1);
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="">Todos</option>
            <option value="Ativo">Ativos</option>
            <option value="Planejado">Planejados</option>
          </select>
          <select
            value={eventoSort}
            onChange={(e) => setEventoSort(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="data-asc">Data ↑</option>
            <option value="data-desc">Data ↓</option>
            <option value="nome">Nome A-Z</option>
          </select>
        </div>
        <div>
          {paginatedEventos.length > 0 ? (
            paginatedEventos.map((ev) => {
              const isSelected = selectedEventoId === ev.id;
              const isAtivo = ev.status === "Ativo";
              return (
                <div
                  key={ev.id}
                  onClick={() => setSelectedEventoId(isSelected ? null : ev.id)}
                  style={{
                    padding: "12px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    cursor: "pointer",
                    borderBottom: `1px solid ${colors.border}`,
                    transition: "background 0.15s",
                    background: isSelected
                      ? `${colors.purple}10`
                      : "transparent",
                    borderLeft: isSelected
                      ? `3px solid ${colors.purple}`
                      : "3px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = colors.surfaceLight;
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      color: isAtivo ? colors.green : colors.blue,
                      display: "flex",
                    }}
                  >
                    <Icons.Calendar />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: isSelected ? 700 : 500,
                        color: isSelected ? colors.purple : colors.text,
                      }}
                    >
                      {ev.nome}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.textMuted,
                        marginTop: 2,
                      }}
                    >
                      {ev.data} · {ev.local}
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 12,
                      fontSize: 10,
                      fontWeight: 700,
                      background: isAtivo
                        ? `${colors.green}15`
                        : `${colors.blue}15`,
                      color: isAtivo ? colors.green : colors.blue,
                    }}
                  >
                    {isAtivo ? "Ativo" : "Planejado"}
                  </span>
                  <div style={{ display: "flex", gap: 10 }}>
                    <span
                      style={{
                        fontSize: 11,
                        color: colors.purple,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Icons.Handshake /> {ev.associados || 0}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: colors.green,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <Icons.Target /> {ev.matches || 0}
                    </span>
                  </div>
                  {isSelected && (
                    <span style={{ color: colors.purple, fontSize: 16 }}>
                      ▼
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                fontSize: 13,
                color: colors.textMuted,
              }}
            >
              Nenhum evento encontrado
            </div>
          )}
        </div>
        {/* Paginação */}
        {totalEventoPages > 1 && (
          <div
            style={{
              padding: "10px 20px",
              borderTop: `1px solid ${colors.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {filteredEventos.length} eventos · Página {eventoPage} de{" "}
              {totalEventoPages}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setEventoPage((p) => Math.max(1, p - 1))}
                disabled={eventoPage === 1}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  background:
                    eventoPage === 1 ? colors.surfaceLight : colors.surface,
                  color: eventoPage === 1 ? colors.textMuted : colors.text,
                  cursor: eventoPage === 1 ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ← Anterior
              </button>
              {Array.from({ length: totalEventoPages }, (_, i) => i + 1).map(
                (p) => (
                  <button
                    key={p}
                    onClick={() => setEventoPage(p)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      border: `1px solid ${eventoPage === p ? colors.purple : colors.border}`,
                      background:
                        eventoPage === p
                          ? `${colors.purple}15`
                          : colors.surface,
                      color:
                        eventoPage === p ? colors.purple : colors.textMuted,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: eventoPage === p ? 700 : 400,
                    }}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() =>
                  setEventoPage((p) => Math.min(totalEventoPages, p + 1))
                }
                disabled={eventoPage === totalEventoPages}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  background:
                    eventoPage === totalEventoPages
                      ? colors.surfaceLight
                      : colors.surface,
                  color:
                    eventoPage === totalEventoPages
                      ? colors.textMuted
                      : colors.text,
                  cursor:
                    eventoPage === totalEventoPages ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Matches: Empresas do Evento × Associados */}
      {selectedEvento ? (
        <>
          <div style={{ marginBottom: 16 }}>
            <h3
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: colors.text,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              Matches: Empresas no evento × Associados
            </h3>
            <p style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
              Empresas compatíveis com "{selectedEvento.nome}" cruzadas com
              associados BRATECC · {filteredMatches.length} combinações
            </p>
          </div>

          {/* Filtros da tabela */}
          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 14,
              padding: "14px 20px",
              marginBottom: 16,
              display: "flex",
              gap: 14,
              alignItems: "flex-end",
            }}
          >
            <div style={{ flex: 2, position: "relative" }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors.textMuted,
                  letterSpacing: 0.8,
                  display: "block",
                  marginBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                Buscar
              </label>
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: colors.textMuted,
                  }}
                >
                  <Icons.Search />
                </span>
                <input
                  type="text"
                  placeholder="Buscar empresa ou associado..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 38px",
                    borderRadius: 10,
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceLight,
                    color: colors.text,
                    fontSize: 13,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors.textMuted,
                  letterSpacing: 0.8,
                  display: "block",
                  marginBottom: 6,
                  textTransform: "uppercase",
                }}
              >
                Segmento Associado
              </label>
              <select
                value={segmentoFilter}
                onChange={(e) => setSegmentoFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: `1px solid ${colors.border}`,
                  background: colors.surfaceLight,
                  color: colors.text,
                  fontSize: 13,
                  outline: "none",
                }}
              >
                <option value="">Todos</option>
                {allSegmentos.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                setSearchTerm("");
                setSegmentoFilter("");
              }}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.textMuted,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Limpar
            </button>
          </div>

          {filteredMatches.length > 0 ? (
            <div
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: `1px solid ${colors.border}`,
                      background: colors.surfaceLight,
                    }}
                  >
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "center",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                        width: 50,
                      }}
                    >
                      #
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Empresa
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "center",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Score
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Associado
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "center",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Prioridade
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "center",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatches.map((m, i) => {
                    const pr = getPriority(m.score);
                    return (
                      <tr
                        key={m.id}
                        style={{
                          borderBottom: `1px solid ${colors.border}`,
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = `${colors.purple}06`)
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <td
                          style={{
                            padding: "12px 16px",
                            textAlign: "center",
                            fontSize: 13,
                            fontWeight: 700,
                            color: i < 3 ? colors.orange : colors.textMuted,
                          }}
                        >
                          {i + 1}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: colors.text,
                            }}
                          >
                            {m.empresa}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: colors.textMuted,
                              marginTop: 2,
                            }}
                          >
                            {m.empresaSetor}
                          </div>
                        </td>
                        <td
                          style={{ padding: "12px 16px", textAlign: "center" }}
                        >
                          <span
                            style={{
                              fontSize: 16,
                              fontWeight: 800,
                              color: getScoreColor(m.score),
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {m.score}%
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 700,
                              color: colors.purple,
                            }}
                          >
                            {m.associado}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: colors.textMuted,
                              marginTop: 2,
                            }}
                          >
                            {m.associadoSegmento} · {m.associadoServico}
                          </div>
                        </td>
                        <td
                          style={{ padding: "12px 16px", textAlign: "center" }}
                        >
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              background: pr.bg,
                              color: pr.color,
                            }}
                          >
                            {pr.label}
                          </span>
                        </td>
                        <td
                          style={{ padding: "12px 16px", textAlign: "center" }}
                        >
                          {(() => {
                            const isInviting = invitingIds.has(m.associadoId);
                            const wasInvited = invitedIds.has(m.associadoId);
                            const sinergiaKey = `${m.empresaId}-${m.associadoId}`;
                            const isSinergia = sinergiaPending.has(sinergiaKey);
                            const wasSinergia = sinergiaSent.has(sinergiaKey);
                            return (
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "center",
                                  gap: 6,
                                }}
                              >
                                <button
                                  title={
                                    wasInvited
                                      ? "Convite já enviado"
                                      : isInviting
                                        ? "Enviando..."
                                        : "Convidar associado para o evento"
                                  }
                                  onClick={() =>
                                    handleInviteAssociado(
                                      m.associadoId,
                                      m.associado,
                                    )
                                  }
                                  disabled={isInviting || wasInvited}
                                  style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 6,
                                    border: `1px solid ${wasInvited ? colors.green : isInviting ? colors.orange : colors.green}30`,
                                    background: wasInvited
                                      ? `${colors.green}25`
                                      : isInviting
                                        ? `${colors.orange}10`
                                        : `${colors.green}10`,
                                    color: wasInvited
                                      ? colors.green
                                      : isInviting
                                        ? colors.orange
                                        : colors.green,
                                    cursor:
                                      isInviting || wasInvited
                                        ? "not-allowed"
                                        : "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                  }}
                                >
                                  {wasInvited ? (
                                    <Icons.Check />
                                  ) : isInviting ? (
                                    <span style={{ fontSize: 12 }}>⏳</span>
                                  ) : (
                                    <Icons.Phone />
                                  )}
                                </button>
                                <button
                                  title={
                                    wasSinergia
                                      ? "Sinergia já disparada"
                                      : isSinergia
                                        ? "Enviando..."
                                        : `Promover sinergia: ${m.associado} ↔ ${m.empresa}`
                                  }
                                  onClick={() => handleSinergiaPair(m)}
                                  disabled={isSinergia || wasSinergia}
                                  style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 6,
                                    border: `1px solid ${wasSinergia ? colors.purple : isSinergia ? colors.orange : colors.purple}30`,
                                    background: wasSinergia
                                      ? `${colors.purple}25`
                                      : isSinergia
                                        ? `${colors.orange}10`
                                        : `${colors.purple}10`,
                                    color: wasSinergia
                                      ? colors.purple
                                      : isSinergia
                                        ? colors.orange
                                        : colors.purple,
                                    cursor:
                                      isSinergia || wasSinergia
                                        ? "not-allowed"
                                        : "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                    fontSize: 14,
                                  }}
                                >
                                  {wasSinergia ? (
                                    <Icons.Check />
                                  ) : isSinergia ? (
                                    <IconLoader />
                                  ) : (
                                    <Icons.Handshake />
                                  )}
                                </button>
                                <button
                                  title="E-mail"
                                  style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 6,
                                    border: `1px solid ${colors.border}`,
                                    background: colors.surfaceLight,
                                    color: colors.textMuted,
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                  }}
                                >
                                  <Icons.Mail />
                                </button>
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div
                style={{
                  padding: "10px 20px",
                  borderTop: `1px solid ${colors.border}`,
                  fontSize: 12,
                  color: colors.textMuted,
                }}
              >
                {filteredMatches.length} matches · Evento: {selectedEvento.nome}
              </div>
            </div>
          ) : (
            <div
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 14,
                padding: 40,
                textAlign: "center",
              }}
            >
              <span style={{ fontSize: 13, color: colors.textMuted }}>
                Nenhum match encontrado para este evento
              </span>
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 50,
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "flex",
              justifyContent: "center",
              color: colors.textMuted,
              marginBottom: 12,
            }}
          >
            <Icons.Calendar />
          </span>
          <p style={{ fontSize: 14, color: colors.textMuted }}>
            Selecione um evento acima para ver os matches entre empresas
            participantes e associados
          </p>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════
// ─── EVENTOS × ASSOC × EMPRESA (matches contextuais do evento) ───
// ═════════════════════════════════════════════════════════════════
// Lista eventos no painel superior; ao selecionar, exibe os matches
// empresa × associado gerados para aquele evento (ambos precisam estar
// inscritos). Todos os matches de todos os eventos são pré-carregados
// no mount para navegação rápida entre eventos.
//
// Características:
//   • Lista APENAS empresas e associados INSCRITOS no evento
//   • Usa IA (Gemini via /api/ai/analisar-evento/:id) pra gerar matches
//   • Persiste em MatchEvento no banco (tipoMatch=EMPRESA_ASSOCIADO)
//   • Respeita v14.4: matches com status ≠ PENDING não são regenerados
function EventosAssocEmpresaPage({ eventosData = [] }) {
  // ─── Estado principal ───
  const [selectedEventoId, setSelectedEventoId] = useState(null);
  // Map<eventoId, Array<match>> — matches pré-carregados de todos os eventos
  const [matchesByEvento, setMatchesByEvento] = useState({});
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [generatingForEvento, setGeneratingForEvento] = useState(null);
  const [error, setError] = useState(null);
  const [feedback, setFeedback] = useState(null);

  // ─── Filtros do painel de eventos (topo) ───
  const [eventoFilter, setEventoFilter] = useState("");
  const [eventoStatusFilter, setEventoStatusFilter] = useState("");
  const [eventoSort, setEventoSort] = useState("data-asc");
  const [eventoPage, setEventoPage] = useState(1);
  const EVENTOS_PER_PAGE = 5;

  // ─── Filtros da tabela de matches (painel inferior) ───
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // ─── Pré-carregamento: TODOS os matches de TODOS os eventos no mount ───
  useEffect(() => {
    if (!Array.isArray(eventosData) || eventosData.length === 0) return;
    let cancelled = false;
    const load = async () => {
      setLoadingMatches(true);
      try {
        const results = await Promise.all(
          eventosData.map(
            (ev) =>
              api
                .get(`/eventos/${ev.id}/matches`)
                .then((resp) => [
                  ev.id,
                  Array.isArray(resp.matches) ? resp.matches : [],
                ])
                .catch(() => [ev.id, []]), // evento sem matches ou erro: vazio
          ),
        );
        if (cancelled) return;
        setMatchesByEvento(Object.fromEntries(results));
      } finally {
        if (!cancelled) setLoadingMatches(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [eventosData]);

  // ─── Eventos filtrados/ordenados ───
  const filteredEventos = eventosData
    .filter((e) => {
      const matchSearch =
        !eventoFilter ||
        e.nome?.toLowerCase().includes(eventoFilter.toLowerCase());
      const matchStatus =
        !eventoStatusFilter || e.status === eventoStatusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      if (eventoSort === "data-asc")
        return String(a.data || "").localeCompare(String(b.data || ""));
      if (eventoSort === "data-desc")
        return String(b.data || "").localeCompare(String(a.data || ""));
      if (eventoSort === "nome")
        return (a.nome || "").localeCompare(b.nome || "");
      return 0;
    });

  const totalEventoPages =
    Math.ceil(filteredEventos.length / EVENTOS_PER_PAGE) || 1;
  const paginatedEventos = filteredEventos.slice(
    (eventoPage - 1) * EVENTOS_PER_PAGE,
    eventoPage * EVENTOS_PER_PAGE,
  );

  const selectedEvento = eventosData.find((e) => e.id === selectedEventoId);
  const matchesDoEvento = selectedEventoId
    ? matchesByEvento[selectedEventoId] || []
    : [];

  // Contagens para mostrar em cada card da lista
  const contagemMatches = (eventoId) => {
    const lista = matchesByEvento[eventoId] || [];
    return lista.length;
  };

  // ─── Ações ───
  const handleGenerateForEvento = async (eventoId) => {
    setGeneratingForEvento(eventoId);
    setError(null);
    setFeedback(null);
    try {
      const resp = await api.post(`/ai/analisar-evento/${eventoId}`);
      // Recarrega os matches daquele evento
      const matchesResp = await api.get(`/eventos/${eventoId}/matches`);
      const lista = Array.isArray(matchesResp.matches)
        ? matchesResp.matches
        : [];
      setMatchesByEvento((prev) => ({ ...prev, [eventoId]: lista }));

      const novos = Array.isArray(resp.matches) ? resp.matches.length : 0;
      const preservados = resp.matchesPreservados || 0;
      setFeedback({
        success: true,
        message: `${novos} novo${novos !== 1 ? "s" : ""} match${novos !== 1 ? "es" : ""} gerado${novos !== 1 ? "s" : ""}${preservados > 0 ? ` · ${preservados} preservado${preservados > 1 ? "s" : ""}` : ""}`,
      });
      setTimeout(() => setFeedback(null), 6000);
    } catch (err) {
      const msg =
        err.status === 400
          ? "O evento precisa ter pelo menos 1 empresa e 1 associado inscritos"
          : err.message || "Erro ao gerar matches";
      setError(msg);
    } finally {
      setGeneratingForEvento(null);
    }
  };

  const handleStatusChange = async (matchId, newStatus) => {
    if (!selectedEventoId) return;
    try {
      await api.patch(
        `/eventos/${selectedEventoId}/matches/${matchId}/status`,
        { status: newStatus },
      );
      setMatchesByEvento((prev) => ({
        ...prev,
        [selectedEventoId]: (prev[selectedEventoId] || []).map((m) =>
          m.id === matchId ? { ...m, status: newStatus } : m,
        ),
      }));
    } catch (err) {
      setError(`Não foi possível atualizar status: ${err.message}`);
    }
  };

  // ─── Helpers visuais ───
  const getScoreColor = (s) =>
    s >= 85
      ? colors.green
      : s >= 70
        ? colors.blue
        : s >= 50
          ? colors.orange
          : colors.red;
  const getPriority = (s) =>
    s >= 80
      ? { label: "ALTA", color: colors.green, bg: `${colors.green}15` }
      : s >= 60
        ? { label: "MÉDIA", color: colors.orange, bg: `${colors.orange}15` }
        : { label: "BAIXA", color: colors.textMuted, bg: colors.surfaceLight };

  // Matches filtrados (por busca e status)
  const filteredMatches = matchesDoEvento.filter((m) => {
    const empNome = m.empresa?.nome || "";
    const assocNome = m.associado?.nome || "";
    const matchSearch =
      !searchTerm ||
      empNome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      assocNome.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = !statusFilter || m.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Eventos × Assoc × Empresa
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {eventosData.length} evento{eventosData.length !== 1 ? "s" : ""} ·
            Matches contextuais entre empresas e associados inscritos
          </p>
        </div>
      </div>

      {feedback && (
        <div
          style={{
            background: `${colors.green}10`,
            border: `1px solid ${colors.green}30`,
            borderRadius: 12,
            padding: "14px 20px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ color: colors.green, display: "flex" }}>
            <Icons.Check />
          </span>
          <span style={{ fontSize: 13, color: colors.green, fontWeight: 600 }}>
            {feedback.message}
          </span>
        </div>
      )}
      {error && (
        <div
          style={{
            background: `${colors.red}10`,
            border: `1px solid ${colors.red}30`,
            borderRadius: 12,
            padding: "14px 20px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ color: colors.red, display: "flex" }}>
            <IconAlert />
          </span>
          <span
            style={{
              fontSize: 13,
              color: colors.red,
              fontWeight: 600,
              flex: 1,
            }}
          >
            {error}
          </span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: colors.textMuted,
              fontSize: 18,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* ─── Seletor de Eventos ─── */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          marginBottom: 24,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: colors.text,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icons.Calendar /> Eventos
          </span>
          <div style={{ flex: 1, position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 10,
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.textMuted,
              }}
            >
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Filtrar eventos..."
              value={eventoFilter}
              onChange={(e) => {
                setEventoFilter(e.target.value);
                setEventoPage(1);
              }}
              style={{
                width: "100%",
                padding: "8px 10px 8px 34px",
                borderRadius: 8,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.text,
                fontSize: 12,
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <select
            value={eventoStatusFilter}
            onChange={(e) => {
              setEventoStatusFilter(e.target.value);
              setEventoPage(1);
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="">Todos</option>
            <option value="Ativo">Ativos</option>
            <option value="Planejado">Planejados</option>
            <option value="Finalizado">Finalizados</option>
          </select>
          <select
            value={eventoSort}
            onChange={(e) => setEventoSort(e.target.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="data-asc">Data ↑</option>
            <option value="data-desc">Data ↓</option>
            <option value="nome">Nome A-Z</option>
          </select>
        </div>

        <div>
          {paginatedEventos.length > 0 ? (
            paginatedEventos.map((ev) => {
              const isSelected = selectedEventoId === ev.id;
              const isAtivo = ev.status === "Ativo";
              const nMatches = contagemMatches(ev.id);
              const nParticipantes = ev.participantes || 0;
              const nAssociados = ev.associados || 0;
              return (
                <div
                  key={ev.id}
                  onClick={() => setSelectedEventoId(isSelected ? null : ev.id)}
                  style={{
                    padding: "12px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    cursor: "pointer",
                    borderBottom: `1px solid ${colors.border}`,
                    transition: "background 0.15s",
                    background: isSelected ? `${colors.blue}10` : "transparent",
                    borderLeft: isSelected
                      ? `3px solid ${colors.blue}`
                      : "3px solid transparent",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = colors.surfaceLight;
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      color: isAtivo ? colors.green : colors.blue,
                      display: "flex",
                    }}
                  >
                    <Icons.Calendar />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: isSelected ? 700 : 500,
                        color: isSelected ? colors.blue : colors.text,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ev.nome}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.textMuted,
                        marginTop: 2,
                      }}
                    >
                      {ev.data || "—"} · {ev.local || "—"}
                    </div>
                  </div>
                  <span
                    style={{
                      padding: "3px 10px",
                      borderRadius: 12,
                      fontSize: 10,
                      fontWeight: 700,
                      background: isAtivo
                        ? `${colors.green}15`
                        : `${colors.blue}15`,
                      color: isAtivo ? colors.green : colors.blue,
                    }}
                  >
                    {ev.status}
                  </span>
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      minWidth: 140,
                      justifyContent: "flex-end",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: colors.blue,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="Empresas inscritas"
                    >
                      <Icons.Building /> {nParticipantes}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: colors.purple,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="Associados inscritos"
                    >
                      <Icons.User /> {nAssociados}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: colors.green,
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      title="Matches gerados"
                    >
                      <Icons.Target /> {nMatches}
                    </span>
                  </div>
                  {isSelected && (
                    <span style={{ color: colors.blue, fontSize: 16 }}>▼</span>
                  )}
                </div>
              );
            })
          ) : (
            <div
              style={{
                padding: 24,
                textAlign: "center",
                fontSize: 13,
                color: colors.textMuted,
              }}
            >
              Nenhum evento encontrado
            </div>
          )}
        </div>

        {totalEventoPages > 1 && (
          <div
            style={{
              padding: "10px 20px",
              borderTop: `1px solid ${colors.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 12, color: colors.textMuted }}>
              {filteredEventos.length} eventos · Página {eventoPage} de{" "}
              {totalEventoPages}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setEventoPage((p) => Math.max(1, p - 1))}
                disabled={eventoPage === 1}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  background:
                    eventoPage === 1 ? colors.surfaceLight : colors.surface,
                  color: eventoPage === 1 ? colors.textMuted : colors.text,
                  cursor: eventoPage === 1 ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                ← Anterior
              </button>
              {Array.from({ length: totalEventoPages }, (_, i) => i + 1).map(
                (p) => (
                  <button
                    key={p}
                    onClick={() => setEventoPage(p)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 6,
                      border: `1px solid ${eventoPage === p ? colors.blue : colors.border}`,
                      background:
                        eventoPage === p ? `${colors.blue}15` : colors.surface,
                      color: eventoPage === p ? colors.blue : colors.textMuted,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: eventoPage === p ? 700 : 400,
                    }}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                onClick={() =>
                  setEventoPage((p) => Math.min(totalEventoPages, p + 1))
                }
                disabled={eventoPage === totalEventoPages}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  background:
                    eventoPage === totalEventoPages
                      ? colors.surfaceLight
                      : colors.surface,
                  color:
                    eventoPage === totalEventoPages
                      ? colors.textMuted
                      : colors.text,
                  cursor:
                    eventoPage === totalEventoPages ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      {loadingMatches && !selectedEvento && (
        <div
          style={{
            padding: 20,
            textAlign: "center",
            color: colors.textMuted,
            fontSize: 13,
          }}
        >
          Carregando matches dos eventos...
        </div>
      )}

      {/* ─── Detalhes do evento selecionado ─── */}
      {selectedEvento ? (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div>
              <h3
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: colors.text,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                Matches em "{selectedEvento.nome}"
              </h3>
              <p
                style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}
              >
                {matchesDoEvento.length} match
                {matchesDoEvento.length !== 1 ? "es" : ""} entre empresas e
                associados inscritos
                {filteredMatches.length !== matchesDoEvento.length &&
                  ` · ${filteredMatches.length} exibido${filteredMatches.length !== 1 ? "s" : ""} após filtros`}
              </p>
            </div>
            <button
              onClick={() => handleGenerateForEvento(selectedEventoId)}
              disabled={generatingForEvento === selectedEventoId}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                border: "none",
                background:
                  generatingForEvento === selectedEventoId
                    ? colors.surfaceLight
                    : `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
                color:
                  generatingForEvento === selectedEventoId
                    ? colors.textMuted
                    : "#fff",
                cursor:
                  generatingForEvento === selectedEventoId ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              {generatingForEvento === selectedEventoId ? (
                <>
                  <IconLoader /> Analisando com IA...
                </>
              ) : (
                <>
                  <Icons.Sparkles /> Gerar matches com IA
                </>
              )}
            </button>
          </div>

          {/* Filtros da tabela */}
          {matchesDoEvento.length > 0 && (
            <div
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 14,
                padding: "14px 20px",
                marginBottom: 16,
                display: "flex",
                gap: 14,
                alignItems: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 2, minWidth: 220, position: "relative" }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: colors.textMuted,
                    letterSpacing: 0.8,
                    display: "block",
                    marginBottom: 6,
                    textTransform: "uppercase",
                  }}
                >
                  Buscar
                </label>
                <div style={{ position: "relative" }}>
                  <span
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      color: colors.textMuted,
                    }}
                  >
                    <Icons.Search />
                  </span>
                  <input
                    type="text"
                    placeholder="Buscar empresa ou associado..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 12px 10px 38px",
                      borderRadius: 10,
                      border: `1px solid ${colors.border}`,
                      background: colors.surfaceLight,
                      color: colors.text,
                      fontSize: 13,
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: colors.textMuted,
                    letterSpacing: 0.8,
                    display: "block",
                    marginBottom: 6,
                    textTransform: "uppercase",
                  }}
                >
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceLight,
                    color: colors.text,
                    fontSize: 13,
                    outline: "none",
                  }}
                >
                  <option value="">Todos</option>
                  <option value="PENDING">Pending</option>
                  <option value="CONTACTED">Contacted</option>
                  <option value="INTERESTED">Interested</option>
                  <option value="CONFIRMED">Confirmed</option>
                  <option value="REJECTED">Rejected</option>
                </select>
              </div>
              <button
                onClick={() => {
                  setSearchTerm("");
                  setStatusFilter("");
                }}
                style={{
                  padding: "10px 16px",
                  borderRadius: 10,
                  border: `1px solid ${colors.border}`,
                  background: colors.surfaceLight,
                  color: colors.textMuted,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Limpar
              </button>
            </div>
          )}

          {/* Tabela de matches */}
          {matchesDoEvento.length === 0 ? (
            <div
              style={{
                background: colors.surface,
                border: `1px dashed ${colors.border}`,
                borderRadius: 14,
                padding: 40,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  marginBottom: 12,
                  color: colors.textMuted,
                  opacity: 0.6,
                }}
              >
                <Icons.Target />
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: colors.text,
                  marginBottom: 6,
                }}
              >
                Nenhum match gerado ainda para este evento
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: colors.textMuted,
                  marginBottom: 18,
                }}
              >
                Clique em <strong>Gerar matches com IA</strong> para analisar os
                inscritos do evento.
              </div>
            </div>
          ) : filteredMatches.length === 0 ? (
            <div
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 14,
                padding: 30,
                textAlign: "center",
                color: colors.textMuted,
                fontSize: 13,
              }}
            >
              Nenhum match corresponde aos filtros aplicados
            </div>
          ) : (
            <div
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 14,
                overflow: "hidden",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: `1px solid ${colors.border}`,
                      background: colors.surfaceLight,
                    }}
                  >
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "center",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                        width: 50,
                      }}
                    >
                      #
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Empresa
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "left",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Associado
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "center",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Score
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "center",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Prioridade
                    </th>
                    <th
                      style={{
                        padding: "12px 16px",
                        textAlign: "center",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMatches.map((m, i) => {
                    const pr = getPriority(m.score);
                    return (
                      <tr
                        key={m.id}
                        style={{
                          borderBottom: `1px solid ${colors.border}`,
                          transition: "background 0.15s",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background = `${colors.blue}06`)
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        <td
                          style={{
                            padding: "12px 16px",
                            textAlign: "center",
                            fontSize: 13,
                            fontWeight: 700,
                            color: i < 3 ? colors.orange : colors.textMuted,
                          }}
                        >
                          {i + 1}
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: colors.text,
                            }}
                          >
                            {m.empresa?.nome || `Empresa #${m.empresaId}`}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: colors.textMuted,
                              marginTop: 2,
                            }}
                          >
                            {m.empresa?.setor || "—"}
                            {m.empresa?.cidade ? ` · ${m.empresa.cidade}` : ""}
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 600,
                              color: colors.purple,
                            }}
                          >
                            {m.associado?.nome || `Associado #${m.associadoId}`}
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              color: colors.textMuted,
                              marginTop: 2,
                            }}
                          >
                            {m.associado?.segmento || "—"}
                          </div>
                        </td>
                        <td
                          style={{ padding: "12px 16px", textAlign: "center" }}
                        >
                          <span
                            style={{
                              fontSize: 16,
                              fontWeight: 800,
                              color: getScoreColor(m.score),
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {m.score}%
                          </span>
                        </td>
                        <td
                          style={{ padding: "12px 16px", textAlign: "center" }}
                        >
                          <span
                            style={{
                              padding: "4px 10px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 700,
                              background: pr.bg,
                              color: pr.color,
                            }}
                          >
                            {pr.label}
                          </span>
                        </td>
                        <td
                          style={{ padding: "12px 16px", textAlign: "center" }}
                        >
                          <select
                            value={m.status}
                            onChange={(e) =>
                              handleStatusChange(m.id, e.target.value)
                            }
                            style={{
                              padding: "6px 8px",
                              borderRadius: 6,
                              border: `1px solid ${colors.border}`,
                              fontSize: 11,
                              background: "#fff",
                              color: colors.text,
                              fontWeight: 600,
                            }}
                          >
                            <option value="PENDING">Pending</option>
                            <option value="CONTACTED">Contacted</option>
                            <option value="INTERESTED">Interested</option>
                            <option value="CONFIRMED">Confirmed</option>
                            <option value="REJECTED">Rejected</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            background: colors.surface,
            border: `1px dashed ${colors.border}`,
            borderRadius: 14,
            padding: 40,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: 12,
              color: colors.textMuted,
              opacity: 0.6,
            }}
          >
            <Icons.Calendar />
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: colors.text,
              marginBottom: 6,
            }}
          >
            Selecione um evento acima
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            Os matches empresa × associado são gerados por evento, considerando
            os inscritos
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════
// ─── GESTÃO DE EVENTOS PAGE ───
// ═════════════════════════════════
// ─── Botão de ação compacto e elegante para a tabela de eventos ───
// Pílula 36×36 com ícone SVG, fundo discreto, hover com lift + sombra colorida.
// Cores semânticas: verde=ativar, laranja=pausar, azul=link, roxo=editar, vermelho=excluir.
function EventActionBtn({ onClick, tooltip, color, icon }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      title={tooltip}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        border: "none",
        background: hover ? color : "transparent",
        color: hover ? "#fff" : color,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        transition: "all 0.18s ease",
        transform: hover ? "translateY(-1px)" : "translateY(0)",
        boxShadow: hover ? `0 4px 10px ${color}40` : "none",
      }}
    >
      {icon}
    </button>
  );
}

function IconLink() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconPause() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function GestaoEventosPage({
  setPage,
  eventosData,
  onUpdate,
  onDelete,
  onToggleStatus,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [linkEvento, setLinkEvento] = useState(null); // evento cujo modal de link está aberto
  const totalEventos = eventosData.length;
  const eventosAtivos = eventosData.filter((e) => e.status === "Ativo").length;
  const totalParticipantes = eventosData.reduce(
    (acc, e) => acc + (e.participantes || 0),
    0,
  );
  const totalMatches = eventosData.reduce(
    (acc, e) => acc + (e.matches || 0),
    0,
  );
  const taxaMediaMatch =
    totalEventos > 0
      ? Math.round(
          eventosData.reduce((acc, e) => acc + (e.taxaMatch || 0), 0) /
            totalEventos,
        )
      : 0;
  const filtered = eventosData.filter((e) => {
    const s =
      !searchTerm ||
      e.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.local || "").toLowerCase().includes(searchTerm.toLowerCase());
    return s && (!filterStatus || e.status === filterStatus);
  });
  const openEdit = (ev) => {
    setEditingId(ev.id);
    setEditForm({
      nome: ev.nome,
      local: ev.local,
      data: ev.data,
      numero: ev.numero || "",
      descricao: ev.descricao || "",
      status: ev.status || "Planejado",
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };
  const saveEdit = () => {
    if (!editForm.nome?.trim()) return;
    setSaving(true);
    setTimeout(() => {
      if (onUpdate) onUpdate(editingId, editForm);
      setSaving(false);
      setEditingId(null);
    }, 800);
  };
  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };
  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Gestão de Eventos
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {totalEventos} eventos · {eventosAtivos} ativo
            {eventosAtivos !== 1 ? "s" : ""} · {totalParticipantes}{" "}
            participantes
          </p>
        </div>
        <button
          onClick={() => setPage && setPage("novo-evento")}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: `linear-gradient(135deg, ${colors.orange}, ${colors.orange}cc)`,
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          + Novo Evento
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard label="Eventos" value={totalEventos} color={colors.blue} />
        <StatCard
          label="Ativos"
          value={eventosAtivos}
          color={colors.green}
          delay={0.05}
        />
        <StatCard
          label="Participantes"
          value={totalParticipantes}
          color={colors.orange}
          delay={0.1}
        />
        <StatCard
          label="Matches IA"
          value={totalMatches}
          color={colors.purple}
          delay={0.15}
        />
        <StatCard
          label="Taxa Média"
          value={`${taxaMediaMatch}%`}
          color={colors.pink}
          delay={0.2}
        />
      </div>

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: 2 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Buscar
          </label>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.textMuted,
              }}
            >
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Buscar evento..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ ...fld, paddingLeft: 38 }}
            />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Status
          </label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={fld}
          >
            <option value="">Todos</option>
            <option value="Ativo">Ativo</option>
            <option value="Planejado">Planejado</option>
          </select>
        </div>
        <button
          onClick={() => {
            setSearchTerm("");
            setFilterStatus("");
          }}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceLight,
            color: colors.textMuted,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Limpar
        </button>
      </div>

      <div style={{ marginBottom: 16, fontSize: 13, color: colors.textMuted }}>
        Mostrando{" "}
        <span style={{ fontWeight: 700, color: colors.text }}>
          {filtered.length}
        </span>{" "}
        eventos
      </div>

      {filtered.length > 0 ? (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${colors.border}`,
                  background: colors.surfaceLight,
                }}
              >
                {[
                  { key: "Evento", label: "Evento" },
                  { key: "Local", label: "Local" },
                  { key: "Data", label: "Data" },
                  { key: "Status", label: "Status" },
                  { key: "Participantes", label: <Icons.User /> },
                  { key: "Matches", label: <Icons.Target /> },
                  { key: "Ações", label: "Ações" },
                ].map((h) => (
                  <th
                    key={h.key}
                    style={{
                      padding: "12px 16px",
                      textAlign:
                        h.key === "Ações" ||
                        h.key === "Status" ||
                        h.key === "Participantes" ||
                        h.key === "Matches"
                          ? "center"
                          : "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    {h.key === "Participantes" || h.key === "Matches" ? (
                      <span
                        style={{ display: "flex", justifyContent: "center" }}
                      >
                        {h.label}
                      </span>
                    ) : (
                      h.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ev) => {
                const isAtivo = ev.status === "Ativo";
                return (
                  <tr
                    key={ev.id}
                    style={{
                      borderBottom: `1px solid ${colors.border}`,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = `${colors.blue}06`)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <td style={{ padding: "14px 16px" }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: colors.text,
                        }}
                      >
                        {ev.nome}
                      </div>
                      {ev.descricao && (
                        <div
                          style={{
                            fontSize: 11,
                            color: colors.textMuted,
                            marginTop: 2,
                          }}
                        >
                          {ev.descricao.substring(0, 50)}
                          {ev.descricao.length > 50 ? "..." : ""}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: "14px 16px",
                        fontSize: 13,
                        color: colors.textMuted,
                      }}
                    >
                      {ev.local}
                    </td>
                    <td
                      style={{
                        padding: "14px 16px",
                        fontSize: 13,
                        fontWeight: 600,
                        color: colors.text,
                      }}
                    >
                      {ev.data}
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "center" }}>
                      <span
                        style={{
                          padding: "4px 12px",
                          borderRadius: 20,
                          fontSize: 11,
                          fontWeight: 700,
                          background: isAtivo
                            ? `${colors.green}15`
                            : `${colors.blue}15`,
                          color: isAtivo ? colors.green : colors.blue,
                        }}
                      >
                        {isAtivo ? "Ativo" : "Planejado"}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: "14px 16px",
                        textAlign: "center",
                        fontSize: 16,
                        fontWeight: 800,
                        color: colors.orange,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {ev.participantes || 0}
                    </td>
                    <td
                      style={{
                        padding: "14px 16px",
                        textAlign: "center",
                        fontSize: 16,
                        fontWeight: 800,
                        color: colors.green,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {ev.matches || 0}
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "center" }}>
                      <div
                        style={{
                          display: "inline-flex",
                          gap: 4,
                          padding: 4,
                          background: colors.surfaceLight,
                          borderRadius: 10,
                          border: `1px solid ${colors.border}`,
                        }}
                      >
                        {onToggleStatus && (
                          <EventActionBtn
                            onClick={() => onToggleStatus(ev.id)}
                            tooltip={
                              isAtivo ? "Pausar evento" : "Ativar evento"
                            }
                            color={isAtivo ? colors.orange : colors.green}
                            icon={
                              isAtivo ? (
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <rect x="6" y="4" width="4" height="16" />
                                  <rect x="14" y="4" width="4" height="16" />
                                </svg>
                              ) : (
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                  stroke="none"
                                >
                                  <polygon points="6 4 20 12 6 20 6 4" />
                                </svg>
                              )
                            }
                          />
                        )}
                        <EventActionBtn
                          onClick={() => setLinkEvento(ev)}
                          tooltip="Link de inscrição pública"
                          color={colors.blue}
                          icon={
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                            </svg>
                          }
                        />
                        <EventActionBtn
                          onClick={() => openEdit(ev)}
                          tooltip="Editar evento"
                          color={colors.purple}
                          icon={
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          }
                        />
                        {onDelete && (
                          <EventActionBtn
                            onClick={() => onDelete(ev.id)}
                            tooltip="Excluir evento"
                            color={colors.red}
                            icon={
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6" />
                                <path d="M14 11v6" />
                                <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                              </svg>
                            }
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div
            style={{
              padding: "10px 20px",
              borderTop: `1px solid ${colors.border}`,
              fontSize: 12,
              color: colors.textMuted,
            }}
          >
            {filtered.length} eventos · Taxa média: {taxaMediaMatch}%
          </div>
        </div>
      ) : (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 60,
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "flex",
              justifyContent: "center",
              color: colors.textMuted,
              marginBottom: 16,
            }}
          >
            <Icons.Calendar />
          </span>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            Nenhum evento encontrado
          </h3>
          <p style={{ fontSize: 14, color: colors.textMuted }}>
            Clique em "+ Novo Evento" para começar
          </p>
        </div>
      )}

      <EditModal
        title="Editar Evento"
        isOpen={!!editingId}
        onClose={cancelEdit}
        onSave={saveEdit}
        saving={saving}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <FormField label="Nome *">
            <input
              value={editForm.nome || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, nome: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="Local">
            <input
              value={editForm.local || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, local: e.target.value })
              }
              style={fld}
            />
          </FormField>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <FormField label="Data">
            <input
              value={editForm.data || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, data: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="WhatsApp">
            <input
              value={editForm.numero || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, numero: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="Status">
            <select
              value={editForm.status || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, status: e.target.value })
              }
              style={fld}
            >
              <option value="Ativo">Ativo</option>
              <option value="Planejado">Planejado</option>
            </select>
          </FormField>
        </div>
        <FormField label="Descrição">
          <textarea
            value={editForm.descricao || ""}
            onChange={(e) =>
              setEditForm({ ...editForm, descricao: e.target.value })
            }
            style={{ ...fld, minHeight: 80, resize: "none" }}
          />
        </FormField>
      </EditModal>

      {linkEvento && (
        <InscricaoLinkModal
          evento={linkEvento}
          onClose={() => setLinkEvento(null)}
          onUpdated={(updated) => {
            // Atualiza o evento na lista quando slug/ativa mudam
            if (onUpdate)
              onUpdate(updated.id, {
                ...linkEvento,
                inscricaoSlug: updated.inscricaoSlug,
                inscricaoAtiva: updated.inscricaoAtiva,
              });
            setLinkEvento({ ...linkEvento, ...updated });
          }}
        />
      )}
    </div>
  );
}

// ─── Modal: painel de link de inscrição pública ───
function InscricaoLinkModal({ evento, onClose, onUpdated }) {
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState(evento.inscricaoSlug || null);
  const [ativa, setAtiva] = useState(evento.inscricaoAtiva !== false);
  const [toggling, setToggling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);

  // Se o evento não tem slug ainda (criado antes da feature), dispara criação
  // automaticamente ao abrir o modal. A API gera slug se não existir quando
  // toggle é chamado.
  useEffect(() => {
    if (!slug) {
      (async () => {
        try {
          const updated = await api.patch(`/eventos/${evento.id}/inscricao`, {
            ativa: true,
          });
          setSlug(updated.inscricaoSlug);
          setAtiva(!!updated.inscricaoAtiva);
          if (onUpdated) onUpdated(updated);
        } catch (e) {
          setError(`Não foi possível gerar o link: ${e.message}`);
        }
      })();
    }
  }, [evento.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const linkCompleto = slug
    ? `${window.location.origin}/inscricao/${slug}`
    : null;

  const copiar = async () => {
    if (!linkCompleto) return;
    try {
      await navigator.clipboard.writeText(linkCompleto);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback pra browsers sem clipboard API
      const ta = document.createElement("textarea");
      ta.value = linkCompleto;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    setError(null);
    try {
      const updated = await api.patch(`/eventos/${evento.id}/inscricao`, {
        ativa: !ativa,
      });
      setAtiva(!!updated.inscricaoAtiva);
      setSlug(updated.inscricaoSlug);
      if (onUpdated) onUpdated(updated);
    } catch (e) {
      setError(`Não foi possível alterar: ${e.message}`);
    } finally {
      setToggling(false);
    }
  };

  const handleRegenerate = async () => {
    if (
      !window.confirm(
        "Regenerar o link tornará o link atual inválido. Confirma?",
      )
    )
      return;
    setRegenerating(true);
    setError(null);
    try {
      const resp = await api.post(
        `/eventos/${evento.id}/inscricao/regenerate`,
        {},
      );
      setSlug(resp.inscricaoSlug);
      if (onUpdated)
        onUpdated({ inscricaoSlug: resp.inscricaoSlug, inscricaoAtiva: ativa });
    } catch (e) {
      setError(`Erro ao regenerar: ${e.message}`);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          maxWidth: 560,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: colors.text,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <IconLink /> Link de inscrição pública
            </div>
            <div
              style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}
            >
              {evento.nome}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              color: colors.textMuted,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {error && (
            <div
              style={{
                background: `${colors.red}10`,
                border: `1px solid ${colors.red}30`,
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: 12,
                color: colors.red,
              }}
            >
              <IconAlert /> {error}
            </div>
          )}

          {/* Status do link */}
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              background: ativa ? `${colors.green}08` : `${colors.orange}08`,
              border: `1px solid ${ativa ? colors.green : colors.orange}30`,
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span
              style={{
                color: ativa ? colors.green : colors.orange,
                display: "flex",
              }}
            >
              {ativa ? <Icons.Check /> : <IconPause />}
            </span>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: ativa ? colors.green : colors.orange,
                }}
              >
                {ativa ? "Inscrições abertas" : "Inscrições pausadas"}
              </div>
              <div
                style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}
              >
                {ativa
                  ? "Qualquer pessoa com o link pode se inscrever"
                  : "O link está desativado — ninguém consegue se inscrever"}
              </div>
            </div>
            <button
              onClick={handleToggle}
              disabled={toggling}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: ativa ? colors.orange : colors.green,
                color: "#fff",
                cursor: toggling ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {toggling ? "..." : ativa ? "Pausar" : "Ativar"}
            </button>
          </div>

          {/* URL */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              marginBottom: 6,
            }}
          >
            URL pública
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              background: colors.surfaceLight,
              border: `1px solid ${colors.border}`,
              borderRadius: 8,
              marginBottom: 14,
            }}
          >
            <input
              readOnly
              value={linkCompleto || "Gerando link..."}
              onClick={(e) => e.target.select()}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                color: colors.text,
                fontSize: 12,
                outline: "none",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            />
            <button
              onClick={copiar}
              disabled={!linkCompleto}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "none",
                background: copied ? colors.green : colors.blue,
                color: "#fff",
                cursor: linkCompleto ? "pointer" : "not-allowed",
                fontSize: 11,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>

          <div
            style={{
              fontSize: 11,
              color: colors.textMuted,
              marginBottom: 20,
              lineHeight: 1.6,
            }}
          >
            Compartilhe este link com empresas que devem se inscrever no evento.
            Elas vão preencher um formulário e virão vinculadas{" "}
            <strong>exclusivamente</strong> a este evento (não participam de
            matches globais).
          </div>

          {/* Ações perigosas */}
          <div
            style={{ paddingTop: 14, borderTop: `1px solid ${colors.border}` }}
          >
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: `1px solid ${colors.red}40`,
                background: "transparent",
                color: colors.red,
                cursor: regenerating ? "wait" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {regenerating ? (
                "Regenerando..."
              ) : (
                <>
                  <IconRefresh /> Regenerar link (invalida o anterior)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════
// ─── GESTÃO DE EMPRESAS PAGE ───
// ══════════════════════════════════
function IconEdit() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </svg>
  );
}

function GestaoPage({ setPage, empresasData, onDelete, onEdit }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [setorFilter, setSetorFilter] = useState("");
  const [tipoFilter, setTipoFilter] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const allSetores = [
    ...new Set(empresasData.map((e) => e.segmento || e.setor).filter(Boolean)),
  ];
  const allTipos = [
    ...new Set(empresasData.map((e) => e.tipo).filter(Boolean)),
  ];
  const filtered = empresasData.filter((e) => {
    const s =
      !searchTerm ||
      e.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.email || "").toLowerCase().includes(searchTerm.toLowerCase());
    return (
      s &&
      (!setorFilter || (e.segmento || e.setor) === setorFilter) &&
      (!tipoFilter || e.tipo === tipoFilter)
    );
  });
  const openEdit = (e) => {
    setEditingId(e.id);
    setEditForm({
      nome: e.nome,
      segmento: e.segmento || e.setor || "",
      porte: e.porte || "",
      cidade: e.cidade || "",
      estado: e.estado || "",
      tipo: e.tipo || "",
      email: e.email || "",
      telefone: e.telefone || "",
      produtosOferecidos: e.produtosOferecidos || "",
      produtosDemandados: e.produtosDemandados || "",
      desc: e.desc || "",
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };
  const saveEdit = () => {
    if (!editForm.nome?.trim()) return;
    setSaving(true);
    setTimeout(() => {
      if (onEdit) onEdit(editingId, editForm);
      setSaving(false);
      setEditingId(null);
    }, 800);
  };
  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };
  const lbl = {
    fontSize: 11,
    fontWeight: 700,
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    display: "block",
    marginBottom: 6,
  };
  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Gestão de Empresas
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {empresasData.length} empresas cadastradas
          </p>
        </div>
        <button
          onClick={() => setPage("nova-empresa")}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: `linear-gradient(135deg, ${colors.green}, ${colors.green}cc)`,
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          + Nova Empresa
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Total"
          value={empresasData.length}
          color={colors.purple}
        />
        <StatCard
          label="Exportadoras"
          value={empresasData.filter((e) => e.tipo === "Exportador").length}
          color={colors.green}
          delay={0.05}
        />
        <StatCard
          label="Importadoras"
          value={empresasData.filter((e) => e.tipo === "Importador").length}
          color={colors.blue}
          delay={0.1}
        />
        <StatCard
          label="Ambos"
          value={empresasData.filter((e) => e.tipo === "Ambos").length}
          color={colors.orange}
          delay={0.15}
        />
      </div>

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: 2 }}>
          <label style={lbl}>Buscar</label>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.textMuted,
              }}
            >
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Buscar empresa..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ ...fld, paddingLeft: 38 }}
            />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Setor</label>
          <select
            value={setorFilter}
            onChange={(e) => setSetorFilter(e.target.value)}
            style={fld}
          >
            <option value="">Todos</option>
            {allSetores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={lbl}>Tipo</label>
          <select
            value={tipoFilter}
            onChange={(e) => setTipoFilter(e.target.value)}
            style={fld}
          >
            <option value="">Todos</option>
            {allTipos.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            setSearchTerm("");
            setSetorFilter("");
            setTipoFilter("");
          }}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceLight,
            color: colors.textMuted,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Limpar
        </button>
      </div>
      <div style={{ marginBottom: 16, fontSize: 13, color: colors.textMuted }}>
        Mostrando{" "}
        <span style={{ fontWeight: 700, color: colors.text }}>
          {filtered.length}
        </span>{" "}
        empresas
      </div>
      {filtered.length > 0 ? (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${colors.border}`,
                  background: colors.surfaceLight,
                }}
              >
                {["Empresa", "Setor", "Local", "Tipo", "Porte", "Ações"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        padding: "12px 16px",
                        textAlign:
                          h === "Ações" || h === "Tipo" || h === "Porte"
                            ? "center"
                            : "left",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(ev) =>
                    (ev.currentTarget.style.background = `${colors.blue}06`)
                  }
                  onMouseLeave={(ev) =>
                    (ev.currentTarget.style.background = "transparent")
                  }
                >
                  <td style={{ padding: "14px 16px" }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: colors.text,
                      }}
                    >
                      {e.nome}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.textMuted,
                        marginTop: 2,
                      }}
                    >
                      {e.email}
                      {e.telefone ? ` · ${e.telefone}` : ""}
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "14px 16px",
                      fontSize: 13,
                      color: colors.textMuted,
                    }}
                  >
                    {e.segmento || e.setor}
                  </td>
                  <td
                    style={{
                      padding: "14px 16px",
                      fontSize: 13,
                      color: colors.textMuted,
                    }}
                  >
                    {e.cidade}, {e.estado}
                  </td>
                  <td style={{ padding: "14px 16px", textAlign: "center" }}>
                    <span
                      style={{
                        padding: "4px 12px",
                        borderRadius: 20,
                        fontSize: 10,
                        fontWeight: 700,
                        background: `${colors.blue}12`,
                        color: colors.blue,
                      }}
                    >
                      {e.tipo}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                      fontSize: 12,
                      color: colors.textMuted,
                    }}
                  >
                    {e.porte || "—"}
                  </td>
                  <td style={{ padding: "14px 16px", textAlign: "center" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <button
                        onClick={() => openEdit(e)}
                        title="Editar"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          border: `1px solid ${colors.border}`,
                          background: colors.surfaceLight,
                          color: colors.textMuted,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                        }}
                      >
                        <IconEdit />
                      </button>
                      <button
                        onClick={() => onDelete && onDelete(e.id)}
                        title="Excluir"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          border: `1px solid ${colors.red}30`,
                          background: `${colors.red}08`,
                          color: colors.red,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div
            style={{
              padding: "10px 20px",
              borderTop: `1px solid ${colors.border}`,
              fontSize: 12,
              color: colors.textMuted,
            }}
          >
            {filtered.length} empresas
          </div>
        </div>
      ) : (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 60,
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "flex",
              justifyContent: "center",
              color: colors.textMuted,
              marginBottom: 16,
            }}
          >
            <Icons.Building />
          </span>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            Nenhuma empresa encontrada
          </h3>
        </div>
      )}
      <EditModal
        title="Editar Empresa"
        isOpen={!!editingId}
        onClose={cancelEdit}
        onSave={saveEdit}
        saving={saving}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <FormField label="Nome *">
            <input
              value={editForm.nome || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, nome: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="Setor">
            <select
              value={editForm.segmento || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, segmento: e.target.value })
              }
              style={fld}
            >
              {[
                "Energy",
                "Technology",
                "Logistics",
                "Food",
                "Financial",
                "Legal",
                "Agriculture",
                "Industry",
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Tipo">
            <select
              value={editForm.tipo || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, tipo: e.target.value })
              }
              style={fld}
            >
              {["Exportador", "Importador", "Ambos"].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr 1fr",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <FormField label="Porte">
            <select
              value={editForm.porte || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, porte: e.target.value })
              }
              style={fld}
            >
              {["Pequeno", "Médio", "Grande"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Cidade">
            <input
              value={editForm.cidade || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, cidade: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="Estado">
            <input
              value={editForm.estado || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, estado: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="Telefone">
            <input
              value={editForm.telefone || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, telefone: e.target.value })
              }
              style={fld}
            />
          </FormField>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <FormField label="E-mail">
            <input
              value={editForm.email || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, email: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="Descrição">
            <input
              value={editForm.desc || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, desc: e.target.value })
              }
              style={fld}
            />
          </FormField>
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}
        >
          <FormField label="Produtos Oferecidos" color={colors.green}>
            <textarea
              value={editForm.produtosOferecidos || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, produtosOferecidos: e.target.value })
              }
              style={{ ...fld, minHeight: 80, resize: "none" }}
            />
          </FormField>
          <FormField label="Produtos Demandados" color={colors.blue}>
            <textarea
              value={editForm.produtosDemandados || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, produtosDemandados: e.target.value })
              }
              style={{ ...fld, minHeight: 80, resize: "none" }}
            />
          </FormField>
        </div>
      </EditModal>
    </div>
  );
}

// ══════════════════════════════════════
// ─── GESTÃO DE ASSOCIADOS PAGE ───
// ══════════════════════════════════════
function GestaoAssociadosPage({
  setPage,
  associadosData,
  onDelete,
  onUpdate,
  onResetSenha,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [segmentoFilter, setSegmentoFilter] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Estado do modal de reset de senha
  const [resetTarget, setResetTarget] = useState(null); // associado alvo
  const [resetMode, setResetMode] = useState("auto"); // 'auto' ou 'custom'
  const [resetCustomSenha, setResetCustomSenha] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState(null); // { novaSenha, email, geradaPorSistema, mensagem } | { error }
  const [copied, setCopied] = useState(false);
  const allSegmentos = [
    ...new Set(associadosData.map((a) => a.segmento).filter(Boolean)),
  ];
  const filtered = associadosData.filter((a) => {
    const s =
      !searchTerm ||
      a.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (a.email || "").toLowerCase().includes(searchTerm.toLowerCase());
    return s && (!segmentoFilter || a.segmento === segmentoFilter);
  });
  const openEdit = (a) => {
    setEditingId(a.id);
    setEditForm({
      nome: a.nome,
      segmento: a.segmento || "",
      porte: a.porte || "",
      email: a.email || "",
      telefone: a.telefone || "",
      whatsapp: a.whatsapp || "",
      servicos: a.servicos || "",
      produtosOferecidos: a.produtosOferecidos || "",
      produtosDemandados: a.produtosDemandados || "",
      descricao: a.descricao || "",
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };
  const saveEdit = () => {
    if (!editForm.nome?.trim()) return;
    setSaving(true);
    setTimeout(() => {
      if (onUpdate) onUpdate(editingId, editForm);
      setSaving(false);
      setEditingId(null);
    }, 800);
  };

  // Handlers do modal de reset
  const openResetModal = (a) => {
    setResetTarget(a);
    setResetMode("auto");
    setResetCustomSenha("");
    setResetResult(null);
    setCopied(false);
  };
  const closeResetModal = () => {
    setResetTarget(null);
    setResetCustomSenha("");
    setResetResult(null);
    setResetLoading(false);
    setCopied(false);
  };
  const submitReset = async () => {
    if (!resetTarget || !onResetSenha) return;
    if (
      resetMode === "custom" &&
      (!resetCustomSenha || resetCustomSenha.length < 6)
    ) {
      setResetResult({ error: "A senha precisa ter pelo menos 6 caracteres." });
      return;
    }
    setResetLoading(true);
    setResetResult(null);
    const r = await onResetSenha(
      resetTarget.id,
      resetMode === "custom" ? resetCustomSenha : null,
    );
    setResetLoading(false);
    if (r.success) {
      setResetResult({
        novaSenha: r.novaSenha,
        email: r.email,
        geradaPorSistema: r.geradaPorSistema,
        mensagem: r.mensagem,
      });
    } else {
      setResetResult({ error: r.error });
    }
  };
  const copySenha = () => {
    if (!resetResult?.novaSenha) return;
    try {
      navigator.clipboard.writeText(resetResult.novaSenha);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };
  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Gestão de Associados
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {associadosData.length} associados BRATECC
          </p>
        </div>
        <button
          onClick={() => setPage("novo-associado")}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: `linear-gradient(135deg, ${colors.purple}, ${colors.purple}cc)`,
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          + Novo Associado
        </button>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Total"
          value={associadosData.length}
          color={colors.purple}
        />
        <StatCard
          label="Pequeno porte"
          value={associadosData.filter((a) => a.porte === "Pequeno").length}
          color={colors.cyan}
          delay={0.05}
        />
        <StatCard
          label="Médio porte"
          value={associadosData.filter((a) => a.porte === "Médio").length}
          color={colors.blue}
          delay={0.1}
        />
        <StatCard
          label="Grande porte"
          value={associadosData.filter((a) => a.porte === "Grande").length}
          color={colors.green}
          delay={0.15}
        />
      </div>
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          gap: 16,
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: 2 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 6,
            }}
          >
            Buscar
          </label>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.textMuted,
              }}
            >
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Buscar associado..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{ ...fld, paddingLeft: 38 }}
            />
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              textTransform: "uppercase",
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 6,
            }}
          >
            Segmento
          </label>
          <select
            value={segmentoFilter}
            onChange={(e) => setSegmentoFilter(e.target.value)}
            style={fld}
          >
            <option value="">Todos</option>
            {allSegmentos.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            setSearchTerm("");
            setSegmentoFilter("");
          }}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceLight,
            color: colors.textMuted,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Limpar
        </button>
      </div>
      <div style={{ marginBottom: 16, fontSize: 13, color: colors.textMuted }}>
        Mostrando{" "}
        <span style={{ fontWeight: 700, color: colors.text }}>
          {filtered.length}
        </span>{" "}
        associados
      </div>
      {filtered.length > 0 ? (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${colors.border}`,
                  background: colors.surfaceLight,
                }}
              >
                {["Associado", "Segmento", "Porte", "Contato", "Ações"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        padding: "12px 16px",
                        textAlign:
                          h === "Ações" || h === "Porte" ? "center" : "left",
                        fontSize: 11,
                        color: colors.textMuted,
                        fontWeight: 700,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                      }}
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  style={{
                    borderBottom: `1px solid ${colors.border}`,
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = `${colors.purple}06`)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <td style={{ padding: "14px 16px" }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: colors.purple,
                      }}
                    >
                      {a.nome}
                    </div>
                  </td>
                  <td
                    style={{
                      padding: "14px 16px",
                      fontSize: 13,
                      color: colors.textMuted,
                    }}
                  >
                    {a.segmento}
                  </td>
                  <td
                    style={{
                      padding: "14px 16px",
                      textAlign: "center",
                    }}
                  >
                    {a.porte ? (
                      <span
                        style={{
                          padding: "4px 12px",
                          borderRadius: 20,
                          fontSize: 10,
                          fontWeight: 700,
                          background: `${colors.purple}12`,
                          color: colors.purple,
                        }}
                      >
                        {a.porte}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: colors.textMuted }}>
                        —
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {a.email}
                    </div>
                    {a.whatsapp && (
                      <div
                        style={{
                          fontSize: 11,
                          color: colors.green,
                          marginTop: 2,
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Icons.Phone /> {a.whatsapp}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "14px 16px", textAlign: "center" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      <button
                        onClick={() => openEdit(a)}
                        title="Editar"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          border: `1px solid ${colors.border}`,
                          background: colors.surfaceLight,
                          color: colors.textMuted,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                          fontSize: 14,
                        }}
                      >
                        <IconEdit />
                      </button>
                      <button
                        onClick={() => openResetModal(a)}
                        title="Resetar senha"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          border: `1px solid ${colors.blue}30`,
                          background: `${colors.blue}08`,
                          color: colors.blue,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                          fontSize: 14,
                        }}
                      >
                        <IconKey />
                      </button>
                      <button
                        onClick={() => onDelete && onDelete(a.id)}
                        title="Excluir"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          border: `1px solid ${colors.red}30`,
                          background: `${colors.red}08`,
                          color: colors.red,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 0,
                          fontSize: 14,
                        }}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div
            style={{
              padding: "10px 20px",
              borderTop: `1px solid ${colors.border}`,
              fontSize: 12,
              color: colors.textMuted,
            }}
          >
            {filtered.length} associados
          </div>
        </div>
      ) : (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 60,
            textAlign: "center",
          }}
        >
          <span
            style={{
              display: "flex",
              justifyContent: "center",
              color: colors.textMuted,
              marginBottom: 16,
            }}
          >
            <Icons.User />
          </span>
          <h3
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            Nenhum associado encontrado
          </h3>
        </div>
      )}
      <EditModal
        title="Editar Associado"
        isOpen={!!editingId}
        onClose={cancelEdit}
        onSave={saveEdit}
        saving={saving}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <FormField label="Nome *">
            <input
              value={editForm.nome || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, nome: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="Segmento">
            <select
              value={editForm.segmento || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, segmento: e.target.value })
              }
              style={fld}
            >
              {[
                "Financial Services",
                "Logistics & Supply Chain",
                "Legal & Compliance",
                "Technology & IT",
                "Consulting",
                "Agriculture & Food",
                "Energy",
                "Industry",
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Porte">
            <select
              value={editForm.porte || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, porte: e.target.value })
              }
              style={fld}
            >
              {["Pequeno", "Médio", "Grande"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <FormField label="E-mail">
            <input
              value={editForm.email || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, email: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="Telefone">
            <input
              value={editForm.telefone || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, telefone: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="WhatsApp">
            <input
              value={editForm.whatsapp || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, whatsapp: e.target.value })
              }
              style={fld}
            />
          </FormField>
        </div>
        <div style={{ marginBottom: 20 }}>
          <FormField label="Serviços">
            <textarea
              value={editForm.servicos || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, servicos: e.target.value })
              }
              style={{ ...fld, minHeight: 60, resize: "none" }}
            />
          </FormField>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <FormField label="Produtos Oferecidos" color={colors.green}>
            <textarea
              value={editForm.produtosOferecidos || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, produtosOferecidos: e.target.value })
              }
              style={{ ...fld, minHeight: 80, resize: "none" }}
            />
          </FormField>
          <FormField label="Produtos Demandados" color={colors.blue}>
            <textarea
              value={editForm.produtosDemandados || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, produtosDemandados: e.target.value })
              }
              style={{ ...fld, minHeight: 80, resize: "none" }}
            />
          </FormField>
        </div>
        <FormField label="Descrição">
          <input
            value={editForm.descricao || ""}
            onChange={(e) =>
              setEditForm({ ...editForm, descricao: e.target.value })
            }
            style={fld}
          />
        </FormField>
      </EditModal>

      {/* ─── MODAL DE RESET DE SENHA ─── */}
      {resetTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeResetModal();
          }}
        >
          <div
            style={{
              background: colors.surface,
              borderRadius: 16,
              padding: 28,
              maxWidth: 520,
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: `${colors.blue}15`,
                  color: colors.blue,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconKey />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: colors.text,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  Resetar senha
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: colors.textMuted,
                    marginTop: 2,
                  }}
                >
                  Associado:{" "}
                  <strong style={{ color: colors.text }}>
                    {resetTarget.nome}
                  </strong>
                </p>
              </div>
            </div>

            {!resetResult && (
              <>
                <p
                  style={{
                    fontSize: 13,
                    color: colors.text,
                    marginBottom: 18,
                    lineHeight: 1.5,
                  }}
                >
                  Como você quer fazer?
                </p>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginBottom: 20,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: 14,
                      borderRadius: 10,
                      border: `1px solid ${resetMode === "auto" ? colors.blue : colors.border}`,
                      background:
                        resetMode === "auto"
                          ? `${colors.blue}08`
                          : colors.surface,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="resetMode"
                      checked={resetMode === "auto"}
                      onChange={() => setResetMode("auto")}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: colors.text,
                        }}
                      >
                        Gerar senha temporária
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: colors.textMuted,
                          marginTop: 2,
                        }}
                      >
                        O sistema gera uma senha aleatória. Você repassa pro
                        associado e ele troca no primeiro acesso.
                      </div>
                    </div>
                  </label>

                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: 14,
                      borderRadius: 10,
                      border: `1px solid ${resetMode === "custom" ? colors.blue : colors.border}`,
                      background:
                        resetMode === "custom"
                          ? `${colors.blue}08`
                          : colors.surface,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="resetMode"
                      checked={resetMode === "custom"}
                      onChange={() => setResetMode("custom")}
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: colors.text,
                        }}
                      >
                        Definir senha manualmente
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: colors.textMuted,
                          marginTop: 2,
                          marginBottom: 8,
                        }}
                      >
                        Mínimo 6 caracteres.
                      </div>
                      {resetMode === "custom" && (
                        <input
                          type="text"
                          placeholder="Nova senha"
                          value={resetCustomSenha}
                          onChange={(e) => setResetCustomSenha(e.target.value)}
                          style={{
                            ...fld,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        />
                      )}
                    </div>
                  </label>
                </div>

                {resetResult?.error && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      marginBottom: 14,
                      background: `${colors.red}10`,
                      color: colors.red,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {resetResult.error}
                  </div>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10,
                  }}
                >
                  <button
                    onClick={closeResetModal}
                    disabled={resetLoading}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 10,
                      border: `1px solid ${colors.border}`,
                      background: colors.surfaceLight,
                      color: colors.text,
                      cursor: resetLoading ? "wait" : "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={submitReset}
                    disabled={resetLoading}
                    style={{
                      padding: "10px 22px",
                      borderRadius: 10,
                      border: "none",
                      background: `linear-gradient(135deg, ${colors.blue}, ${colors.blue}cc)`,
                      color: "#fff",
                      cursor: resetLoading ? "wait" : "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {resetLoading ? "Resetando..." : "Resetar"}
                  </button>
                </div>
              </>
            )}

            {resetResult?.novaSenha && (
              <>
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: `${colors.green}10`,
                    border: `1px solid ${colors.green}30`,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: colors.green,
                      marginBottom: 4,
                    }}
                  >
                    Senha resetada com sucesso
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {resetResult.mensagem}
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    E-mail (login)
                  </div>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: colors.surfaceLight,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      color: colors.text,
                    }}
                  >
                    {resetResult.email || "—"}
                  </div>
                </div>

                <div style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    Nova senha{" "}
                    {resetResult.geradaPorSistema
                      ? "(gerada automaticamente)"
                      : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div
                      style={{
                        flex: 1,
                        padding: "12px 14px",
                        borderRadius: 8,
                        background: `${colors.purple}10`,
                        border: `1px solid ${colors.purple}30`,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 16,
                        fontWeight: 700,
                        color: colors.purple,
                        letterSpacing: 1,
                      }}
                    >
                      {resetResult.novaSenha}
                    </div>
                    <button
                      onClick={copySenha}
                      style={{
                        padding: "0 16px",
                        borderRadius: 8,
                        border: "none",
                        background: copied ? colors.green : colors.surfaceLight,
                        color: copied ? "#fff" : colors.text,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {copied ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: colors.textMuted,
                      marginTop: 6,
                      fontStyle: "italic",
                    }}
                  >
                    Esta senha não será exibida novamente. Anote ou copie agora.
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={closeResetModal}
                    style={{
                      padding: "10px 22px",
                      borderRadius: 10,
                      border: "none",
                      background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Fechar
                  </button>
                </div>
              </>
            )}

            {resetResult?.error && !resetResult?.novaSenha && (
              <>
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: `${colors.red}10`,
                    border: `1px solid ${colors.red}30`,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: colors.red,
                      marginBottom: 4,
                    }}
                  >
                    Falha ao resetar
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {resetResult.error}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10,
                  }}
                >
                  <button
                    onClick={() => setResetResult(null)}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 10,
                      border: `1px solid ${colors.border}`,
                      background: colors.surfaceLight,
                      color: colors.text,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Tentar de novo
                  </button>
                  <button
                    onClick={closeResetModal}
                    style={{
                      padding: "10px 22px",
                      borderRadius: 10,
                      border: "none",
                      background: colors.surfaceLight,
                      color: colors.text,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Fechar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CADASTROS (EMPRESA / ASSOCIADO)
// ═══════════════════════════════════════════════════════════════
// As duas páginas seguem o mesmo padrão:
//   • Modo manual ou importação CSV
//   • Wizard de 3 passos: Dados gerais → Catálogo → Revisão
//   • Produtos/serviços oferecidos e demandados apenas via ItemsManager
//     (removidos os textareas livres)
//   • Componentes compartilhados: WizardStepper, FormSection, Field,
//     InputText, SelectField, TextareaField, ModeSwitch, WizardNav
// ═══════════════════════════════════════════════════════════════

// ─── Listas compartilhadas entre os cadastros ───
const SEGMENTOS_OPCOES = [
  "Energia",
  "Tecnologia",
  "Logística & Transporte",
  "Alimentos & Bebidas",
  "Serviços Financeiros",
  "Jurídico & Compliance",
  "Agricultura & Agronegócio",
  "Manufatura & Indústria",
  "Saúde & Farmacêutico",
  "Construção Civil",
  "Varejo & Comércio",
  "Mineração",
  "Automotivo",
  "Aeroespacial",
  "Químico & Petroquímico",
  "Têxtil & Vestuário",
  "Consultoria",
  "Marketing & Comunicação",
  "RH & Recrutamento",
  "Outros Serviços",
];

const PORTES_OPCOES = [
  { value: "MEI", label: "MEI — Microempreendedor Individual" },
  { value: "Micro", label: "Micro — até R$ 360 mil/ano" },
  { value: "Pequeno", label: "Pequeno — até R$ 4,8 mi/ano" },
  { value: "Médio", label: "Médio — até R$ 300 mi/ano" },
  { value: "Grande", label: "Grande — acima de R$ 300 mi/ano" },
];

const PAISES_OPCOES = [
  "Brasil",
  "Estados Unidos",
  "México",
  "Argentina",
  "Chile",
  "Colômbia",
  "Peru",
  "Outro",
];

const ESTADOS_BR = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];
const ESTADOS_USA = [
  "TX",
  "CA",
  "FL",
  "NY",
  "IL",
  "PA",
  "OH",
  "GA",
  "NC",
  "MI",
  "NJ",
  "VA",
  "WA",
  "AZ",
  "MA",
  "TN",
  "IN",
  "MO",
  "MD",
  "WI",
  "CO",
  "MN",
  "SC",
  "AL",
  "LA",
  "KY",
  "OR",
  "OK",
  "CT",
  "UT",
  "IA",
  "NV",
  "AR",
  "MS",
  "KS",
  "NM",
  "NE",
  "ID",
  "WV",
  "HI",
  "NH",
  "ME",
  "MT",
  "RI",
  "DE",
  "SD",
  "ND",
  "AK",
  "VT",
  "WY",
  "DC",
];

const WIZARD_STEPS = [
  { label: "Dados gerais", hint: "Identificação e contato" },
  { label: "Catálogo", hint: "Produtos / serviços" },
  { label: "Revisão", hint: "Conferir e salvar" },
];

// ─── Helper: bloco de revisão (Step 3) ───
function ReviewBlock({ title, fields, icon }) {
  return (
    <FormSection title={title} icon={icon}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "12px 24px",
        }}
      >
        {fields.map((f, i) => (
          <div
            key={i}
            style={{ minWidth: 0, gridColumn: f.full ? "1 / -1" : "auto" }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: colors.textMuted,
                textTransform: "uppercase",
                letterSpacing: 0.8,
                marginBottom: 4,
              }}
            >
              {f.label}
            </div>
            <div
              style={{
                fontSize: 13,
                color: colors.text,
                wordWrap: "break-word",
              }}
            >
              {f.value || (
                <span style={{ color: colors.textMuted, fontStyle: "italic" }}>
                  —
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </FormSection>
  );
}

// ═══════════════════════════════
// ─── NOVA EMPRESA FORM PAGE ───
// ═══════════════════════════════
function NovaEmpresaPage({ setPage, onAdd, associados }) {
  const [mode, setMode] = useState("manual");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    nome: "",
    segmento: "",
    cnae: "",
    naics: "",
    porte: "Médio",
    tipo: "Exportador",
    cidade: "",
    estado: "",
    pais: "Brasil",
    regiaoAtuacao: "",
    email: "",
    telefone: "",
    palavrasChave: "",
    ncmCodes: "",
    hsCode: "",
    descricao: "",
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState(null);

  const [itemsOferecidos, setItemsOferecidos] = useState([]);
  const [itemsDemandados, setItemsDemandados] = useState([]);

  // Import CSV state
  const [importData, setImportData] = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef(null);

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field])
      setErrors((prev) => {
        const n = { ...prev };
        delete n[field];
        return n;
      });
  };

  // Validações por step
  const validateStep1 = () => {
    const e = {};
    if (!form.nome.trim()) e.nome = "Nome é obrigatório";
    if (!form.segmento) e.segmento = "Selecione o segmento";
    if (!form.porte) e.porte = "Selecione o porte";
    if (!form.tipo) e.tipo = "Selecione o tipo";
    if (!form.cidade.trim()) e.cidade = "Cidade é obrigatória";
    if (!form.estado) e.estado = "Estado é obrigatório";
    if (!form.email.trim()) e.email = "E-mail é obrigatório";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = "E-mail inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    // Catálogo é opcional mas encorajamos pelo menos 1 item oferecido
    const e = {};
    // Sem obrigatoriedade por enquanto — apenas warning visual se vazio
    setErrors(e);
    return true;
  };

  const handleNext = () => {
    setServerError(null);
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    setServerError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const handleSave = async () => {
    setServerError(null);
    setSaving(true);
    try {
      const payload = {
        ...form,
        items: [...itemsOferecidos, ...itemsDemandados],
        desc: form.descricao,
      };
      if (onAdd) await onAdd(payload);
      setSaved(true);
    } catch (err) {
      setServerError(err?.message || "Erro ao salvar empresa");
    } finally {
      setSaving(false);
    }
  };

  // ─── Import CSV ───
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErrors([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target.result;
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) {
          setImportErrors(["CSV vazio ou sem dados"]);
          return;
        }
        const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const rows = lines.slice(1).map((line, idx) => {
          const cols = line.split(",").map((c) => c.trim());
          const row = {};
          headers.forEach((h, i) => {
            row[h] = cols[i] || "";
          });
          return { _line: idx + 2, ...row };
        });
        const erros = [];
        const validos = [];
        rows.forEach((r) => {
          if (!r.nome) {
            erros.push(`Linha ${r._line}: nome ausente`);
            return;
          }
          if (!r.email) {
            erros.push(`Linha ${r._line}: email ausente`);
            return;
          }
          validos.push({
            nome: r.nome,
            segmento: r.segmento || r.setor || "",
            porte: r.porte || "Médio",
            tipo: r.tipo || "Exportador",
            cidade: r.cidade || "",
            estado: r.estado || "",
            pais: r.pais || "Brasil",
            email: r.email,
            telefone: r.telefone || "",
            descricao: r.descricao || "",
          });
        });
        setImportErrors(erros);
        setImportData(validos);
      } catch (err) {
        setImportErrors([`Erro ao processar CSV: ${err.message}`]);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setImporting(true);
    setImportedCount(0);
    for (let i = 0; i < importData.length; i++) {
      try {
        if (onAdd) await onAdd(importData[i]);
        setImportedCount((c) => c + 1);
      } catch {
        // continua com os outros
      }
    }
    setImporting(false);
    setImportComplete(true);
  };

  // ─── Tela de sucesso ───
  if (saved) {
    return (
      <div style={{ padding: 28 }}>
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.green}30`,
            borderRadius: 16,
            padding: 40,
            textAlign: "center",
            maxWidth: 640,
            margin: "40px auto",
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            Empresa cadastrada!
          </h2>
          <p
            style={{ fontSize: 14, color: colors.textMuted, marginBottom: 28 }}
          >
            <strong style={{ color: colors.text }}>{form.nome}</strong> foi
            adicionada. A IA está gerando matches automaticamente.
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => setPage("gestao-empresa")}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                border: "none",
                background: `linear-gradient(135deg, ${colors.blue}, ${colors.purple})`,
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Ver todas as empresas →
            </button>
            <button
              onClick={() => {
                setForm({
                  nome: "",
                  segmento: "",
                  cnae: "",
                  naics: "",
                  porte: "Médio",
                  tipo: "Exportador",
                  cidade: "",
                  estado: "",
                  pais: "Brasil",
                  regiaoAtuacao: "",
                  email: "",
                  telefone: "",
                  palavrasChave: "",
                  ncmCodes: "",
                  hsCode: "",
                  descricao: "",
                });
                setItemsOferecidos([]);
                setItemsDemandados([]);
                setStep(1);
                setSaved(false);
              }}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              + Cadastrar outra
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Modo importação ───
  if (mode === "import") {
    return (
      <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: colors.text,
                marginBottom: 6,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              Cadastro de Empresas
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted }}>
              Importe múltiplas empresas via arquivo CSV
            </p>
          </div>
          <ModeSwitch
            mode={mode}
            onChange={setMode}
            options={[
              { value: "manual", label: "Manual", icon: "✍️" },
              { value: "import", label: "Importar CSV", icon: "📥" },
            ]}
          />
        </div>

        <FormSection
          title="Importar empresas"
          description="O CSV deve conter as colunas: nome, email, segmento, porte, tipo, cidade, estado, pais, telefone, descricao"
          icon="📥"
        >
          {!importComplete ? (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".csv"
                style={{ display: "none" }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: "14px 28px",
                  borderRadius: 10,
                  border: `2px dashed ${colors.blue}40`,
                  background: `${colors.blue}05`,
                  color: colors.blue,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  width: "100%",
                }}
              >
                📁{" "}
                {importData.length > 0
                  ? `${importData.length} empresas prontas — trocar arquivo`
                  : "Clique para selecionar arquivo CSV"}
              </button>

              {importErrors.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    background: `${colors.orange}10`,
                    borderRadius: 8,
                    border: `1px solid ${colors.orange}30`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: colors.orange,
                      marginBottom: 6,
                    }}
                  >
                    {importErrors.length} aviso(s):
                  </div>
                  {importErrors.slice(0, 5).map((e, i) => (
                    <div
                      key={i}
                      style={{ fontSize: 11, color: colors.textMuted }}
                    >
                      {e}
                    </div>
                  ))}
                </div>
              )}

              {importData.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={importing}
                  style={{
                    marginTop: 14,
                    padding: "12px 28px",
                    borderRadius: 10,
                    border: "none",
                    background: importing
                      ? colors.surfaceLight
                      : `linear-gradient(135deg, ${colors.green}, ${colors.cyan})`,
                    color: importing ? colors.textMuted : "#fff",
                    cursor: importing ? "wait" : "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {importing
                    ? `Importando ${importedCount}/${importData.length}...`
                    : `✓ Importar ${importData.length} empresa(s)`}
                </button>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>🎉</div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: colors.green,
                  marginBottom: 6,
                }}
              >
                {importedCount} empresa(s) importada(s)!
              </div>
              <button
                onClick={() => {
                  setImportComplete(false);
                  setImportData([]);
                  setImportedCount(0);
                }}
                style={{
                  marginTop: 14,
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: `1px solid ${colors.border}`,
                  background: colors.surface,
                  color: colors.text,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Importar outro arquivo
              </button>
            </div>
          )}
        </FormSection>
      </div>
    );
  }

  // ─── Modo manual: wizard 3 steps ───
  const totalItems = itemsOferecidos.length + itemsDemandados.length;
  const estadosDisponiveis =
    form.pais === "Brasil"
      ? ESTADOS_BR
      : form.pais === "Estados Unidos"
        ? ESTADOS_USA
        : [];

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Cadastro de Empresas
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            Empresas importadoras ou exportadoras que participam do ecossistema
          </p>
        </div>
        <ModeSwitch
          mode={mode}
          onChange={setMode}
          options={[
            { value: "manual", label: "Manual", icon: "✍️" },
            { value: "import", label: "Importar CSV", icon: "📥" },
          ]}
        />
      </div>

      <WizardStepper steps={WIZARD_STEPS} current={step} />

      {serverError && (
        <div
          style={{
            background: `${colors.red}10`,
            border: `1px solid ${colors.red}30`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 13, color: colors.red, flex: 1 }}>
            {serverError}
          </span>
        </div>
      )}

      {/* STEP 1: Dados gerais */}
      {step === 1 && (
        <>
          <FormSection
            title="Identificação"
            icon="🏢"
            description="Informações básicas da empresa"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 14,
              }}
            >
              <Field
                label="Nome da empresa"
                required
                error={errors.nome}
                span={8}
              >
                <InputText
                  value={form.nome}
                  onChange={(v) => update("nome", v)}
                  placeholder="Ex: Texas Energy Solutions"
                  error={errors.nome}
                />
              </Field>
              <Field label="Porte" required error={errors.porte} span={4}>
                <SelectField
                  value={form.porte}
                  onChange={(v) => update("porte", v)}
                  options={PORTES_OPCOES}
                  placeholder="Selecione..."
                  error={errors.porte}
                />
              </Field>
              <Field label="Segmento" required error={errors.segmento} span={6}>
                <SelectField
                  value={form.segmento}
                  onChange={(v) => update("segmento", v)}
                  options={SEGMENTOS_OPCOES}
                  placeholder="Selecione o segmento..."
                  error={errors.segmento}
                />
              </Field>
              <Field
                label="Tipo de operação"
                required
                error={errors.tipo}
                span={6}
              >
                <SelectField
                  value={form.tipo}
                  onChange={(v) => update("tipo", v)}
                  options={[
                    { value: "Exportador", label: "Exportador" },
                    { value: "Importador", label: "Importador" },
                    {
                      value: "Ambos",
                      label: "Ambos (Exportador e Importador)",
                    },
                  ]}
                  error={errors.tipo}
                />
              </Field>
              <Field label="CNAE (Brasil)" span={6} hint="Opcional">
                <InputText
                  value={form.cnae}
                  onChange={(v) => update("cnae", v)}
                  placeholder="Ex: 35.11-5/01"
                />
              </Field>
              <Field label="NAICS (EUA)" span={6} hint="Opcional">
                <InputText
                  value={form.naics}
                  onChange={(v) => update("naics", v)}
                  placeholder="Ex: 221111"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Localização" icon="📍">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 14,
              }}
            >
              <Field label="País" span={4}>
                <SelectField
                  value={form.pais}
                  onChange={(v) => {
                    update("pais", v);
                    update("estado", "");
                  }}
                  options={PAISES_OPCOES}
                />
              </Field>
              <Field label="Cidade" required error={errors.cidade} span={5}>
                <InputText
                  value={form.cidade}
                  onChange={(v) => update("cidade", v)}
                  placeholder="Ex: Houston"
                  error={errors.cidade}
                />
              </Field>
              <Field label="Estado" required error={errors.estado} span={3}>
                {estadosDisponiveis.length > 0 ? (
                  <SelectField
                    value={form.estado}
                    onChange={(v) => update("estado", v)}
                    options={estadosDisponiveis}
                    placeholder="UF"
                    error={errors.estado}
                  />
                ) : (
                  <InputText
                    value={form.estado}
                    onChange={(v) => update("estado", v)}
                    placeholder="Estado/Provincia"
                    error={errors.estado}
                  />
                )}
              </Field>
              <Field
                label="Região de atuação"
                span={12}
                hint="Ex: Todo o Brasil, Região Sul, Texas + Louisiana"
              >
                <InputText
                  value={form.regiaoAtuacao}
                  onChange={(v) => update("regiaoAtuacao", v)}
                  placeholder="Área geográfica atendida"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Contato" icon="📞">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: 14,
              }}
            >
              <Field label="E-mail" required error={errors.email}>
                <InputText
                  type="email"
                  value={form.email}
                  onChange={(v) => update("email", v)}
                  placeholder="contato@empresa.com"
                  error={errors.email}
                />
              </Field>
              <Field label="Telefone">
                <InputText
                  value={form.telefone}
                  onChange={(v) => update("telefone", v)}
                  placeholder="+55 11 98765-4321"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Descrição"
            icon="📝"
            description="Opcional — ajuda a IA a entender melhor o negócio"
          >
            <Field>
              <TextareaField
                value={form.descricao}
                onChange={(v) => update("descricao", v)}
                placeholder="Breve descrição da empresa, seu modelo de negócio e diferenciais..."
                rows={3}
              />
            </Field>
          </FormSection>

          <WizardNav
            step={step}
            totalSteps={3}
            onBack={handleBack}
            onNext={handleNext}
          />
        </>
      )}

      {/* STEP 2: Catálogo */}
      {step === 2 && (
        <>
          <FormSection
            title="Catálogo de produtos e serviços"
            icon="📦"
            description="Cadastre cada item individualmente. O código NCM é opcional mas aumenta a precisão dos matches."
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
                gap: 14,
              }}
            >
              <ItemsManager
                items={itemsOferecidos}
                onChange={setItemsOferecidos}
                tipo="OFERECIDO"
                label="📤 Produtos / serviços OFERECIDOS"
                accentColor={colors.green}
                placeholder="Ex: Painéis solares 400W"
              />
              <ItemsManager
                items={itemsDemandados}
                onChange={setItemsDemandados}
                tipo="DEMANDADO"
                label="📥 Produtos / serviços DEMANDADOS"
                accentColor={colors.orange}
                placeholder="Ex: Trade finance"
              />
            </div>

            {totalItems === 0 && (
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  background: `${colors.orange}08`,
                  border: `1px dashed ${colors.orange}40`,
                  borderRadius: 8,
                  fontSize: 12,
                  color: colors.textMuted,
                }}
              >
                💡 Sem itens no catálogo, os matches serão menos precisos.
                Recomendamos cadastrar pelo menos 1 item oferecido.
              </div>
            )}
          </FormSection>

          <WizardNav
            step={step}
            totalSteps={3}
            onBack={handleBack}
            onNext={handleNext}
          />
        </>
      )}

      {/* STEP 3: Revisão */}
      {step === 3 && (
        <>
          <ReviewBlock
            title="Identificação"
            icon="🏢"
            fields={[
              { label: "Nome", value: form.nome, full: true },
              { label: "Segmento", value: form.segmento },
              {
                label: "Porte",
                value: PORTES_OPCOES.find((p) => p.value === form.porte)?.label,
              },
              { label: "Tipo de operação", value: form.tipo },
              {
                label: "CNAE / NAICS",
                value: [form.cnae, form.naics].filter(Boolean).join(" / "),
              },
            ]}
          />

          <ReviewBlock
            title="Localização"
            icon="📍"
            fields={[
              { label: "País", value: form.pais },
              {
                label: "Cidade / Estado",
                value: [form.cidade, form.estado].filter(Boolean).join(", "),
              },
              {
                label: "Região de atuação",
                value: form.regiaoAtuacao,
                full: true,
              },
            ]}
          />

          <ReviewBlock
            title="Contato"
            icon="📞"
            fields={[
              { label: "E-mail", value: form.email },
              { label: "Telefone", value: form.telefone },
            ]}
          />

          {form.descricao && (
            <ReviewBlock
              title="Descrição"
              icon="📝"
              fields={[{ label: "", value: form.descricao, full: true }]}
            />
          )}

          <FormSection
            title="Catálogo"
            icon="📦"
            description={`${totalItems} item(s) cadastrado(s)`}
          >
            {totalItems === 0 ? (
              <div
                style={{
                  fontSize: 13,
                  color: colors.textMuted,
                  fontStyle: "italic",
                }}
              >
                Nenhum item cadastrado
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.green,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    Oferecidos ({itemsOferecidos.length})
                  </div>
                  {itemsOferecidos.map((it, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 12,
                        color: colors.text,
                        marginBottom: 3,
                      }}
                    >
                      • {it.nome}{" "}
                      {it.ncmCodigo && (
                        <span
                          style={{
                            color: colors.textMuted,
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                          }}
                        >
                          (NCM {it.ncmCodigo})
                        </span>
                      )}
                    </div>
                  ))}
                  {itemsOferecidos.length === 0 && (
                    <div
                      style={{
                        fontSize: 12,
                        color: colors.textMuted,
                        fontStyle: "italic",
                      }}
                    >
                      —
                    </div>
                  )}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.orange,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    Demandados ({itemsDemandados.length})
                  </div>
                  {itemsDemandados.map((it, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 12,
                        color: colors.text,
                        marginBottom: 3,
                      }}
                    >
                      • {it.nome}{" "}
                      {it.ncmCodigo && (
                        <span
                          style={{
                            color: colors.textMuted,
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                          }}
                        >
                          (NCM {it.ncmCodigo})
                        </span>
                      )}
                    </div>
                  ))}
                  {itemsDemandados.length === 0 && (
                    <div
                      style={{
                        fontSize: 12,
                        color: colors.textMuted,
                        fontStyle: "italic",
                      }}
                    >
                      —
                    </div>
                  )}
                </div>
              </div>
            )}
          </FormSection>

          <WizardNav
            step={step}
            totalSteps={3}
            onBack={handleBack}
            onSave={handleSave}
            saving={saving}
            saveLabel="Cadastrar empresa"
          />
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════
// ─── NOVO ASSOCIADO FORM PAGE ───
// ══════════════════════════════════
function NovoAssociadoPage({ setPage, onAdd, empresas }) {
  const [mode, setMode] = useState("manual");
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    nome: "",
    tipoPessoa: "JURIDICA",
    segmento: "",
    porte: "Médio",
    email: "",
    telefone: "",
    whatsapp: "",
    descricao: "",
    criarAcesso: true,
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [serverError, setServerError] = useState(null);

  const [itemsOferecidos, setItemsOferecidos] = useState([]);
  const [itemsDemandados, setItemsDemandados] = useState([]);

  // Import CSV state
  const [importData, setImportData] = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef(null);

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field])
      setErrors((prev) => {
        const n = { ...prev };
        delete n[field];
        return n;
      });
  };

  // Geração de senha
  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const specials = "@#$%&*!";
    let pw = "";
    for (let i = 0; i < 8; i++)
      pw += chars[Math.floor(Math.random() * chars.length)];
    pw += specials[Math.floor(Math.random() * specials.length)];
    return pw;
  };

  const validateStep1 = () => {
    const e = {};
    if (!form.nome.trim()) e.nome = "Nome é obrigatório";
    if (!form.segmento) e.segmento = "Selecione o segmento";
    if (!form.porte) e.porte = "Selecione o porte";
    if (!form.email.trim()) e.email = "E-mail é obrigatório";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = "E-mail inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    setServerError(null);
    if (step === 1 && !validateStep1()) return;
    setStep((s) => s + 1);
  };
  const handleBack = () => {
    setServerError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const handleSave = async () => {
    setServerError(null);
    setSaving(true);
    try {
      const senha = form.criarAcesso ? generatePassword() : null;
      setGeneratedPassword(senha || "");
      const payload = {
        nome: form.nome,
        tipoPessoa: form.tipoPessoa,
        segmento: form.segmento,
        porte: form.porte,
        email: form.email,
        telefone: form.telefone,
        whatsapp: form.whatsapp,
        descricao: form.descricao,
        criarUsuario: !!form.criarAcesso,
        senha,
        ativo: true,
        items: [...itemsOferecidos, ...itemsDemandados],
      };
      if (onAdd) await onAdd(payload);
      setSaved(true);
    } catch (err) {
      setServerError(err?.message || "Erro ao salvar associado");
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportErrors([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const lines = ev.target.result.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) {
          setImportErrors(["CSV vazio"]);
          return;
        }
        const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
        const rows = lines.slice(1).map((line, idx) => {
          const cols = line.split(",").map((c) => c.trim());
          const row = {};
          headers.forEach((h, i) => {
            row[h] = cols[i] || "";
          });
          return { _line: idx + 2, ...row };
        });
        const erros = [];
        const validos = [];
        rows.forEach((r) => {
          if (!r.nome) {
            erros.push(`Linha ${r._line}: nome ausente`);
            return;
          }
          if (!r.email) {
            erros.push(`Linha ${r._line}: email ausente`);
            return;
          }
          validos.push({
            nome: r.nome,
            tipoPessoa: (r.tipopessoa || "JURIDICA").toUpperCase(),
            segmento: r.segmento || "",
            porte: r.porte || "Médio",
            email: r.email,
            telefone: r.telefone || "",
            whatsapp: r.whatsapp || "",
            descricao: r.descricao || "",
            criarUsuario: true,
            senha: generatePassword(),
            ativo: true,
          });
        });
        setImportErrors(erros);
        setImportData(validos);
      } catch (err) {
        setImportErrors([`Erro ao processar CSV: ${err.message}`]);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setImporting(true);
    setImportedCount(0);
    for (const assoc of importData) {
      try {
        if (onAdd) await onAdd(assoc);
        setImportedCount((c) => c + 1);
      } catch {
        // continua
      }
    }
    setImporting(false);
    setImportComplete(true);
  };

  // ─── Tela de sucesso ───
  if (saved) {
    return (
      <div style={{ padding: 28 }}>
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.green}30`,
            borderRadius: 16,
            padding: 40,
            textAlign: "center",
            maxWidth: 640,
            margin: "40px auto",
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            Associado cadastrado!
          </h2>
          <p
            style={{ fontSize: 14, color: colors.textMuted, marginBottom: 20 }}
          >
            <strong style={{ color: colors.text }}>{form.nome}</strong> foi
            adicionado.
          </p>

          {generatedPassword && (
            <div
              style={{
                background: `${colors.blue}08`,
                border: `1px solid ${colors.blue}30`,
                borderRadius: 10,
                padding: 16,
                marginBottom: 24,
                textAlign: "left",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors.blue,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  marginBottom: 6,
                }}
              >
                🔐 Credenciais de acesso
              </div>
              <div
                style={{ fontSize: 13, color: colors.text, marginBottom: 4 }}
              >
                <strong>E-mail:</strong> {form.email}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: colors.text,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                <strong style={{ fontFamily: "'Segoe UI', sans-serif" }}>
                  Senha:
                </strong>{" "}
                {generatedPassword}
              </div>
              <div style={{ fontSize: 11, color: colors.orange, marginTop: 8 }}>
                ⚠️ Anote ou envie ao associado — esta senha não será exibida
                novamente
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => setPage("gestao-associados")}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                border: "none",
                background: `linear-gradient(135deg, ${colors.blue}, ${colors.purple})`,
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Ver todos os associados →
            </button>
            <button
              onClick={() => {
                setForm({
                  nome: "",
                  tipoPessoa: "JURIDICA",
                  segmento: "",
                  porte: "Médio",
                  email: "",
                  telefone: "",
                  whatsapp: "",
                  descricao: "",
                  criarAcesso: true,
                });
                setItemsOferecidos([]);
                setItemsDemandados([]);
                setStep(1);
                setSaved(false);
                setGeneratedPassword("");
              }}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              + Cadastrar outro
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Modo importação ───
  if (mode === "import") {
    return (
      <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: colors.text,
                marginBottom: 6,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              Cadastro de Associados
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted }}>
              Importe múltiplos associados via CSV
            </p>
          </div>
          <ModeSwitch
            mode={mode}
            onChange={setMode}
            options={[
              { value: "manual", label: "Manual", icon: "✍️" },
              { value: "import", label: "Importar CSV", icon: "📥" },
            ]}
          />
        </div>

        <FormSection
          title="Importar associados"
          description="CSV com colunas: nome, email, tipopessoa (FISICA/JURIDICA), segmento, porte, telefone, whatsapp, descricao"
          icon="📥"
        >
          {!importComplete ? (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".csv"
                style={{ display: "none" }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: "14px 28px",
                  borderRadius: 10,
                  border: `2px dashed ${colors.blue}40`,
                  background: `${colors.blue}05`,
                  color: colors.blue,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  width: "100%",
                }}
              >
                📁{" "}
                {importData.length > 0
                  ? `${importData.length} associados prontos — trocar arquivo`
                  : "Clique para selecionar arquivo CSV"}
              </button>

              {importErrors.length > 0 && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    background: `${colors.orange}10`,
                    borderRadius: 8,
                    border: `1px solid ${colors.orange}30`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: colors.orange,
                      marginBottom: 6,
                    }}
                  >
                    {importErrors.length} aviso(s):
                  </div>
                  {importErrors.slice(0, 5).map((e, i) => (
                    <div
                      key={i}
                      style={{ fontSize: 11, color: colors.textMuted }}
                    >
                      {e}
                    </div>
                  ))}
                </div>
              )}

              {importData.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={importing}
                  style={{
                    marginTop: 14,
                    padding: "12px 28px",
                    borderRadius: 10,
                    border: "none",
                    background: importing
                      ? colors.surfaceLight
                      : `linear-gradient(135deg, ${colors.green}, ${colors.cyan})`,
                    color: importing ? colors.textMuted : "#fff",
                    cursor: importing ? "wait" : "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {importing
                    ? `Importando ${importedCount}/${importData.length}...`
                    : `✓ Importar ${importData.length} associado(s)`}
                </button>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 10 }}>🎉</div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: colors.green,
                  marginBottom: 6,
                }}
              >
                {importedCount} associado(s) importado(s)!
              </div>
              <button
                onClick={() => {
                  setImportComplete(false);
                  setImportData([]);
                  setImportedCount(0);
                }}
                style={{
                  marginTop: 14,
                  padding: "10px 20px",
                  borderRadius: 8,
                  border: `1px solid ${colors.border}`,
                  background: colors.surface,
                  color: colors.text,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Importar outro arquivo
              </button>
            </div>
          )}
        </FormSection>
      </div>
    );
  }

  // ─── Modo manual: wizard 3 steps ───
  const totalItems = itemsOferecidos.length + itemsDemandados.length;

  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Cadastro de Associados
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            Pessoas ou empresas parceiras da BRATECC que oferecem serviços
            especializados
          </p>
        </div>
        <ModeSwitch
          mode={mode}
          onChange={setMode}
          options={[
            { value: "manual", label: "Manual", icon: "✍️" },
            { value: "import", label: "Importar CSV", icon: "📥" },
          ]}
        />
      </div>

      <WizardStepper steps={WIZARD_STEPS} current={step} />

      {serverError && (
        <div
          style={{
            background: `${colors.red}10`,
            border: `1px solid ${colors.red}30`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 13, color: colors.red, flex: 1 }}>
            {serverError}
          </span>
        </div>
      )}

      {/* STEP 1: Dados gerais */}
      {step === 1 && (
        <>
          <FormSection
            title="Identificação"
            icon="👥"
            description="Informações básicas do associado"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 14,
              }}
            >
              <Field label="Tipo de associado" span={4}>
                <SelectField
                  value={form.tipoPessoa}
                  onChange={(v) => update("tipoPessoa", v)}
                  options={[
                    { value: "JURIDICA", label: "Pessoa Jurídica (empresa)" },
                    { value: "FISICA", label: "Pessoa Física" },
                  ]}
                />
              </Field>
              <Field
                label={
                  form.tipoPessoa === "FISICA"
                    ? "Nome completo"
                    : "Nome da empresa"
                }
                required
                error={errors.nome}
                span={8}
              >
                <InputText
                  value={form.nome}
                  onChange={(v) => update("nome", v)}
                  placeholder={
                    form.tipoPessoa === "FISICA"
                      ? "Ex: João da Silva"
                      : "Ex: FinTech Brasil Ltda"
                  }
                  error={errors.nome}
                />
              </Field>
              <Field
                label="Segmento de atuação"
                required
                error={errors.segmento}
                span={8}
              >
                <SelectField
                  value={form.segmento}
                  onChange={(v) => update("segmento", v)}
                  options={SEGMENTOS_OPCOES}
                  placeholder="Selecione..."
                  error={errors.segmento}
                />
              </Field>
              <Field label="Porte" required error={errors.porte} span={4}>
                <SelectField
                  value={form.porte}
                  onChange={(v) => update("porte", v)}
                  options={PORTES_OPCOES}
                  placeholder="Selecione..."
                  error={errors.porte}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Contato" icon="📞">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 14,
              }}
            >
              <Field
                label="E-mail"
                required
                error={errors.email}
                span={6}
                hint="Também usado como login no portal"
              >
                <InputText
                  type="email"
                  value={form.email}
                  onChange={(v) => update("email", v)}
                  placeholder="contato@associado.com"
                  error={errors.email}
                />
              </Field>
              <Field
                label="WhatsApp"
                span={3}
                hint="Para envio de matches via HSM"
              >
                <InputText
                  value={form.whatsapp}
                  onChange={(v) => update("whatsapp", v)}
                  placeholder="+55 11 98765-4321"
                />
              </Field>
              <Field label="Telefone" span={3}>
                <InputText
                  value={form.telefone}
                  onChange={(v) => update("telefone", v)}
                  placeholder="Opcional"
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Acesso ao portal"
            icon="🔐"
            description="Defina se o associado terá credenciais para acessar o sistema"
          >
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                padding: 12,
                background: form.criarAcesso
                  ? `${colors.blue}08`
                  : colors.surfaceLight,
                border: `1px solid ${form.criarAcesso ? colors.blue + "40" : colors.border}`,
                borderRadius: 10,
                transition: "all 0.15s",
              }}
            >
              <input
                type="checkbox"
                checked={form.criarAcesso}
                onChange={(e) => update("criarAcesso", e.target.checked)}
                style={{
                  width: 16,
                  height: 16,
                  cursor: "pointer",
                  accentColor: colors.blue,
                }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: colors.text }}
                >
                  Criar acesso ao portal
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: colors.textMuted,
                    marginTop: 2,
                  }}
                >
                  Gera uma senha aleatória que será exibida após o cadastro
                </div>
              </div>
            </label>
          </FormSection>

          <FormSection title="Descrição" icon="📝" description="Opcional">
            <Field>
              <TextareaField
                value={form.descricao}
                onChange={(v) => update("descricao", v)}
                placeholder="Breve descrição do associado, sua área de atuação e diferenciais..."
                rows={3}
              />
            </Field>
          </FormSection>

          <WizardNav
            step={step}
            totalSteps={3}
            onBack={handleBack}
            onNext={handleNext}
          />
        </>
      )}

      {/* STEP 2: Catálogo */}
      {step === 2 && (
        <>
          <FormSection
            title="Catálogo de produtos e serviços"
            icon="📦"
            description="Cadastre cada item individualmente. O código NCM é opcional mas aumenta a precisão dos matches."
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
                gap: 14,
              }}
            >
              <ItemsManager
                items={itemsOferecidos}
                onChange={setItemsOferecidos}
                tipo="OFERECIDO"
                label="📤 Produtos / serviços OFERECIDOS"
                accentColor={colors.green}
                placeholder="Ex: Trade Finance Solutions"
              />
              <ItemsManager
                items={itemsDemandados}
                onChange={setItemsDemandados}
                tipo="DEMANDADO"
                label="📥 Produtos / serviços DEMANDADOS"
                accentColor={colors.orange}
                placeholder="Ex: Empresas exportadoras"
              />
            </div>

            {totalItems === 0 && (
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  background: `${colors.orange}08`,
                  border: `1px dashed ${colors.orange}40`,
                  borderRadius: 8,
                  fontSize: 12,
                  color: colors.textMuted,
                }}
              >
                💡 Sem itens no catálogo, os matches serão menos precisos.
                Recomendamos cadastrar pelo menos 1 item oferecido.
              </div>
            )}
          </FormSection>

          <WizardNav
            step={step}
            totalSteps={3}
            onBack={handleBack}
            onNext={handleNext}
          />
        </>
      )}

      {/* STEP 3: Revisão */}
      {step === 3 && (
        <>
          <ReviewBlock
            title="Identificação"
            icon="👥"
            fields={[
              { label: "Nome", value: form.nome, full: true },
              {
                label: "Tipo",
                value:
                  form.tipoPessoa === "FISICA"
                    ? "Pessoa Física"
                    : "Pessoa Jurídica",
              },
              { label: "Segmento", value: form.segmento },
              {
                label: "Porte",
                value: PORTES_OPCOES.find((p) => p.value === form.porte)?.label,
              },
            ]}
          />

          <ReviewBlock
            title="Contato"
            icon="📞"
            fields={[
              { label: "E-mail", value: form.email },
              { label: "WhatsApp", value: form.whatsapp },
              { label: "Telefone", value: form.telefone },
              {
                label: "Acesso ao portal",
                value: form.criarAcesso ? "Sim (senha será gerada)" : "Não",
              },
            ]}
          />

          {form.descricao && (
            <ReviewBlock
              title="Descrição"
              icon="📝"
              fields={[{ label: "", value: form.descricao, full: true }]}
            />
          )}

          <FormSection
            title="Catálogo"
            icon="📦"
            description={`${totalItems} item(s) cadastrado(s)`}
          >
            {totalItems === 0 ? (
              <div
                style={{
                  fontSize: 13,
                  color: colors.textMuted,
                  fontStyle: "italic",
                }}
              >
                Nenhum item cadastrado
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, 1fr)",
                  gap: 12,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.green,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    Oferecidos ({itemsOferecidos.length})
                  </div>
                  {itemsOferecidos.map((it, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 12,
                        color: colors.text,
                        marginBottom: 3,
                      }}
                    >
                      • {it.nome}{" "}
                      {it.ncmCodigo && (
                        <span
                          style={{
                            color: colors.textMuted,
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                          }}
                        >
                          (NCM {it.ncmCodigo})
                        </span>
                      )}
                    </div>
                  ))}
                  {itemsOferecidos.length === 0 && (
                    <div
                      style={{
                        fontSize: 12,
                        color: colors.textMuted,
                        fontStyle: "italic",
                      }}
                    >
                      —
                    </div>
                  )}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.orange,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    Demandados ({itemsDemandados.length})
                  </div>
                  {itemsDemandados.map((it, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: 12,
                        color: colors.text,
                        marginBottom: 3,
                      }}
                    >
                      • {it.nome}{" "}
                      {it.ncmCodigo && (
                        <span
                          style={{
                            color: colors.textMuted,
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 10,
                          }}
                        >
                          (NCM {it.ncmCodigo})
                        </span>
                      )}
                    </div>
                  ))}
                  {itemsDemandados.length === 0 && (
                    <div
                      style={{
                        fontSize: 12,
                        color: colors.textMuted,
                        fontStyle: "italic",
                      }}
                    >
                      —
                    </div>
                  )}
                </div>
              </div>
            )}
          </FormSection>

          <WizardNav
            step={step}
            totalSteps={3}
            onBack={handleBack}
            onSave={handleSave}
            saving={saving}
            saveLabel="Cadastrar associado"
          />
        </>
      )}
    </div>
  );
}

// ══════════════════════════════
// ─── NOVO EVENTO FORM PAGE ───
// ══════════════════════════════
// Wizard de 3 steps (Dados → Detalhes → Revisão) no mesmo padrão
// visual das páginas Nova Empresa / Novo Associado.
// Corrige também bug anterior: o handleSave era sync com setTimeout
// e ignorava erros da API; agora é async real com tratamento de erro.
function NovoEventoPage({ setPage, onAdd }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    nome: "",
    tipo: "presencial", // presencial | online | hibrido
    dataInicio: "",
    dataFim: "",
    local: "",
    numeroWhatsapp: "",
    status: "PLANEJADO",
    categorias: [],
    descricao: "",
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [eventoCriado, setEventoCriado] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const categoriasList = [
    { id: "Energy", icon: "⚡", label: "Energia" },
    { id: "Technology", icon: "💻", label: "Tecnologia" },
    { id: "Logistics", icon: "🚢", label: "Logística" },
    { id: "Food", icon: "🌾", label: "Alimentos" },
    { id: "Financial", icon: "💰", label: "Financeiro" },
    { id: "Legal", icon: "⚖️", label: "Jurídico" },
    { id: "Healthcare", icon: "🏥", label: "Saúde" },
    { id: "Manufacturing", icon: "🏭", label: "Manufatura" },
    { id: "Agriculture", icon: "🌱", label: "Agronegócio" },
    { id: "Education", icon: "🎓", label: "Educação" },
  ];

  const tiposEvento = [
    {
      value: "presencial",
      label: "Presencial",
      icon: "🏛️",
      desc: "Local físico definido",
    },
    {
      value: "online",
      label: "Online",
      icon: "💻",
      desc: "Via plataforma digital",
    },
    {
      value: "hibrido",
      label: "Híbrido",
      icon: "🔄",
      desc: "Presencial + transmissão",
    },
  ];

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field])
      setErrors((prev) => {
        const n = { ...prev };
        delete n[field];
        return n;
      });
  };

  const toggleCategoria = (c) => {
    setForm((prev) => ({
      ...prev,
      categorias: prev.categorias.includes(c)
        ? prev.categorias.filter((x) => x !== c)
        : [...prev.categorias, c],
    }));
  };

  const validateStep1 = () => {
    const e = {};
    if (!form.nome.trim()) e.nome = "Nome do evento é obrigatório";
    if (!form.dataInicio) e.dataInicio = "Data de início é obrigatória";
    if (!form.dataFim) e.dataFim = "Data de término é obrigatória";
    if (form.dataInicio && form.dataFim && form.dataFim < form.dataInicio) {
      e.dataFim = "Término deve ser após o início";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e = {};
    if (form.tipo !== "online" && !form.local.trim()) {
      e.local = "Local é obrigatório para eventos presenciais/híbridos";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    setServerError(null);
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    setServerError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const handleSave = async () => {
    setServerError(null);
    setSaving(true);
    try {
      // Datas convertidas pra ISO 8601 antes de mandar ao backend.
      // O backend faz `new Date(data)` — exige string ISO pra parsear corretamente.
      const payload = {
        nome: form.nome.trim(),
        local:
          form.tipo === "online"
            ? form.local.trim() || "Online"
            : form.local.trim(),
        dataInicio: new Date(form.dataInicio + "T00:00:00").toISOString(),
        dataFim: form.dataFim
          ? new Date(form.dataFim + "T23:59:59").toISOString()
          : null,
        descricao: form.descricao.trim() || null,
        numero: form.numeroWhatsapp.trim() || null,
        status: form.status === "ATIVO" ? "Ativo" : "Planejado",
        categorias: form.categorias,
        tipo: form.tipo,
      };
      const result = await onAdd(payload);
      // O App retorna o evento criado (com id/slug). Guardamos pra tela de sucesso.
      setEventoCriado(result || null);
      setSaved(true);
    } catch (err) {
      setServerError(err?.message || "Erro ao salvar evento");
    } finally {
      setSaving(false);
    }
  };

  const copiarLink = async (link) => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  // ─── Tela de sucesso ───
  if (saved) {
    const linkInscricao = eventoCriado?.inscricaoSlug
      ? `${window.location.origin}/inscricao/${eventoCriado.inscricaoSlug}`
      : null;

    return (
      <div style={{ padding: 28 }}>
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.green}30`,
            borderRadius: 16,
            padding: 40,
            textAlign: "center",
            maxWidth: 640,
            margin: "40px auto",
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            Evento criado!
          </h2>
          <p
            style={{ fontSize: 14, color: colors.textMuted, marginBottom: 20 }}
          >
            <strong style={{ color: colors.text }}>{form.nome}</strong> foi
            adicionado ao sistema.
          </p>

          {/* Link de inscrição gerado automaticamente */}
          {linkInscricao && (
            <div
              style={{
                background: `${colors.blue}08`,
                border: `1px solid ${colors.blue}30`,
                borderRadius: 10,
                padding: 16,
                marginBottom: 20,
                textAlign: "left",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors.blue,
                  textTransform: "uppercase",
                  letterSpacing: 0.8,
                  marginBottom: 8,
                }}
              >
                <IconLink /> Link de inscrição pública
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <input
                  readOnly
                  value={linkInscricao}
                  onClick={(e) => e.target.select()}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceLight,
                    fontSize: 12,
                    fontFamily: "'JetBrains Mono', monospace",
                    color: colors.text,
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => copiarLink(linkInscricao)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: 6,
                    border: "none",
                    background: copiedLink ? colors.green : colors.blue,
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {copiedLink ? "✓ Copiado" : "Copiar"}
                </button>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: colors.textMuted,
                  lineHeight: 1.5,
                }}
              >
                Compartilhe este link. Empresas que se inscreverem ficarão
                vinculadas exclusivamente a este evento.
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => setPage("gestao-eventos")}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                border: "none",
                background: `linear-gradient(135deg, ${colors.blue}, ${colors.purple})`,
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Ver todos os eventos →
            </button>
            <button
              onClick={() => {
                setForm({
                  nome: "",
                  tipo: "presencial",
                  dataInicio: "",
                  dataFim: "",
                  local: "",
                  numeroWhatsapp: "",
                  status: "PLANEJADO",
                  categorias: [],
                  descricao: "",
                });
                setStep(1);
                setSaved(false);
                setEventoCriado(null);
              }}
              style={{
                padding: "12px 24px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              + Criar outro
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Steps do wizard ───
  const STEPS = [
    { label: "Informações", hint: "Nome e datas" },
    { label: "Detalhes", hint: "Local e categorias" },
    { label: "Revisão", hint: "Conferir e criar" },
  ];

  // ─── Formulário principal ───
  return (
    <div style={{ padding: 28, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h2
          style={{
            fontSize: 26,
            fontWeight: 800,
            color: colors.text,
            marginBottom: 6,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Cadastro de Eventos
        </h2>
        <p style={{ fontSize: 13, color: colors.textMuted }}>
          Eventos geram automaticamente um link público de inscrição que pode
          ser compartilhado
        </p>
      </div>

      <WizardStepper steps={STEPS} current={step} />

      {serverError && (
        <div
          style={{
            background: `${colors.red}10`,
            border: `1px solid ${colors.red}30`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 13, color: colors.red, flex: 1 }}>
            {serverError}
          </span>
        </div>
      )}

      {/* STEP 1: Informações básicas */}
      {step === 1 && (
        <>
          <FormSection
            title="Identificação"
            icon="📅"
            description="Nome e datas do evento"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 14,
              }}
            >
              <Field
                label="Nome do evento"
                required
                error={errors.nome}
                span={12}
              >
                <InputText
                  value={form.nome}
                  onChange={(v) => update("nome", v)}
                  placeholder="Ex: BRATECC Summit 2026"
                  error={errors.nome}
                />
              </Field>
              <Field
                label="Data de início"
                required
                error={errors.dataInicio}
                span={6}
              >
                <InputText
                  type="date"
                  value={form.dataInicio}
                  onChange={(v) => update("dataInicio", v)}
                  error={errors.dataInicio}
                />
              </Field>
              <Field
                label="Data de término"
                required
                error={errors.dataFim}
                span={6}
              >
                <InputText
                  type="date"
                  value={form.dataFim}
                  onChange={(v) => update("dataFim", v)}
                  error={errors.dataFim}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title="Formato do evento" icon="🎯">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 12,
              }}
            >
              {tiposEvento.map((t) => {
                const active = form.tipo === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() => update("tipo", t.value)}
                    style={{
                      padding: "16px 14px",
                      borderRadius: 12,
                      border: `2px solid ${active ? colors.blue : colors.border}`,
                      background: active ? `${colors.blue}10` : colors.surface,
                      color: colors.text,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>
                      {t.icon}
                    </div>
                    <div
                      style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}
                    >
                      {t.label}
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {t.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </FormSection>

          <WizardNav
            step={step}
            totalSteps={3}
            onBack={handleBack}
            onNext={handleNext}
          />
        </>
      )}

      {/* STEP 2: Detalhes */}
      {step === 2 && (
        <>
          <FormSection title="Local e contato" icon="📍">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 14,
              }}
            >
              <Field
                label={
                  form.tipo === "online" ? "Plataforma (opcional)" : "Local"
                }
                required={form.tipo !== "online"}
                error={errors.local}
                hint={
                  form.tipo === "online"
                    ? "Ex: Zoom, Google Meet, Teams — deixe em branco para 'Online'"
                    : "Endereço completo ou nome do venue"
                }
                span={12}
              >
                <InputText
                  value={form.local}
                  onChange={(v) => update("local", v)}
                  placeholder={
                    form.tipo === "online"
                      ? "Ex: Zoom Webinar"
                      : "Ex: Hotel Maksoud Plaza, São Paulo"
                  }
                  error={errors.local}
                />
              </Field>
              <Field
                label="WhatsApp de contato"
                span={6}
                hint="Número que participantes verão para tirar dúvidas"
              >
                <InputText
                  value={form.numeroWhatsapp}
                  onChange={(v) => update("numeroWhatsapp", v)}
                  placeholder="+55 11 98765-4321"
                />
              </Field>
              <Field label="Status inicial" span={6}>
                <SelectField
                  value={form.status}
                  onChange={(v) => update("status", v)}
                  options={[
                    {
                      value: "PLANEJADO",
                      label: "Planejado (não aceita inscrições ainda)",
                    },
                    { value: "ATIVO", label: "Ativo (recebendo inscrições)" },
                  ]}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection
            title="Categorias"
            icon="🏷️"
            description="Marque as áreas de interesse — ajuda a IA a sugerir matches mais precisos"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 10,
              }}
            >
              {categoriasList.map((c) => {
                const active = form.categorias.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleCategoria(c.id)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: `1.5px solid ${active ? colors.blue : colors.border}`,
                      background: active ? `${colors.blue}10` : colors.surface,
                      color: active ? colors.blue : colors.text,
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transition: "all 0.15s",
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{c.icon}</span>
                    <span>{c.label}</span>
                  </button>
                );
              })}
            </div>
            {form.categorias.length > 0 && (
              <div
                style={{ marginTop: 10, fontSize: 11, color: colors.textMuted }}
              >
                {form.categorias.length} categoria(s) selecionada(s)
              </div>
            )}
          </FormSection>

          <FormSection
            title="Descrição"
            icon="📝"
            description="Opcional — aparece no link público de inscrição"
          >
            <Field>
              <TextareaField
                value={form.descricao}
                onChange={(v) => update("descricao", v)}
                placeholder="Descreva o objetivo, público-alvo e agenda do evento..."
                rows={4}
              />
            </Field>
          </FormSection>

          <WizardNav
            step={step}
            totalSteps={3}
            onBack={handleBack}
            onNext={handleNext}
          />
        </>
      )}

      {/* STEP 3: Revisão */}
      {step === 3 && (
        <>
          <ReviewBlock
            title="Informações do evento"
            icon="📅"
            fields={[
              { label: "Nome", value: form.nome, full: true },
              {
                label: "Formato",
                value: tiposEvento.find((t) => t.value === form.tipo)?.label,
              },
              {
                label: "Status inicial",
                value: form.status === "ATIVO" ? "Ativo" : "Planejado",
              },
              {
                label: "Data de início",
                value: form.dataInicio
                  ? new Date(form.dataInicio + "T00:00:00").toLocaleDateString(
                      "pt-BR",
                      { day: "numeric", month: "long", year: "numeric" },
                    )
                  : "",
              },
              {
                label: "Data de término",
                value: form.dataFim
                  ? new Date(form.dataFim + "T00:00:00").toLocaleDateString(
                      "pt-BR",
                      { day: "numeric", month: "long", year: "numeric" },
                    )
                  : "",
              },
            ]}
          />

          <ReviewBlock
            title="Local e contato"
            icon="📍"
            fields={[
              {
                label: "Local",
                value: form.local || (form.tipo === "online" ? "Online" : "—"),
                full: true,
              },
              { label: "WhatsApp", value: form.numeroWhatsapp },
            ]}
          />

          {form.categorias.length > 0 && (
            <FormSection
              title="Categorias"
              icon="🏷️"
              description={`${form.categorias.length} selecionada(s)`}
            >
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {form.categorias.map((cid) => {
                  const c = categoriasList.find((x) => x.id === cid);
                  return (
                    <span
                      key={cid}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 20,
                        background: `${colors.blue}15`,
                        color: colors.blue,
                        fontSize: 12,
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span>{c?.icon}</span>
                      {c?.label || cid}
                    </span>
                  );
                })}
              </div>
            </FormSection>
          )}

          {form.descricao && (
            <ReviewBlock
              title="Descrição"
              icon="📝"
              fields={[{ label: "", value: form.descricao, full: true }]}
            />
          )}

          <div
            style={{
              background: `${colors.purple}08`,
              border: `1px solid ${colors.purple}30`,
              borderRadius: 10,
              padding: 14,
              marginBottom: 18,
              fontSize: 12,
              color: colors.textMuted,
              lineHeight: 1.5,
            }}
          >
            💡{" "}
            <strong style={{ color: colors.text }}>
              Link de inscrição automático:
            </strong>{" "}
            ao salvar, o sistema gerará um link público único que você pode
            compartilhar com empresas interessadas em participar deste evento.
          </div>

          <WizardNav
            step={step}
            totalSteps={3}
            onBack={handleBack}
            onSave={handleSave}
            saving={saving}
            saveLabel="Criar evento"
          />
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MÓDULO UNIVERSIDADES
// ═══════════════════════════════════════════════════════════
//   • NovaUniversidadePage    — formulário de cadastro
//   • GestaoUniversidadesPage — listagem com edição inline + reset senha
//   • UnivAssocPage           — grade de matches Candidato × Vaga
// ═══════════════════════════════════════════════════════════

function NovaUniversidadePage({ setPage, onAdd }) {
  const [form, setForm] = useState({
    nome: "",
    sigla: "",
    cidade: "",
    estado: "",
    email: "",
    telefone: "",
    responsavel: "",
    descricao: "",
    senha: "",
  });
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const handleSave = async () => {
    if (!form.nome.trim() || !form.email.trim()) {
      setResult({ error: "Nome e e-mail são obrigatórios." });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const r = await onAdd({
        ...form,
        criarUsuario: !!form.senha.trim(),
        senha: form.senha.trim() || null,
      });
      if (r?.success === false) {
        setResult({ error: r.error || "Falha ao criar." });
      } else {
        setResult({
          success: `Universidade "${form.nome}" cadastrada com sucesso.`,
        });
        setTimeout(() => setPage("gestao-universidades"), 1500);
      }
    } catch (err) {
      setResult({ error: err?.message || "Erro de rede" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: colors.text,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Nova Universidade
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            Cadastre universidades ou aceleradoras que vão indicar candidatos.
          </p>
        </div>
        <button
          onClick={() => setPage("gestao-universidades")}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceLight,
            color: colors.text,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          ← Voltar à Gestão
        </button>
      </div>

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          padding: 28,
          maxWidth: 760,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <FormField label="Nome da Universidade *">
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              style={fld}
              placeholder="Ex: Universidade Federal de Uberlândia"
            />
          </FormField>
          <FormField label="Sigla">
            <input
              value={form.sigla}
              onChange={(e) => setForm({ ...form, sigla: e.target.value })}
              style={fld}
              placeholder="UFU"
            />
          </FormField>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <FormField label="Cidade">
            <input
              value={form.cidade}
              onChange={(e) => setForm({ ...form, cidade: e.target.value })}
              style={fld}
            />
          </FormField>
          <FormField label="Estado">
            <input
              value={form.estado}
              onChange={(e) => setForm({ ...form, estado: e.target.value })}
              style={fld}
              placeholder="MG"
              maxLength={2}
            />
          </FormField>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <FormField label="E-mail (login) *">
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={fld}
              type="email"
              placeholder="contato@universidade.edu.br"
            />
          </FormField>
          <FormField label="Telefone">
            <input
              value={form.telefone}
              onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              style={fld}
              placeholder="+55 11 99999-9999"
            />
          </FormField>
        </div>
        <FormField label="Responsável (pessoa de contato)">
          <input
            value={form.responsavel}
            onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
            style={fld}
            placeholder="Nome do coordenador"
          />
        </FormField>
        <FormField label="Descrição">
          <textarea
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            style={{
              ...fld,
              minHeight: 70,
              resize: "vertical",
              fontFamily: "inherit",
            }}
            placeholder="Breve descrição da universidade ou aceleradora"
          />
        </FormField>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 10,
            background: `${colors.blue}08`,
            border: `1px solid ${colors.blue}20`,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: colors.blue,
              marginBottom: 8,
            }}
          >
            Acesso ao sistema
          </div>
          <FormField label="Senha (opcional — se preenchida, cria login para a universidade)">
            <input
              type="text"
              value={form.senha}
              onChange={(e) => setForm({ ...form, senha: e.target.value })}
              style={fld}
              placeholder="Mínimo 6 caracteres ou deixe em branco"
            />
          </FormField>
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
            Você pode resetar/criar a senha depois na tela de Gestão.
          </div>
        </div>

        {result?.error && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 8,
              background: `${colors.red}10`,
              color: colors.red,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {result.error}
          </div>
        )}
        {result?.success && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 8,
              background: `${colors.green}10`,
              color: colors.green,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            ✓ {result.success}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            marginTop: 20,
          }}
        >
          <button
            onClick={() => setPage("gestao-universidades")}
            disabled={saving}
            style={{
              padding: "11px 20px",
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              cursor: saving ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "11px 22px",
              borderRadius: 10,
              border: "none",
              background: saving
                ? colors.surfaceLight
                : `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
              color: saving ? colors.textMuted : "#fff",
              cursor: saving ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {saving ? "Salvando..." : "✓ Cadastrar Universidade"}
          </button>
        </div>
      </div>
    </div>
  );
}

function GestaoUniversidadesPage({
  setPage,
  universidadesData = [],
  onDelete,
  onUpdate,
  onResetSenha,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  const [resetTarget, setResetTarget] = useState(null);
  const [resetMode, setResetMode] = useState("auto");
  const [resetCustomSenha, setResetCustomSenha] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const filtered = universidadesData.filter((u) => {
    return (
      !searchTerm ||
      u.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.sigla || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (u.email || "").toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const openEdit = (u) => {
    setEditingId(u.id);
    setEditForm({
      nome: u.nome,
      sigla: u.sigla || "",
      cidade: u.cidade || "",
      estado: u.estado || "",
      email: u.email || "",
      telefone: u.telefone || "",
      responsavel: u.responsavel || "",
      descricao: u.descricao || "",
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };
  const saveEdit = async () => {
    if (!editForm.nome?.trim()) return;
    setSaving(true);
    if (onUpdate) await onUpdate(editingId, editForm);
    setSaving(false);
    setEditingId(null);
  };

  const openResetModal = (u) => {
    setResetTarget(u);
    setResetMode("auto");
    setResetCustomSenha("");
    setResetResult(null);
    setCopied(false);
  };
  const closeResetModal = () => {
    setResetTarget(null);
    setResetCustomSenha("");
    setResetResult(null);
    setResetLoading(false);
    setCopied(false);
  };
  const submitReset = async () => {
    if (!resetTarget || !onResetSenha) return;
    if (
      resetMode === "custom" &&
      (!resetCustomSenha || resetCustomSenha.length < 6)
    ) {
      setResetResult({ error: "A senha precisa ter pelo menos 6 caracteres." });
      return;
    }
    setResetLoading(true);
    setResetResult(null);
    const r = await onResetSenha(
      resetTarget.id,
      resetMode === "custom" ? resetCustomSenha : null,
    );
    setResetLoading(false);
    if (r.success) {
      setResetResult({
        novaSenha: r.novaSenha,
        email: r.email,
        geradaPorSistema: r.geradaPorSistema,
        mensagem: r.mensagem,
      });
    } else {
      setResetResult({ error: r.error });
    }
  };
  const copySenha = () => {
    if (!resetResult?.novaSenha) return;
    try {
      navigator.clipboard.writeText(resetResult.novaSenha);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: colors.text,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Gestão de Universidades
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            {universidadesData.length} universidade
            {universidadesData.length !== 1 ? "s" : ""} cadastrada
            {universidadesData.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setPage("nova-universidade")}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          + Nova Universidade
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Total"
          value={universidadesData.length}
          color={colors.purple}
        />
        <StatCard
          label="Candidatos cadastrados"
          value={universidadesData.reduce(
            (acc, u) =>
              acc + (u._count?.candidatos || u.candidatos?.length || 0),
            0,
          )}
          color={colors.blue}
          delay={0.05}
        />
      </div>

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: 14,
          marginBottom: 18,
        }}
      >
        <div style={{ position: "relative" }}>
          <span
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: colors.textMuted,
              display: "flex",
            }}
          >
            <Icons.Search />
          </span>
          <input
            placeholder="Buscar por nome, sigla ou e-mail..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ ...fld, paddingLeft: 38 }}
          />
        </div>
      </div>

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                borderBottom: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
              }}
            >
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Universidade
              </th>
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Localização
              </th>
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Contato
              </th>
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "center",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Candidatos
              </th>
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "center",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: "40px 16px",
                    textAlign: "center",
                    color: colors.textMuted,
                    fontSize: 13,
                  }}
                >
                  Nenhuma universidade cadastrada. Clique em "+ Nova
                  Universidade" para começar.
                </td>
              </tr>
            )}
            {filtered.map((u) => (
              <tr
                key={u.id}
                style={{ borderBottom: `1px solid ${colors.border}` }}
              >
                <td style={{ padding: "14px 16px" }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: colors.text,
                    }}
                  >
                    {u.nome}
                  </div>
                  {u.sigla && (
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {u.sigla}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: "14px 16px",
                    fontSize: 12,
                    color: colors.textMuted,
                  }}
                >
                  {u.cidade
                    ? `${u.cidade}${u.estado ? ", " + u.estado : ""}`
                    : "—"}
                </td>
                <td
                  style={{
                    padding: "14px 16px",
                    fontSize: 12,
                    color: colors.text,
                  }}
                >
                  <div>{u.email}</div>
                  {u.telefone && (
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {u.telefone}
                    </div>
                  )}
                </td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>
                  <span
                    style={{
                      padding: "4px 12px",
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: 700,
                      background: `${colors.purple}15`,
                      color: colors.purple,
                    }}
                  >
                    {u._count?.candidatos || u.candidatos?.length || 0}
                  </span>
                </td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: 6,
                    }}
                  >
                    <button
                      onClick={() => openEdit(u)}
                      title="Editar"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        border: `1px solid ${colors.border}`,
                        background: colors.surfaceLight,
                        color: colors.textMuted,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                        fontSize: 14,
                      }}
                    >
                      <IconEdit />
                    </button>
                    <button
                      onClick={() => openResetModal(u)}
                      title="Resetar senha"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        border: `1px solid ${colors.blue}30`,
                        background: `${colors.blue}08`,
                        color: colors.blue,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                        fontSize: 14,
                      }}
                    >
                      <IconKey />
                    </button>
                    <button
                      onClick={() => onDelete && onDelete(u.id)}
                      title="Excluir"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        border: `1px solid ${colors.red}30`,
                        background: `${colors.red}08`,
                        color: colors.red,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 0,
                        fontSize: 14,
                      }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal de edição */}
      {editingId && (
        <EditModal
          title="Editar Universidade"
          onClose={cancelEdit}
          onSave={saveEdit}
          saving={saving}
        >
          <div
            style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}
          >
            <FormField label="Nome *">
              <input
                value={editForm.nome || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, nome: e.target.value })
                }
                style={fld}
              />
            </FormField>
            <FormField label="Sigla">
              <input
                value={editForm.sigla || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, sigla: e.target.value })
                }
                style={fld}
              />
            </FormField>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}
          >
            <FormField label="Cidade">
              <input
                value={editForm.cidade || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, cidade: e.target.value })
                }
                style={fld}
              />
            </FormField>
            <FormField label="Estado">
              <input
                value={editForm.estado || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, estado: e.target.value })
                }
                style={fld}
                maxLength={2}
              />
            </FormField>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <FormField label="E-mail">
              <input
                value={editForm.email || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, email: e.target.value })
                }
                style={fld}
              />
            </FormField>
            <FormField label="Telefone">
              <input
                value={editForm.telefone || ""}
                onChange={(e) =>
                  setEditForm({ ...editForm, telefone: e.target.value })
                }
                style={fld}
              />
            </FormField>
          </div>
          <FormField label="Responsável">
            <input
              value={editForm.responsavel || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, responsavel: e.target.value })
              }
              style={fld}
            />
          </FormField>
          <FormField label="Descrição">
            <textarea
              value={editForm.descricao || ""}
              onChange={(e) =>
                setEditForm({ ...editForm, descricao: e.target.value })
              }
              style={{
                ...fld,
                minHeight: 70,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </FormField>
        </EditModal>
      )}

      {/* Modal de reset de senha */}
      {resetTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeResetModal();
          }}
        >
          <div
            style={{
              background: colors.surface,
              borderRadius: 16,
              padding: 28,
              maxWidth: 520,
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: `${colors.blue}15`,
                  color: colors.blue,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconKey />
              </div>
              <div>
                <h3
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: colors.text,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  Resetar senha
                </h3>
                <p
                  style={{
                    fontSize: 12,
                    color: colors.textMuted,
                    marginTop: 2,
                  }}
                >
                  Universidade:{" "}
                  <strong style={{ color: colors.text }}>
                    {resetTarget.nome}
                  </strong>
                </p>
              </div>
            </div>

            {!resetResult?.novaSenha && (
              <>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    marginBottom: 20,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: 14,
                      borderRadius: 10,
                      border: `1px solid ${resetMode === "auto" ? colors.blue : colors.border}`,
                      background:
                        resetMode === "auto"
                          ? `${colors.blue}08`
                          : colors.surface,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="rmode"
                      checked={resetMode === "auto"}
                      onChange={() => setResetMode("auto")}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: colors.text,
                        }}
                      >
                        Gerar senha temporária
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: colors.textMuted,
                          marginTop: 2,
                        }}
                      >
                        Sistema gera senha aleatória.
                      </div>
                    </div>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      padding: 14,
                      borderRadius: 10,
                      border: `1px solid ${resetMode === "custom" ? colors.blue : colors.border}`,
                      background:
                        resetMode === "custom"
                          ? `${colors.blue}08`
                          : colors.surface,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="rmode"
                      checked={resetMode === "custom"}
                      onChange={() => setResetMode("custom")}
                      style={{ marginTop: 3 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: colors.text,
                        }}
                      >
                        Definir senha manualmente
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: colors.textMuted,
                          marginTop: 2,
                          marginBottom: 8,
                        }}
                      >
                        Mínimo 6 caracteres.
                      </div>
                      {resetMode === "custom" && (
                        <input
                          type="text"
                          placeholder="Nova senha"
                          value={resetCustomSenha}
                          onChange={(e) => setResetCustomSenha(e.target.value)}
                          style={{
                            ...fld,
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                        />
                      )}
                    </div>
                  </label>
                </div>
                {resetResult?.error && (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      marginBottom: 14,
                      background: `${colors.red}10`,
                      color: colors.red,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {resetResult.error}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10,
                  }}
                >
                  <button
                    onClick={closeResetModal}
                    disabled={resetLoading}
                    style={{
                      padding: "10px 18px",
                      borderRadius: 10,
                      border: `1px solid ${colors.border}`,
                      background: colors.surfaceLight,
                      color: colors.text,
                      cursor: resetLoading ? "wait" : "pointer",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={submitReset}
                    disabled={resetLoading}
                    style={{
                      padding: "10px 22px",
                      borderRadius: 10,
                      border: "none",
                      background: `linear-gradient(135deg, ${colors.blue}, ${colors.blue}cc)`,
                      color: "#fff",
                      cursor: resetLoading ? "wait" : "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {resetLoading ? "Resetando..." : "Resetar"}
                  </button>
                </div>
              </>
            )}

            {resetResult?.novaSenha && (
              <>
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: `${colors.green}10`,
                    border: `1px solid ${colors.green}30`,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: colors.green,
                      marginBottom: 4,
                    }}
                  >
                    Senha resetada com sucesso
                  </div>
                  <div style={{ fontSize: 11, color: colors.textMuted }}>
                    {resetResult.mensagem}
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    E-mail (login)
                  </div>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: colors.surfaceLight,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 13,
                      color: colors.text,
                    }}
                  >
                    {resetResult.email || "—"}
                  </div>
                </div>
                <div style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: colors.textMuted,
                      textTransform: "uppercase",
                      letterSpacing: 0.8,
                      marginBottom: 6,
                    }}
                  >
                    Nova senha {resetResult.geradaPorSistema ? "(gerada)" : ""}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div
                      style={{
                        flex: 1,
                        padding: "12px 14px",
                        borderRadius: 8,
                        background: `${colors.purple}10`,
                        border: `1px solid ${colors.purple}30`,
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 16,
                        fontWeight: 700,
                        color: colors.purple,
                        letterSpacing: 1,
                      }}
                    >
                      {resetResult.novaSenha}
                    </div>
                    <button
                      onClick={copySenha}
                      style={{
                        padding: "0 16px",
                        borderRadius: 8,
                        border: "none",
                        background: copied ? colors.green : colors.surfaceLight,
                        color: copied ? "#fff" : colors.text,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {copied ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: colors.textMuted,
                      marginTop: 6,
                      fontStyle: "italic",
                    }}
                  >
                    Esta senha não será exibida novamente.
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={closeResetModal}
                    style={{
                      padding: "10px 22px",
                      borderRadius: 10,
                      border: "none",
                      background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
                      color: "#fff",
                      cursor: "pointer",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    Fechar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
//Universidade Associados Pagina ----
function IconAlert() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

function IconLoader() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

function UnivAssocPage({
  matchVagasData = [],
  universidadesData = [],
  onRegenerate,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [universidadeFilter, setUniversidadeFilter] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [hsmResult, setHsmResult] = useState(null);

  const matches = matchVagasData || [];
  const hasFiltersActive = Boolean(
    searchTerm || statusFilter || universidadeFilter,
  );

  const filtered = matches
    .filter((m) => {
      const empresa = m.vaga?.associado?.nome || "";
      const candidato = m.candidato?.nome || "";
      const vaga = m.vaga?.titulo || "";
      const matchSearch =
        !searchTerm ||
        empresa.toLowerCase().includes(searchTerm.toLowerCase()) ||
        candidato.toLowerCase().includes(searchTerm.toLowerCase()) ||
        vaga.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = !statusFilter || m.status === statusFilter;
      const matchUniv =
        !universidadeFilter ||
        m.candidato?.universidade?.id === parseInt(universidadeFilter);
      return matchSearch && matchStatus && matchUniv;
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const stats = {
    total: matches.length,
    pending: matches.filter((m) => m.status === "PENDING").length,
    contacted: matches.filter((m) => m.status === "CONTACTED").length,
    interested: matches.filter((m) => m.status === "INTERESTED").length,
    confirmed: matches.filter((m) => m.status === "CONFIRMED").length,
  };

  const handleGenerate = async () => {
    if (!onRegenerate) return;
    setIsGenerating(true);
    setHsmResult(null);
    const r = await onRegenerate();
    setIsGenerating(false);
    if (r?.error) {
      setHsmResult({ success: false, message: r.error });
    } else {
      setHsmResult({
        success: true,
        message: `Matches gerados${r?.hsmInfo?.sent ? ` · ${r.hsmInfo.sent} HSM enviados` : ""}`,
      });
    }
    setTimeout(() => setHsmResult(null), 6000);
  };

  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("");
    setUniversidadeFilter("");
  };

  const statusBadge = (status) => {
    const map = {
      PENDING: {
        label: "Pendente",
        bg: "rgba(217,119,6,0.1)",
        color: "#b45309",
        border: "rgba(217,119,6,0.25)",
      },
      CONTACTED: {
        label: "Contatado",
        bg: "rgba(139,92,246,0.1)",
        color: "#7c3aed",
        border: "rgba(139,92,246,0.25)",
      },
      INTERESTED: {
        label: "Interessado",
        bg: "rgba(79,124,255,0.1)",
        color: "#3b6de0",
        border: "rgba(79,124,255,0.25)",
      },
      CONFIRMED: {
        label: "Confirmado",
        bg: "rgba(0,184,118,0.1)",
        color: "#00875a",
        border: "rgba(0,184,118,0.25)",
      },
      REJECTED: {
        label: "Rejeitado",
        bg: "rgba(239,68,68,0.1)",
        color: "#dc2626",
        border: "rgba(239,68,68,0.25)",
      },
    };
    const cfg = map[status] || map.PENDING;
    return (
      <span
        style={{
          padding: "4px 12px",
          borderRadius: 20,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 0.3,
          background: cfg.bg,
          color: cfg.color,
          border: `1px solid ${cfg.border}`,
        }}
      >
        {cfg.label}
      </span>
    );
  };

  const getScoreColor = (score) => {
    if (score >= 85) return colors.green;
    if (score >= 70) return colors.blue;
    if (score >= 50) return colors.orange;
    return colors.red;
  };

  const getPriorityLabel = (score) => {
    if (score >= 80)
      return { label: "ALTA", color: colors.green, bg: `${colors.green}15` };
    if (score >= 60)
      return { label: "MÉDIA", color: colors.orange, bg: `${colors.orange}15` };
    return { label: "BAIXA", color: colors.textMuted, bg: colors.surfaceLight };
  };

  return (
    <div style={{ padding: 28 }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes skeletonPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
      `}</style>

      {/* Header */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 6,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Universidades × Associados
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {matches.length} match{matches.length !== 1 ? "es" : ""} candidato ×
            vaga
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: isGenerating
              ? colors.surfaceLight
              : `linear-gradient(135deg, ${colors.green}, ${colors.green}cc)`,
            color: isGenerating ? colors.textMuted : "#fff",
            cursor: isGenerating ? "wait" : "pointer",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            minWidth: 168,
            whiteSpace: "nowrap",
          }}
        >
          {isGenerating ? (
            <>
              <IconLoader /> Processando...
            </>
          ) : (
            <>
              <Icons.Sparkles /> Gerar Matches
            </>
          )}
        </button>
      </div>

      {/* Result Banner */}
      {hsmResult && (
        <div
          style={{
            background: hsmResult.success
              ? `${colors.green}10`
              : `${colors.orange}10`,
            border: `1px solid ${hsmResult.success ? colors.green : colors.orange}30`,
            borderRadius: 12,
            padding: "14px 20px",
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {hsmResult.success ? <Icons.Check /> : <IconAlert />}
          <span
            style={{
              fontSize: 13,
              color: hsmResult.success ? colors.green : colors.orange,
              fontWeight: 600,
            }}
          >
            {hsmResult.message}
          </span>
        </div>
      )}

      {/* Stats Cards */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard label="Total" value={stats.total} color={colors.purple} />
        <StatCard
          label="Pendentes"
          value={stats.pending}
          color={colors.orange}
          delay={0.05}
        />
        <StatCard
          label="Contatados"
          value={stats.contacted}
          color={colors.cyan}
          delay={0.1}
        />
        <StatCard
          label="Interessados"
          value={stats.interested}
          color={colors.blue}
          delay={0.15}
        />
        <StatCard
          label="Confirmados"
          value={stats.confirmed}
          color={colors.green}
          delay={0.2}
        />
      </div>

      {/* Filters Bar */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: "2 1 240px" }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Buscar
          </label>
          <div style={{ position: "relative" }}>
            <span
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.textMuted,
                display: "flex",
              }}
            >
              <Icons.Search />
            </span>
            <input
              type="text"
              placeholder="Buscar candidato, vaga ou associado..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px 10px 38px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.text,
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 13,
              boxSizing: "border-box",
            }}
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendentes</option>
            <option value="CONTACTED">Contatados</option>
            <option value="INTERESTED">Interessados</option>
            <option value="CONFIRMED">Confirmados</option>
            <option value="REJECTED">Rejeitados</option>
          </select>
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: colors.textMuted,
              letterSpacing: 0.8,
              display: "block",
              marginBottom: 8,
              textTransform: "uppercase",
            }}
          >
            Universidade
          </label>
          <select
            value={universidadeFilter}
            onChange={(e) => setUniversidadeFilter(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              border: `1px solid ${colors.border}`,
              background: colors.surfaceLight,
              color: colors.text,
              fontSize: 13,
              boxSizing: "border-box",
            }}
          >
            <option value="">Todas</option>
            {universidadesData.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={clearFilters}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: `1px solid ${colors.border}`,
            background: colors.surfaceLight,
            color: colors.textMuted,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Limpar
        </button>
      </div>

      {/* Results Count */}
      <div style={{ marginBottom: 16, fontSize: 13, color: colors.textMuted }}>
        {filtered.length > 0 ? (
          <>
            Mostrando{" "}
            <span style={{ fontWeight: 700, color: colors.text }}>
              {filtered.length}
            </span>{" "}
            match{filtered.length !== 1 ? "es" : ""} por{" "}
            <span style={{ fontWeight: 700, color: colors.green }}>score</span>
          </>
        ) : (
          matches.length === 0 &&
          "Cadastre candidatos e vagas e clique em 'Gerar Matches' para começar"
        )}
      </div>

      {/* Tabela */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  borderBottom: `1px solid ${colors.border}`,
                  background: colors.surfaceLight,
                }}
              >
                <th
                  style={{
                    padding: "14px 16px",
                    textAlign: "center",
                    fontSize: 11,
                    color: colors.textMuted,
                    fontWeight: 700,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    width: 50,
                  }}
                >
                  #
                </th>
                {["Candidato", "Universidade", "Vaga", "Associado"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "14px 16px",
                      textAlign: "left",
                      fontSize: 11,
                      color: colors.textMuted,
                      fontWeight: 700,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    {h}
                  </th>
                ))}
                <th
                  style={{
                    padding: "14px 16px",
                    textAlign: "center",
                    fontSize: 11,
                    color: colors.textMuted,
                    fontWeight: 700,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                  }}
                >
                  Score
                </th>
                <th
                  style={{
                    padding: "14px 16px",
                    textAlign: "center",
                    fontSize: 11,
                    color: colors.textMuted,
                    fontWeight: 700,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                  }}
                >
                  Prioridade
                </th>
                <th
                  style={{
                    padding: "14px 16px",
                    textAlign: "center",
                    fontSize: 11,
                    color: colors.textMuted,
                    fontWeight: 700,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                  }}
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {isGenerating &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr
                    key={`skeleton-${i}`}
                    style={{ borderBottom: `1px solid ${colors.border}` }}
                  >
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} style={{ padding: "14px 16px" }}>
                        <div
                          style={{
                            height: 12,
                            borderRadius: 6,
                            background: colors.surfaceLight,
                            animation:
                              "skeletonPulse 1.2s ease-in-out infinite",
                            width: j === 1 ? "70%" : "50%",
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}

              {!isGenerating && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    style={{ padding: "48px 16px", textAlign: "center" }}
                  >
                    {matches.length === 0 ? (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <p
                          style={{
                            color: colors.textMuted,
                            fontSize: 13,
                            margin: 0,
                          }}
                        >
                          Nenhum match candidato × vaga ainda. Cadastre
                          candidatos e vagas para começar.
                        </p>
                        <button
                          onClick={handleGenerate}
                          style={{
                            padding: "9px 16px",
                            borderRadius: 10,
                            border: "none",
                            background: colors.green,
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <Icons.Sparkles /> Gerar Matches
                        </button>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <p
                          style={{
                            color: colors.textMuted,
                            fontSize: 13,
                            margin: 0,
                          }}
                        >
                          Nenhum resultado para os filtros aplicados.
                        </p>
                        {hasFiltersActive && (
                          <button
                            onClick={clearFilters}
                            style={{
                              background: "none",
                              border: "none",
                              color: colors.blue,
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            Limpar filtros
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              )}

              {!isGenerating &&
                filtered.map((m, index) => {
                  const rank = index + 1;
                  const priority = getPriorityLabel(m.score);
                  const rowTint =
                    rank <= 3 ? `${getScoreColor(m.score)}08` : "transparent";
                  return (
                    <tr
                      key={m.id}
                      style={{
                        borderBottom: `1px solid ${colors.border}`,
                        transition: "background 0.15s",
                        background: rowTint,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = `${colors.blue}08`;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = rowTint;
                      }}
                    >
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color:
                              rank <= 3
                                ? getScoreColor(m.score)
                                : colors.textMuted,
                          }}
                        >
                          {rank}º
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: colors.text,
                          }}
                        >
                          {m.candidato?.nome || "—"}
                        </div>
                        {m.candidato?.curso && (
                          <div
                            style={{
                              fontSize: 11,
                              color: colors.textMuted,
                              marginTop: 2,
                            }}
                          >
                            {m.candidato.curso}
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "14px 16px",
                          fontSize: 12,
                          color: colors.textMuted,
                        }}
                      >
                        {m.candidato?.universidade?.nome || "—"}
                        {m.candidato?.universidade?.sigla &&
                          ` (${m.candidato.universidade.sigla})`}
                      </td>
                      <td
                        style={{
                          padding: "14px 16px",
                          fontSize: 13,
                          color: colors.text,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {m.vaga?.titulo || "—"}
                        </div>
                        {m.vaga?.modalidade && (
                          <div
                            style={{
                              fontSize: 11,
                              color: colors.textMuted,
                              marginTop: 2,
                            }}
                          >
                            {m.vaga.modalidade}
                            {m.vaga.local ? ` · ${m.vaga.local}` : ""}
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "14px 16px",
                          fontSize: 12,
                          color: colors.textMuted,
                        }}
                      >
                        {m.vaga?.associado?.nome || "—"}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 14px",
                            borderRadius: 20,
                            background: `${getScoreColor(m.score)}15`,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 14,
                              fontWeight: 800,
                              color: getScoreColor(m.score),
                            }}
                          >
                            {m.score}%
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            fontSize: 10,
                            fontWeight: 700,
                            background: priority.bg,
                            color: priority.color,
                          }}
                        >
                          {priority.label}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        {statusBadge(m.status)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ABA "MINHAS VAGAS" — PERFIL DO ASSOCIADO
// ═══════════════════════════════════════════════════════════
// CRUD de vagas que o associado logado oferece.
// Backend: POST/GET/PUT/DELETE /api/vagas
//   - Admin pode passar associadoId; associado tem o ID dele forçado
//     pelo controller (segurança).

function MinhasVagasPage({
  associadoLogado,
  vagasData = [],
  onAdd,
  onUpdate,
  onDelete,
}) {
  const meuId = associadoLogado?.id;
  const minhasVagas = (vagasData || []).filter((v) => v.associadoId === meuId);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    titulo: "",
    area: "",
    modalidade: "",
    local: "",
    descricao: "",
    requisitos: "",
    beneficios: "",
    salario: "",
    aberta: true,
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const resetForm = () =>
    setForm({
      titulo: "",
      area: "",
      modalidade: "",
      local: "",
      descricao: "",
      requisitos: "",
      beneficios: "",
      salario: "",
      aberta: true,
    });
  const openCreate = () => {
    setEditingId(null);
    resetForm();
    setShowForm(true);
  };
  const openEdit = (v) => {
    setEditingId(v.id);
    setForm({
      titulo: v.titulo || "",
      area: v.area || "",
      modalidade: v.modalidade || "",
      local: v.local || "",
      descricao: v.descricao || "",
      requisitos: v.requisitos || "",
      beneficios: v.beneficios || "",
      salario: v.salario || "",
      aberta: v.aberta !== false,
    });
    setShowForm(true);
  };
  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    resetForm();
  };

  const handleSave = async () => {
    if (!form.titulo.trim()) {
      setFeedback({ error: "Título é obrigatório." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    const fn = editingId ? onUpdate : onAdd;
    const r = editingId ? await fn(editingId, form) : await fn(form);
    setSaving(false);
    if (r?.success === false) {
      setFeedback({ error: r.error || "Falha ao salvar" });
    } else {
      setFeedback({
        success: editingId ? "Vaga atualizada." : "Vaga cadastrada.",
      });
      setTimeout(() => {
        closeForm();
        setFeedback(null);
      }, 1200);
    }
  };

  const handleToggleAberta = async (v) => {
    if (onUpdate) await onUpdate(v.id, { ...v, aberta: !v.aberta });
  };

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: colors.text,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Minhas Vagas
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            {minhasVagas.length} vaga{minhasVagas.length !== 1 ? "s" : ""}
            {minhasVagas.filter((v) => v.aberta).length > 0 &&
              ` · ${minhasVagas.filter((v) => v.aberta).length} aberta${minhasVagas.filter((v) => v.aberta).length > 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={openCreate}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          + Nova Vaga
        </button>
      </div>

      {minhasVagas.length === 0 && !showForm && (
        <div
          style={{
            background: colors.surface,
            border: `1px dashed ${colors.border}`,
            borderRadius: 14,
            padding: 48,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>💼</div>
          <h3
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 6,
            }}
          >
            Nenhuma vaga cadastrada ainda
          </h3>
          <p
            style={{ fontSize: 12, color: colors.textMuted, marginBottom: 18 }}
          >
            Cadastre uma vaga e a IA da BRATECC vai cruzar automaticamente com
            candidatos das universidades parceiras.
          </p>
          <button
            onClick={openCreate}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              border: "none",
              background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            + Criar primeira vaga
          </button>
        </div>
      )}

      {minhasVagas.length > 0 && !showForm && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 14,
          }}
        >
          {minhasVagas.map((v) => (
            <div
              key={v.id}
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderLeft: `4px solid ${v.aberta ? colors.green : colors.textMuted}`,
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: 8,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: colors.text,
                      marginBottom: 3,
                    }}
                  >
                    {v.titulo}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: colors.textMuted,
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    {v.area && <span>{v.area}</span>}
                    {v.modalidade && (
                      <>
                        <span>·</span>
                        <span>{v.modalidade}</span>
                      </>
                    )}
                    {v.local && (
                      <>
                        <span>·</span>
                        <span>📍 {v.local}</span>
                      </>
                    )}
                  </div>
                </div>
                <span
                  onClick={() => handleToggleAberta(v)}
                  title="Clique para alternar"
                  style={{
                    padding: "3px 10px",
                    borderRadius: 12,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    background: v.aberta
                      ? `${colors.green}15`
                      : `${colors.textMuted}20`,
                    color: v.aberta ? colors.green : colors.textMuted,
                    border: `1px solid ${v.aberta ? colors.green + "40" : colors.border}`,
                  }}
                >
                  {v.aberta ? "✓ Aberta" : "⏸ Pausada"}
                </span>
              </div>

              {v.descricao && (
                <div
                  style={{
                    fontSize: 12,
                    color: colors.textMuted,
                    lineHeight: 1.4,
                    marginBottom: 8,
                    maxHeight: 48,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {v.descricao}
                </div>
              )}
              {v.requisitos && (
                <div
                  style={{
                    fontSize: 11,
                    color: colors.textMuted,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Requisitos:</span>{" "}
                  {v.requisitos.length > 100
                    ? v.requisitos.substring(0, 100) + "..."
                    : v.requisitos}
                </div>
              )}
              {v.salario && (
                <div
                  style={{
                    fontSize: 11,
                    color: colors.textMuted,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Remuneração:</span>{" "}
                  {v.salario}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: `1px solid ${colors.border}`,
                }}
              >
                <button
                  onClick={() => openEdit(v)}
                  style={{
                    flex: 1,
                    padding: "7px 0",
                    borderRadius: 8,
                    border: `1px solid ${colors.border}`,
                    background: colors.surfaceLight,
                    color: colors.text,
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  Editar
                </button>
                <button
                  onClick={() => onDelete && onDelete(v.id)}
                  style={{
                    padding: "7px 14px",
                    borderRadius: 8,
                    border: `1px solid ${colors.red}30`,
                    background: `${colors.red}08`,
                    color: colors.red,
                    cursor: "pointer",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <IconTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 28,
            maxWidth: 760,
          }}
        >
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 18,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {editingId ? "Editar Vaga" : "+ Nova Vaga"}
          </h3>

          <FormField label="Título da vaga *">
            <input
              value={form.titulo}
              onChange={(e) => setForm({ ...form, titulo: e.target.value })}
              style={fld}
              placeholder="Ex: Estagiário em Tecnologia"
            />
          </FormField>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
            }}
          >
            <FormField label="Área">
              <input
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                style={fld}
                placeholder="TI, Marketing..."
              />
            </FormField>
            <FormField label="Modalidade">
              <input
                value={form.modalidade}
                onChange={(e) =>
                  setForm({ ...form, modalidade: e.target.value })
                }
                style={fld}
                placeholder="Estágio, CLT, Trainee..."
              />
            </FormField>
            <FormField label="Local">
              <input
                value={form.local}
                onChange={(e) => setForm({ ...form, local: e.target.value })}
                style={fld}
                placeholder="Houston, TX ou Remoto"
              />
            </FormField>
          </div>
          <FormField label="Descrição">
            <textarea
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              style={{
                ...fld,
                minHeight: 60,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </FormField>
          <FormField label="Requisitos (habilidades, idiomas, experiência)">
            <textarea
              value={form.requisitos}
              onChange={(e) => setForm({ ...form, requisitos: e.target.value })}
              style={{
                ...fld,
                minHeight: 60,
                resize: "vertical",
                fontFamily: "inherit",
              }}
              placeholder="Ex: React, inglês intermediário, 6º período em diante"
            />
          </FormField>
          <FormField label="Benefícios">
            <input
              value={form.beneficios}
              onChange={(e) => setForm({ ...form, beneficios: e.target.value })}
              style={fld}
              placeholder="VT, VR, Plano de saúde..."
            />
          </FormField>
          <FormField label="Salário / Remuneração">
            <input
              value={form.salario}
              onChange={(e) => setForm({ ...form, salario: e.target.value })}
              style={fld}
              placeholder="Ex: R$ 2.500 ou A combinar"
            />
          </FormField>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 12,
              fontSize: 13,
              color: colors.text,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={form.aberta}
              onChange={(e) => setForm({ ...form, aberta: e.target.checked })}
            />
            <span>Vaga aberta para receber candidatos</span>
          </label>

          {feedback?.error && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 14px",
                borderRadius: 8,
                background: `${colors.red}10`,
                color: colors.red,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {feedback.error}
            </div>
          )}
          {feedback?.success && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 14px",
                borderRadius: 8,
                background: `${colors.green}10`,
                color: colors.green,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {feedback.success}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 20,
            }}
          >
            <button
              onClick={closeForm}
              disabled={saving}
              style={{
                padding: "11px 20px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.text,
                cursor: saving ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "11px 22px",
                borderRadius: 10,
                border: "none",
                background: saving
                  ? colors.surfaceLight
                  : `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
                color: saving ? colors.textMuted : "#fff",
                cursor: saving ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {saving ? "Salvando..." : editingId ? "Atualizar" : "Cadastrar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// PORTAL DA UNIVERSIDADE
// ═══════════════════════════════════════════════════════════

function UnivDashboard({
  setPage,
  universidadeLogada,
  candidatosData = [],
  matchVagasData = [],
}) {
  const minhaUniv = universidadeLogada;
  const meuId = minhaUniv?.id;

  const meusCandidatos = (candidatosData || []).filter(
    (c) => c.universidadeId === meuId,
  );
  const meusMatches = (matchVagasData || []).filter(
    (m) => m.candidato?.universidadeId === meuId,
  );
  const matchesPorStatus = {
    pending: meusMatches.filter((m) => m.status === "PENDING").length,
    contacted: meusMatches.filter((m) => m.status === "CONTACTED").length,
    interested: meusMatches.filter((m) => m.status === "INTERESTED").length,
    confirmed: meusMatches.filter((m) => m.status === "CONFIRMED").length,
  };

  const taxaConfirmados =
    meusMatches.length > 0
      ? Math.round((matchesPorStatus.confirmed / meusMatches.length) * 100)
      : 0;

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          padding: "28px 32px",
          marginBottom: 24,
          backgroundImage: `linear-gradient(135deg, ${colors.purple}08, ${colors.blue}05)`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 4 }}>
            Bem-vinda
          </p>
          <h2
            style={{
              fontSize: 26,
              fontWeight: 800,
              color: colors.text,
              marginBottom: 8,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {minhaUniv?.nome || "Universidade"}
            {minhaUniv?.sigla ? ` (${minhaUniv.sigla})` : ""}
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted }}>
            {meusCandidatos.length} candidato
            {meusCandidatos.length !== 1 ? "s" : ""} cadastrado
            {meusCandidatos.length !== 1 ? "s" : ""}
            {meusMatches.length > 0 &&
              ` · ${meusMatches.length} match${meusMatches.length > 1 ? "es" : ""} ativo${meusMatches.length > 1 ? "s" : ""}`}
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button
              onClick={() => setPage("meus-candidatos")}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: "none",
                background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
                color: "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              Gerenciar Candidatos
            </button>
            <button
              onClick={() => setPage("univ-matches")}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Ver Matches
            </button>
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 90,
              height: 90,
              borderRadius: 20,
              background: `${colors.green}10`,
              border: `2px solid ${colors.green}30`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: colors.green,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {taxaConfirmados}%
            </span>
            <span style={{ fontSize: 10, color: colors.textMuted }}>
              Confirmados
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatCard
          label="Candidatos"
          value={meusCandidatos.length}
          color={colors.purple}
        />
        <StatCard
          label="Pendentes"
          value={matchesPorStatus.pending}
          color={colors.orange}
          delay={0.05}
        />
        <StatCard
          label="Em andamento"
          value={matchesPorStatus.contacted + matchesPorStatus.interested}
          color={colors.blue}
          delay={0.1}
        />
        <StatCard
          label="Confirmados"
          value={matchesPorStatus.confirmed}
          color={colors.green}
          delay={0.15}
        />
      </div>

      {meusCandidatos.length === 0 && (
        <div
          style={{
            background: colors.surface,
            border: `1px dashed ${colors.border}`,
            borderRadius: 14,
            padding: 48,
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              color: colors.textMuted,
              marginBottom: 8,
            }}
          >
            <Icons.User />
          </div>
          <h3
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 6,
            }}
          >
            Nenhum candidato cadastrado
          </h3>
          <p
            style={{ fontSize: 12, color: colors.textMuted, marginBottom: 18 }}
          >
            Cadastre os primeiros candidatos da sua universidade. A IA da
            BRATECC vai cruzar automaticamente com vagas dos associados.
          </p>
          <button
            onClick={() => setPage("meus-candidatos")}
            style={{
              padding: "10px 22px",
              borderRadius: 10,
              border: "none",
              background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            + Cadastrar candidato
          </button>
        </div>
      )}
    </div>
  );
}

function MeusCandidatosPage({
  universidadeLogada,
  candidatosData = [],
  onAdd,
  onUpdate,
  onDelete,
}) {
  const meuId = universidadeLogada?.id;
  const meus = (candidatosData || []).filter((c) => c.universidadeId === meuId);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [form, setForm] = useState({
    nome: "",
    email: "",
    telefone: "",
    whatsapp: "",
    curso: "",
    periodo: "",
    habilidades: "",
    experiencias: "",
    idiomas: "",
    disponibilidade: "",
    cidade: "",
    estado: "",
    curriculoUrl: "",
    ativo: true,
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const filtered = meus.filter(
    (c) =>
      !searchTerm ||
      c.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.curso || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.email || "").toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const resetForm = () =>
    setForm({
      nome: "",
      email: "",
      telefone: "",
      whatsapp: "",
      curso: "",
      periodo: "",
      habilidades: "",
      experiencias: "",
      idiomas: "",
      disponibilidade: "",
      cidade: "",
      estado: "",
      curriculoUrl: "",
      ativo: true,
    });
  const openCreate = () => {
    setEditingId(null);
    resetForm();
    setShowForm(true);
  };
  const openEdit = (c) => {
    setEditingId(c.id);
    setForm({
      nome: c.nome || "",
      email: c.email || "",
      telefone: c.telefone || "",
      whatsapp: c.whatsapp || "",
      curso: c.curso || "",
      periodo: c.periodo || "",
      habilidades: c.habilidades || "",
      experiencias: c.experiencias || "",
      idiomas: c.idiomas || "",
      disponibilidade: c.disponibilidade || "",
      cidade: c.cidade || "",
      estado: c.estado || "",
      curriculoUrl: c.curriculoUrl || "",
      ativo: c.ativo !== false,
    });
    setShowForm(true);
  };
  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    resetForm();
  };

  const handleSave = async () => {
    if (!form.nome.trim()) {
      setFeedback({ error: "Nome é obrigatório." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    const fn = editingId ? onUpdate : onAdd;
    const r = editingId ? await fn(editingId, form) : await fn(form);
    setSaving(false);
    if (r?.success === false) {
      setFeedback({ error: r.error || "Falha ao salvar" });
    } else {
      setFeedback({
        success: editingId ? "Candidato atualizado." : "Candidato cadastrado.",
      });
      setTimeout(() => {
        closeForm();
        setFeedback(null);
      }, 1200);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: colors.text,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Meus Candidatos
          </h2>
          <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
            {meus.length} candidato{meus.length !== 1 ? "s" : ""} cadastrado
            {meus.length !== 1 ? "s" : ""}
          </p>
        </div>
        {!showForm && (
          <button
            onClick={openCreate}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            + Novo Candidato
          </button>
        )}
      </div>

      {!showForm && (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              marginBottom: 24,
            }}
          >
            <StatCard label="Total" value={meus.length} color={colors.purple} />
            <StatCard
              label="Ativos"
              value={meus.filter((c) => c.ativo !== false).length}
              color={colors.green}
              delay={0.05}
            />
            <StatCard
              label="Inativos"
              value={meus.filter((c) => c.ativo === false).length}
              color={colors.textMuted}
              delay={0.1}
            />
          </div>
          <div
            style={{
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: 14,
              padding: 14,
              marginBottom: 18,
            }}
          >
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: colors.textMuted,
                  display: "flex",
                }}
              >
                <Icons.Search />
              </span>
              <input
                placeholder="Buscar por nome, curso ou e-mail..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ ...fld, paddingLeft: 38 }}
              />
            </div>
          </div>

          {filtered.length === 0 ? (
            <div
              style={{
                background: colors.surface,
                border: `1px dashed ${colors.border}`,
                borderRadius: 14,
                padding: 48,
                textAlign: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  color: colors.textMuted,
                  marginBottom: 8,
                }}
              >
                <Icons.User />
              </div>
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  color: colors.text,
                  marginBottom: 6,
                }}
              >
                {meus.length === 0
                  ? "Nenhum candidato cadastrado"
                  : "Nenhum resultado"}
              </h3>
              {meus.length === 0 && (
                <p
                  style={{
                    fontSize: 12,
                    color: colors.textMuted,
                    marginBottom: 18,
                  }}
                >
                  Cadastre o primeiro candidato pra a IA cruzar com vagas dos
                  associados.
                </p>
              )}
              {meus.length === 0 && (
                <button
                  onClick={openCreate}
                  style={{
                    padding: "10px 22px",
                    borderRadius: 10,
                    border: "none",
                    background: `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  + Cadastrar primeiro candidato
                </button>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                gap: 14,
              }}
            >
              {filtered.map((c) => (
                <div
                  key={c.id}
                  style={{
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderLeft: `4px solid ${c.ativo ? colors.purple : colors.textMuted}`,
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 800,
                          color: colors.text,
                        }}
                      >
                        {c.nome}
                      </div>
                      {c.curso && (
                        <div style={{ fontSize: 11, color: colors.textMuted }}>
                          {c.curso}
                          {c.periodo ? ` · ${c.periodo}` : ""}
                        </div>
                      )}
                    </div>
                    {c.disponibilidade && (
                      <span
                        style={{
                          padding: "3px 10px",
                          borderRadius: 12,
                          fontSize: 10,
                          fontWeight: 700,
                          background: `${colors.blue}15`,
                          color: colors.blue,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.disponibilidade}
                      </span>
                    )}
                  </div>

                  {c.habilidades && (
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.textMuted,
                        marginBottom: 6,
                        lineHeight: 1.4,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>Habilidades:</span>{" "}
                      {c.habilidades.length > 90
                        ? c.habilidades.substring(0, 90) + "..."
                        : c.habilidades}
                    </div>
                  )}
                  {c.idiomas && (
                    <div
                      style={{
                        fontSize: 11,
                        color: colors.textMuted,
                        marginBottom: 6,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>Idiomas:</span>{" "}
                      {c.idiomas}
                    </div>
                  )}

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      paddingTop: 10,
                      borderTop: `1px solid ${colors.border}`,
                      marginTop: 8,
                    }}
                  >
                    {c.email && (
                      <div
                        style={{
                          fontSize: 11,
                          color: colors.textMuted,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Icons.Mail /> {c.email}
                      </div>
                    )}
                    {(c.whatsapp || c.telefone) && (
                      <div
                        style={{
                          fontSize: 11,
                          color: colors.textMuted,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Icons.Phone /> {c.whatsapp || c.telefone}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                    <button
                      onClick={() => openEdit(c)}
                      style={{
                        flex: 1,
                        padding: "7px 0",
                        borderRadius: 8,
                        border: `1px solid ${colors.border}`,
                        background: colors.surfaceLight,
                        color: colors.text,
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => onDelete && onDelete(c.id)}
                      style={{
                        padding: "7px 14px",
                        borderRadius: 8,
                        border: `1px solid ${colors.red}30`,
                        background: `${colors.red}08`,
                        color: colors.red,
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showForm && (
        <div
          style={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 16,
            padding: 28,
            maxWidth: 820,
          }}
        >
          <h3
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: colors.text,
              marginBottom: 18,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {editingId ? "Editar Candidato" : "+ Novo Candidato"}
          </h3>

          <div
            style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}
          >
            <FormField label="Nome completo *">
              <input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                style={fld}
              />
            </FormField>
            <FormField label="Disponibilidade">
              <input
                value={form.disponibilidade}
                onChange={(e) =>
                  setForm({ ...form, disponibilidade: e.target.value })
                }
                style={fld}
                placeholder="Estágio, CLT, Remoto..."
              />
            </FormField>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
            }}
          >
            <FormField label="E-mail">
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                style={fld}
                type="email"
              />
            </FormField>
            <FormField label="Telefone">
              <input
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: e.target.value })}
                style={fld}
              />
            </FormField>
            <FormField label="WhatsApp">
              <input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                style={fld}
              />
            </FormField>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}
          >
            <FormField label="Curso">
              <input
                value={form.curso}
                onChange={(e) => setForm({ ...form, curso: e.target.value })}
                style={fld}
                placeholder="Engenharia de Software, Administração..."
              />
            </FormField>
            <FormField label="Período / Status">
              <input
                value={form.periodo}
                onChange={(e) => setForm({ ...form, periodo: e.target.value })}
                style={fld}
                placeholder="8º semestre ou Graduado 2024"
              />
            </FormField>
          </div>
          <FormField label="Habilidades">
            <textarea
              value={form.habilidades}
              onChange={(e) =>
                setForm({ ...form, habilidades: e.target.value })
              }
              style={{
                ...fld,
                minHeight: 60,
                resize: "vertical",
                fontFamily: "inherit",
              }}
              placeholder="Ex: React, Node.js, Python, comunicação interpessoal"
            />
          </FormField>
          <FormField label="Experiências profissionais (resumo)">
            <textarea
              value={form.experiencias}
              onChange={(e) =>
                setForm({ ...form, experiencias: e.target.value })
              }
              style={{
                ...fld,
                minHeight: 80,
                resize: "vertical",
                fontFamily: "inherit",
              }}
              placeholder="Estágio em empresa X (6 meses), projetos acadêmicos..."
            />
          </FormField>
          <FormField label="Idiomas">
            <input
              value={form.idiomas}
              onChange={(e) => setForm({ ...form, idiomas: e.target.value })}
              style={fld}
              placeholder="Português nativo, Inglês avançado, Espanhol básico"
            />
          </FormField>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 2fr",
              gap: 14,
            }}
          >
            <FormField label="Cidade">
              <input
                value={form.cidade}
                onChange={(e) => setForm({ ...form, cidade: e.target.value })}
                style={fld}
              />
            </FormField>
            <FormField label="Estado">
              <input
                value={form.estado}
                onChange={(e) => setForm({ ...form, estado: e.target.value })}
                style={fld}
                maxLength={2}
              />
            </FormField>
            <FormField label="Currículo (URL externo: LinkedIn, Drive)">
              <input
                value={form.curriculoUrl}
                onChange={(e) =>
                  setForm({ ...form, curriculoUrl: e.target.value })
                }
                style={fld}
                placeholder="https://..."
              />
            </FormField>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 12,
              fontSize: 13,
              color: colors.text,
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
            />
            <span>Candidato ativo (disponível para matches)</span>
          </label>

          {feedback?.error && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 14px",
                borderRadius: 8,
                background: `${colors.red}10`,
                color: colors.red,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {feedback.error}
            </div>
          )}
          {feedback?.success && (
            <div
              style={{
                marginTop: 14,
                padding: "10px 14px",
                borderRadius: 8,
                background: `${colors.green}10`,
                color: colors.green,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {feedback.success}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 20,
            }}
          >
            <button
              onClick={closeForm}
              disabled={saving}
              style={{
                padding: "11px 20px",
                borderRadius: 10,
                border: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
                color: colors.text,
                cursor: saving ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "11px 22px",
                borderRadius: 10,
                border: "none",
                background: saving
                  ? colors.surfaceLight
                  : `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
                color: saving ? colors.textMuted : "#fff",
                cursor: saving ? "wait" : "pointer",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {saving ? "Salvando..." : editingId ? "Atualizar" : "Cadastrar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UnivMatchesPage({ universidadeLogada, matchVagasData = [] }) {
  const meuId = universidadeLogada?.id;
  const meus = (matchVagasData || []).filter(
    (m) => m.candidato?.universidadeId === meuId,
  );

  const [statusFilter, setStatusFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = meus.filter((m) => {
    const cand = m.candidato?.nome || "";
    const vaga = m.vaga?.titulo || "";
    const assoc = m.vaga?.associado?.nome || "";
    const matchSearch =
      !searchTerm ||
      cand.toLowerCase().includes(searchTerm.toLowerCase()) ||
      vaga.toLowerCase().includes(searchTerm.toLowerCase()) ||
      assoc.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = !statusFilter || m.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const statusBadge = (status) => {
    const map = {
      PENDING: {
        label: "Pendente",
        bg: `${colors.orange}15`,
        color: colors.orange,
      },
      CONTACTED: {
        label: "Contatado",
        bg: `${colors.purple}15`,
        color: colors.purple,
      },
      INTERESTED: {
        label: "Interessado",
        bg: `${colors.blue}15`,
        color: colors.blue,
      },
      CONFIRMED: {
        label: "Confirmado",
        bg: `${colors.green}15`,
        color: colors.green,
      },
      REJECTED: {
        label: "Rejeitado",
        bg: `${colors.red}15`,
        color: colors.red,
      },
    };
    const cfg = map[status] || map.PENDING;
    return (
      <span
        style={{
          padding: "4px 10px",
          borderRadius: 6,
          fontSize: 10,
          fontWeight: 700,
          background: cfg.bg,
          color: cfg.color,
        }}
      >
        {cfg.label}
      </span>
    );
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: colors.text,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Matches dos Meus Candidatos
        </h2>
        <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
          {meus.length} match{meus.length !== 1 ? "es" : ""} entre seus
          candidatos e vagas dos associados
        </p>
      </div>

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: 14,
          marginBottom: 18,
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 14,
        }}
      >
        <input
          placeholder="🔍 Buscar candidato, vaga ou associado..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={fld}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={fld}
        >
          <option value="">Todos os status</option>
          <option value="PENDING">Pendentes</option>
          <option value="CONTACTED">Contatados</option>
          <option value="INTERESTED">Interessados</option>
          <option value="CONFIRMED">Confirmados</option>
          <option value="REJECTED">Rejeitados</option>
        </select>
      </div>

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                borderBottom: `1px solid ${colors.border}`,
                background: colors.surfaceLight,
              }}
            >
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Candidato
              </th>
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Vaga
              </th>
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Associado
              </th>
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "center",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Score
              </th>
              <th
                style={{
                  padding: "14px 16px",
                  textAlign: "center",
                  fontSize: 11,
                  color: colors.textMuted,
                  fontWeight: 700,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                }}
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    padding: "40px 16px",
                    textAlign: "center",
                    color: colors.textMuted,
                    fontSize: 13,
                  }}
                >
                  {meus.length === 0
                    ? "Nenhum match ainda. Cadastre candidatos pra a IA cruzar com vagas."
                    : "Nenhum resultado para os filtros aplicados."}
                </td>
              </tr>
            )}
            {filtered.map((m) => (
              <tr
                key={m.id}
                style={{ borderBottom: `1px solid ${colors.border}` }}
              >
                <td style={{ padding: "14px 16px" }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: colors.text,
                    }}
                  >
                    {m.candidato?.nome || "—"}
                  </div>
                  {m.candidato?.curso && (
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {m.candidato.curso}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: "14px 16px",
                    fontSize: 13,
                    color: colors.text,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{m.vaga?.titulo || "—"}</div>
                  {m.vaga?.modalidade && (
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      {m.vaga.modalidade}
                      {m.vaga.local ? ` · ${m.vaga.local}` : ""}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: "14px 16px",
                    fontSize: 12,
                    color: colors.textMuted,
                  }}
                >
                  {m.vaga?.associado?.nome || "—"}
                </td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color:
                        m.score >= 80
                          ? colors.green
                          : m.score >= 60
                            ? colors.blue
                            : colors.orange,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {m.score}%
                  </span>
                </td>
                <td style={{ padding: "14px 16px", textAlign: "center" }}>
                  {statusBadge(m.status)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MeuPerfilUnivPage({ universidadeLogada, onUpdate }) {
  const u = universidadeLogada;
  const [form, setForm] = useState({
    nome: u?.nome || "",
    sigla: u?.sigla || "",
    cidade: u?.cidade || "",
    estado: u?.estado || "",
    email: u?.email || "",
    telefone: u?.telefone || "",
    responsavel: u?.responsavel || "",
    descricao: u?.descricao || "",
  });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fld = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${colors.border}`,
    background: colors.surfaceLight,
    color: colors.text,
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const handleSave = async () => {
    if (!form.nome.trim()) {
      setFeedback({ error: "Nome é obrigatório." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    const r = await onUpdate(u.id, form);
    setSaving(false);
    if (r?.success === false) {
      setFeedback({ error: r.error || "Falha ao salvar" });
    } else {
      setFeedback({ success: "Perfil atualizado." });
      setTimeout(() => setFeedback(null), 2500);
    }
  };

  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: colors.text,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Meu Perfil
        </h2>
        <p style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>
          Dados da sua universidade no sistema BRATECC
        </p>
      </div>

      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 16,
          padding: 28,
          maxWidth: 760,
        }}
      >
        <div
          style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}
        >
          <FormField label="Nome *">
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              style={fld}
            />
          </FormField>
          <FormField label="Sigla">
            <input
              value={form.sigla}
              onChange={(e) => setForm({ ...form, sigla: e.target.value })}
              style={fld}
            />
          </FormField>
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}
        >
          <FormField label="Cidade">
            <input
              value={form.cidade}
              onChange={(e) => setForm({ ...form, cidade: e.target.value })}
              style={fld}
            />
          </FormField>
          <FormField label="Estado">
            <input
              value={form.estado}
              onChange={(e) => setForm({ ...form, estado: e.target.value })}
              style={fld}
              maxLength={2}
            />
          </FormField>
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          <FormField label="E-mail">
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              style={fld}
            />
          </FormField>
          <FormField label="Telefone">
            <input
              value={form.telefone}
              onChange={(e) => setForm({ ...form, telefone: e.target.value })}
              style={fld}
            />
          </FormField>
        </div>
        <FormField label="Responsável">
          <input
            value={form.responsavel}
            onChange={(e) => setForm({ ...form, responsavel: e.target.value })}
            style={fld}
          />
        </FormField>
        <FormField label="Descrição">
          <textarea
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            style={{
              ...fld,
              minHeight: 80,
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </FormField>

        {feedback?.error && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 8,
              background: `${colors.red}10`,
              color: colors.red,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {feedback.error}
          </div>
        )}
        {feedback?.success && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              borderRadius: 8,
              background: `${colors.green}10`,
              color: colors.green,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {feedback.success}
          </div>
        )}

        <div
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}
        >
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: "11px 22px",
              borderRadius: 10,
              border: "none",
              background: saving
                ? colors.surfaceLight
                : `linear-gradient(135deg, ${colors.purple}, ${colors.blue})`,
              color: saving ? colors.textMuted : "#fff",
              cursor: saving ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {saving ? "Salvando..." : "✓ Salvar Alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// ─── AI PRIORITY BADGE ───
// ═══════════════════════════════════════
function PriorityBadge({ prioridade, showLabel = true }) {
  const config = {
    alta: {
      emoji: "🔥",
      label: "Alta",
      color: "#ef4444",
      bg: "rgba(239,68,68,0.1)",
    },
    media: {
      emoji: "⚡",
      label: "Média",
      color: "#f97316",
      bg: "rgba(249,115,22,0.1)",
    },
    baixa: {
      emoji: "❄️",
      label: "Baixa",
      color: "#06b6d4",
      bg: "rgba(6,182,212,0.1)",
    },
  };

  const p = config[prioridade] || config.media;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        background: p.bg,
        color: p.color,
        border: `1px solid ${p.color}25`,
      }}
    >
      {p.emoji} {showLabel && p.label}
    </span>
  );
}

// ═══════════════════════════════════════
// ─── AI CHAT WIDGET ───
// ═══════════════════════════════════════
// ═══════════════════════════════════════
// ─── AI MATCHING ENGINE ───
// Motor de IA para geração automática de matches
// ═══════════════════════════════════════

const AIMatchingEngine = {
  // Palavras-chave por categoria para matching
  keywords: {
    finance: [
      "trade finance",
      "financiamento",
      "crédito",
      "seguro",
      "hedge",
      "câmbio",
      "banking",
      "investimento",
      "capital",
    ],
    logistics: [
      "logística",
      "frete",
      "transporte",
      "desembaraço",
      "aduaneiro",
      "customs",
      "shipping",
      "armazenagem",
      "supply chain",
    ],
    legal: [
      "jurídico",
      "legal",
      "compliance",
      "contrato",
      "regulatório",
      "due diligence",
      "advisory",
    ],
    technology: [
      "tecnologia",
      "software",
      "ti",
      "cloud",
      "saas",
      "sistema",
      "digital",
      "automação",
      "erp",
    ],
    energy: [
      "energia",
      "solar",
      "eólica",
      "petróleo",
      "gás",
      "oil",
      "power",
      "renewables",
    ],
    food: [
      "alimentos",
      "food",
      "bebidas",
      "agro",
      "café",
      "açúcar",
      "grãos",
      "carnes",
    ],
    industry: [
      "industrial",
      "manufatura",
      "máquinas",
      "equipamentos",
      "peças",
      "automação",
    ],
  },

  // Extrair palavras-chave de um texto
  extractKeywords(text) {
    if (!text) return [];
    const normalized = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const words = [];

    Object.entries(this.keywords).forEach(([category, terms]) => {
      terms.forEach((term) => {
        if (normalized.includes(term.toLowerCase())) {
          words.push({ term, category, weight: 1 });
        }
      });
    });

    return words;
  },

  // Calcular similaridade entre dois conjuntos de keywords
  calculateKeywordSimilarity(keywords1, keywords2) {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;

    let matches = 0;
    let categoryMatches = 0;

    keywords1.forEach((k1) => {
      keywords2.forEach((k2) => {
        if (k1.term === k2.term) matches += 2;
        if (k1.category === k2.category) categoryMatches += 0.5;
      });
    });

    const maxPossible = Math.max(keywords1.length, keywords2.length) * 2;
    return Math.min(100, ((matches + categoryMatches) / maxPossible) * 100);
  },

  // Analisar compatibilidade Exportador/Importador
  analyzeTradeCompatibility(empresa, associado) {
    let score = 0;
    const reasons = [];

    // Tipo de empresa vs serviços do associado
    const empresaTipo = (empresa.tipo || "").toLowerCase();
    const assocServicos = (
      associado.servicos ||
      associado.produtosOferecidos ||
      ""
    ).toLowerCase();

    if (empresaTipo.includes("exportador")) {
      if (
        assocServicos.includes("export") ||
        assocServicos.includes("trade finance") ||
        assocServicos.includes("logística") ||
        assocServicos.includes("desembaraço")
      ) {
        score += 25;
        reasons.push("Serviços adequados para exportação");
      }
    }

    if (empresaTipo.includes("importador")) {
      if (
        assocServicos.includes("import") ||
        assocServicos.includes("customs") ||
        assocServicos.includes("desembaraço") ||
        assocServicos.includes("logística")
      ) {
        score += 25;
        reasons.push("Serviços adequados para importação");
      }
    }

    return { score, reasons };
  },

  // Analisar match de produtos (Oferecidos vs Demandados)
  analyzeProductMatch(empresa, associado) {
    let score = 0;
    const reasons = [];

    // O que a empresa precisa vs o que o associado oferece
    const empresaNecessidades = (
      empresa.produtosDemandados ||
      empresa.necessidades ||
      ""
    ).toLowerCase();
    const assocOfertas = (
      associado.produtosOferecidos ||
      associado.servicos ||
      ""
    ).toLowerCase();

    const necessidadesKw = this.extractKeywords(empresaNecessidades);
    const ofertasKw = this.extractKeywords(assocOfertas);

    const similarity = this.calculateKeywordSimilarity(
      necessidadesKw,
      ofertasKw,
    );
    score = similarity * 0.4; // Peso de 40% para match de produtos

    if (similarity > 50) {
      reasons.push("Alta aderência entre necessidades e ofertas");
    } else if (similarity > 25) {
      reasons.push("Aderência parcial de produtos/serviços");
    }

    return { score, reasons };
  },

  // Analisar similaridade de segmento
  analyzeSegmentMatch(empresa, associado) {
    let score = 0;
    const reasons = [];

    const empresaSetor = (
      empresa.segmento ||
      empresa.setor ||
      ""
    ).toLowerCase();
    const assocSegmento = (associado.segmento || "").toLowerCase();

    // Match direto de segmento
    if (empresaSetor && assocSegmento) {
      const setorKw = this.extractKeywords(empresaSetor);
      const segmentoKw = this.extractKeywords(assocSegmento);

      // Verificar se há categorias em comum
      const empresaCats = new Set(setorKw.map((k) => k.category));
      const assocCats = new Set(segmentoKw.map((k) => k.category));

      let commonCats = 0;
      empresaCats.forEach((c) => {
        if (assocCats.has(c)) commonCats++;
      });

      if (commonCats > 0) {
        score += 20;
        reasons.push("Segmentos complementares");
      }
    }

    // Bonus para associados de serviços genéricos (finance, legal, logistics)
    const genericServices = ["financial", "legal", "logistics", "technology"];
    genericServices.forEach((service) => {
      if (assocSegmento.includes(service)) {
        score += 5;
      }
    });

    return { score, reasons };
  },

  // Gerar match completo entre empresa e associado
  generateMatch(empresa, associado) {
    const tradeAnalysis = this.analyzeTradeCompatibility(empresa, associado);
    const productAnalysis = this.analyzeProductMatch(empresa, associado);
    const segmentAnalysis = this.analyzeSegmentMatch(empresa, associado);

    // Score total
    let totalScore =
      tradeAnalysis.score + productAnalysis.score + segmentAnalysis.score;

    // Bonus por informações completas
    if (empresa.produtosDemandados && associado.produtosOferecidos) {
      totalScore += 5;
    }

    // Score base mínimo de 50 — garante que todo par empresa×associado vira
    // match (exploratório). Se o algoritmo identificou sinais reais, sobe acima
    // disso. Sem isso, cadastros com campos vazios ou genéricos teriam score 0
    // e seriam descartados, impossibilitando teste com dados mínimos.
    if (totalScore < 50) {
      totalScore = 50;
    }

    // Normalizar para 0-100
    totalScore = Math.min(100, Math.max(0, Math.round(totalScore)));

    // Combinar razões
    const allReasons = [
      ...tradeAnalysis.reasons,
      ...productAnalysis.reasons,
      ...segmentAnalysis.reasons,
    ];
    if (allReasons.length === 0) {
      allReasons.push("Match exploratório — perfis a explorar");
    }

    // Determinar prioridade
    let prioridade = "baixa";
    if (totalScore >= 80) prioridade = "alta";
    else if (totalScore >= 60) prioridade = "media";

    // Identificar produto/serviço principal
    const empresaNecessidades =
      empresa.produtosDemandados || empresa.necessidades || "";
    const assocOfertas =
      associado.produtosOferecidos || associado.servicos || "";

    // Encontrar serviço mais relevante
    let produto = "";
    const ofertasKw = this.extractKeywords(assocOfertas);
    const necessidadesKw = this.extractKeywords(empresaNecessidades);

    for (const oferta of ofertasKw) {
      for (const necessidade of necessidadesKw) {
        if (oferta.category === necessidade.category) {
          produto = oferta.term.charAt(0).toUpperCase() + oferta.term.slice(1);
          break;
        }
      }
      if (produto) break;
    }

    if (!produto && ofertasKw.length > 0) {
      produto =
        ofertasKw[0].term.charAt(0).toUpperCase() + ofertasKw[0].term.slice(1);
    }

    return {
      empresaId: empresa.id,
      associadoId: associado.id,
      empresa: empresa.nome,
      associado: associado.nome,
      cidade: `${empresa.cidade || ""}${empresa.estado ? ", " + empresa.estado : ""}`,
      setor: empresa.segmento || empresa.setor,
      score: totalScore,
      prioridade,
      produto: produto || associado.segmento || "Conexão comercial",
      status: "Pending",
      analiseIA: {
        tradeScore: tradeAnalysis.score,
        productScore: productAnalysis.score,
        segmentScore: segmentAnalysis.score,
        reasons: allReasons,
        generatedAt: new Date().toISOString(),
      },
    };
  },

  // Gerar todos os matches para uma empresa
  generateMatchesForEmpresa(empresa, associados) {
    const matches = [];

    associados.forEach((associado) => {
      const match = this.generateMatch(empresa, associado);
      // Threshold zero: todo par vira match. O score base de 50 do generateMatch
      // garante que mesmo perfis vazios entrem na lista (admin pode rejeitar depois).
      matches.push(match);
    });

    // Ordenar por score decrescente
    return matches.sort(
      (a, b) =>
        (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score),
    );
  },

  // Gerar todos os matches para um associado
  generateMatchesForAssociado(associado, empresas) {
    const matches = [];

    empresas.forEach((empresa) => {
      const match = this.generateMatch(empresa, associado);
      matches.push(match);
    });

    return matches.sort(
      (a, b) =>
        (b.score == null ? -1 : b.score) - (a.score == null ? -1 : a.score),
    );
  },

  // Gerar matches B2B entre associados
  generateB2BMatch(associado1, associado2) {
    if (associado1.id === associado2.id) return null;

    let score = 0;
    const reasons = [];

    // O que um oferece vs o que outro demanda
    const ofertas1 = (
      associado1.produtosOferecidos ||
      associado1.servicos ||
      ""
    ).toLowerCase();
    const demandas1 = (associado1.produtosDemandados || "").toLowerCase();
    const ofertas2 = (
      associado2.produtosOferecidos ||
      associado2.servicos ||
      ""
    ).toLowerCase();
    const demandas2 = (associado2.produtosDemandados || "").toLowerCase();

    // Ofertas de 1 atendem demandas de 2?
    const kw1Ofertas = this.extractKeywords(ofertas1);
    const kw2Demandas = this.extractKeywords(demandas2);
    const match1to2 = this.calculateKeywordSimilarity(kw1Ofertas, kw2Demandas);

    // Ofertas de 2 atendem demandas de 1?
    const kw2Ofertas = this.extractKeywords(ofertas2);
    const kw1Demandas = this.extractKeywords(demandas1);
    const match2to1 = this.calculateKeywordSimilarity(kw2Ofertas, kw1Demandas);

    score = (match1to2 + match2to1) / 2;

    // Sinergia de segmentos diferentes mas complementares
    const seg1 = (associado1.segmento || "").toLowerCase();
    const seg2 = (associado2.segmento || "").toLowerCase();

    const complementaryPairs = [
      ["financial", "logistics"],
      ["financial", "legal"],
      ["logistics", "legal"],
      ["technology", "logistics"],
      ["technology", "financial"],
    ];

    complementaryPairs.forEach(([s1, s2]) => {
      if (
        (seg1.includes(s1) && seg2.includes(s2)) ||
        (seg1.includes(s2) && seg2.includes(s1))
      ) {
        score += 15;
        reasons.push(
          `Sinergia ${s1.charAt(0).toUpperCase() + s1.slice(1)} + ${s2.charAt(0).toUpperCase() + s2.slice(1)}`,
        );
      }
    });

    score = Math.min(100, Math.round(score));

    if (score < 40) return null;

    return {
      associado1: associado1.nome,
      associado2: associado2.nome,
      score,
      servico1: associado1.segmento,
      servico2: associado2.segmento,
      sinergia: reasons.join(", ") || "Serviços complementares",
      status: "Pending",
    };
  },
};

// ═══════════════════════════════════════
// ─── AI ACTIONS MODAL ───
// ═══════════════════════════════════════
function AIActionsModal({ isOpen, onClose, type, item, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setResult(null);
      setError(null);
    }
  }, [isOpen]);

  const handleClassificar = async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint =
        type === "empresa"
          ? `/ai/classificar/empresa/${item.id}`
          : `/ai/classificar/associado/${item.id}`;
      const response = await api.post(endpoint);
      setResult(response);
      onSuccess && onSuccess(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGerarMatches = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.post(`/ai/matches/${item.id}`);
      setResult(response);
      onSuccess && onSuccess(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: colors.surface,
          borderRadius: 16,
          width: "100%",
          maxWidth: 600,
          maxHeight: "80vh",
          overflow: "hidden",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Icons.Brain />
            <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>
              Ações de IA - {item?.nome}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "none",
              borderRadius: "50%",
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: "#fff",
            }}
          >
            <Icons.X />
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            padding: 20,
            overflowY: "auto",
            maxHeight: "calc(80vh - 60px)",
          }}
        >
          {!result && !error && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button
                onClick={handleClassificar}
                disabled={loading}
                style={{
                  padding: "16px 20px",
                  borderRadius: 12,
                  border: `1px solid ${colors.purple}30`,
                  background: `${colors.purple}08`,
                  cursor: loading ? "wait" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: `${colors.purple}15`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: colors.purple,
                  }}
                >
                  <Icons.Sparkles />
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: colors.text,
                    }}
                  >
                    🔍 Classificar com IA
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: colors.textMuted,
                      marginTop: 2,
                    }}
                  >
                    Gera perfil estruturado com CNAE/NAICS, NCM, palavras-chave
                  </div>
                </div>
              </button>

              {type === "empresa" && (
                <button
                  onClick={handleGerarMatches}
                  disabled={loading}
                  style={{
                    padding: "16px 20px",
                    borderRadius: 12,
                    border: `1px solid ${colors.green}30`,
                    background: `${colors.green}08`,
                    cursor: loading ? "wait" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    textAlign: "left",
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: `${colors.green}15`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: colors.green,
                    }}
                  >
                    <Icons.Zap />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: colors.text,
                      }}
                    >
                      ⚡ Gerar Matches Inteligentes
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: colors.textMuted,
                        marginTop: 2,
                      }}
                    >
                      Cruza com associados e gera matches com score de
                      prioridade
                    </div>
                  </div>
                </button>
              )}

              {loading && (
                <div style={{ textAlign: "center", padding: 20 }}>
                  <div
                    style={{
                      fontSize: 32,
                      marginBottom: 12,
                      animation: "pulse 1.5s infinite",
                    }}
                  >
                    🤖
                  </div>
                  <div style={{ fontSize: 14, color: colors.textMuted }}>
                    Processando com IA...
                  </div>
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              style={{
                background: `${colors.red}10`,
                border: `1px solid ${colors.red}25`,
                borderRadius: 12,
                padding: 16,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>❌</div>
              <div style={{ fontSize: 14, color: colors.red, fontWeight: 600 }}>
                Erro
              </div>
              <div
                style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}
              >
                {error}
              </div>
              <button
                onClick={() => setError(null)}
                style={{
                  marginTop: 12,
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: colors.surfaceLight,
                  color: colors.text,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Tentar novamente
              </button>
            </div>
          )}

          {result && (
            <div>
              <div
                style={{
                  background: `${colors.green}10`,
                  border: `1px solid ${colors.green}25`,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <span style={{ fontSize: 20 }}>✅</span>
                  <span
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: colors.green,
                    }}
                  >
                    {result.totalMatches !== undefined
                      ? `${result.totalMatches} matches gerados!`
                      : "Classificação concluída!"}
                  </span>
                </div>
                {result.resumo && (
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      flexWrap: "wrap",
                      marginTop: 12,
                    }}
                  >
                    {Object.entries(result.resumo).map(([key, value]) => (
                      <div
                        key={key}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          background: colors.surface,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {key}: {value}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {result.classificacao && (
                <div
                  style={{
                    background: colors.surfaceLight,
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: colors.text,
                      marginBottom: 12,
                    }}
                  >
                    📊 Classificação Detalhada
                  </div>
                  <pre
                    style={{
                      fontSize: 11,
                      color: colors.textMuted,
                      overflow: "auto",
                      maxHeight: 300,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {JSON.stringify(result.classificacao, null, 2)}
                  </pre>
                </div>
              )}

              {result.matches && result.matches.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: colors.text,
                      marginBottom: 12,
                    }}
                  >
                    🎯 Matches Gerados
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 8 }}
                  >
                    {result.matches.slice(0, 5).map((m, i) => (
                      <div
                        key={i}
                        style={{
                          background: colors.surfaceLight,
                          borderRadius: 10,
                          padding: 12,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: colors.text,
                            }}
                          >
                            {m.associado?.nome || "Associado"}
                          </div>
                          <div
                            style={{ fontSize: 11, color: colors.textMuted }}
                          >
                            {m.produto}
                          </div>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <PriorityBadge prioridade={m.prioridade || "media"} />
                          <ScoreCircle score={m.score} size={36} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════
// ─── LOGIN PAGE ───
// ═══════════════════════
function LoginPage({ onLogin, associados = [] }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    if (!email.trim() || !senha.trim()) {
      setError("Preencha e-mail e senha");
      return;
    }
    setLoading(true);

    try {
      const response = await api.post("/auth/login", { email, senha });

      if (response && response.token) {
        api.setToken(response.token);

        const userRole = (response.user?.role || "").toLowerCase();
        if (userRole === "admin") {
          onLogin("admin", null, response.token);
        } else if (userRole === "universidade" && response.user?.universidade) {
          onLogin(
            "universidade",
            null,
            response.token,
            response.user.universidade,
          );
        } else if (response.user?.associado) {
          onLogin("associado", response.user.associado, response.token);
        } else {
          onLogin(
            "associado",
            {
              id: response.user?.id,
              nome: "Associado",
              email: response.user?.email,
            },
            response.token,
          );
        }
        return;
      }

      // Resposta inesperada do servidor
      setError("Resposta inválida do servidor.");
    } catch (err) {
      console.error("Erro no login:", err);
      if (err.status === 401) {
        setError("E-mail ou senha inválidos");
      } else if (
        err.message?.includes("Failed to fetch") ||
        err.message?.includes("NetworkError")
      ) {
        setError(
          "Não foi possível conectar ao servidor. Verifique se o backend está rodando.",
        );
      } else {
        setError(err.message || "Erro ao fazer login");
      }
    }

    setLoading(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100vw",
        background: "#1E1F36",
        display: "flex",
        fontFamily: "'Segoe UI', -apple-system, sans-serif",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap');
        /* Reset global: evita scroll horizontal na tela de login por margem do body */
        html, body, #root { margin: 0; padding: 0; width: 100%; overflow-x: hidden; }
        *, *::before, *::after { box-sizing: border-box; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes float { 0%,100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        /* Scrollbar sutil para o formulário (quando a tela é muito baixa) */
        .login-form-side::-webkit-scrollbar { width: 6px; }
        .login-form-side::-webkit-scrollbar-track { background: transparent; }
        .login-form-side::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
        .login-form-side::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
        @media (max-width: 900px) {
          .login-branding-side { display: none !important; }
          .login-form-side {
            width: 100% !important;
            padding: 32px 24px !important;
            min-height: 100vh;
          }
        }
      `}</style>

      {/* Left Side - Branding (esconde em mobile) */}
      <div
        className="login-branding-side"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
          position: "relative",
          overflow: "hidden",
          minWidth: 0,
        }}
      >
        {/* Background Pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.03,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "10%",
              left: "10%",
              width: 300,
              height: 300,
              borderRadius: "50%",
              border: "1px solid #fff",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "60%",
              right: "5%",
              width: 200,
              height: 200,
              borderRadius: "50%",
              border: "1px solid #fff",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "10%",
              left: "20%",
              width: 150,
              height: 150,
              borderRadius: "50%",
              border: "1px solid #fff",
            }}
          />
        </div>

        {/* Logo */}
        <div
          style={{
            textAlign: "center",
            animation: "fadeIn 0.8s ease-out",
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 900,
              letterSpacing: 4,
              lineHeight: 1.1,
              marginBottom: 24,
            }}
          >
            <span style={{ fontSize: 52, color: "#ffffff", display: "block" }}>
              BRATECC
            </span>
            <span style={{ fontSize: 52, color: "#c41e3a", display: "block" }}>
              CONNEX
            </span>
          </div>
          <div
            style={{
              width: 60,
              height: 3,
              background: "linear-gradient(90deg, #c41e3a, #ffffff)",
              margin: "0 auto 24px",
              borderRadius: 2,
            }}
          />
          <p
            style={{
              fontSize: 16,
              color: "rgba(255,255,255,0.6)",
              maxWidth: 320,
              lineHeight: 1.6,
            }}
          >
            Sistema Inteligente de Conexões Comerciais Brasil-Texas
          </p>
        </div>

        {/* Footer */}
        <div
          style={{
            position: "absolute",
            bottom: 24,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
            Desenvolvido por
          </span>
          <img
            src="https://atlantyx.io/wp-content/uploads/2025/06/img-atx-logo-w.png"
            alt="Atlantyx"
            style={{ height: 14, opacity: 0.4 }}
          />
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div
        className="login-form-side"
        style={{
          width: 480,
          flexShrink: 0,
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "48px 56px",
          animation: "fadeIn 0.6s ease-out",
          overflowY: "auto",
          maxHeight: "100vh",
        }}
      >
        <div style={{ marginBottom: 36 }}>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#1E1F36",
              marginBottom: 8,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            Bem-vindo
          </h1>
          <p style={{ fontSize: 14, color: "#6b7280" }}>
            Faça login para acessar o sistema
          </p>
        </div>

        {/* Form */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", marginBottom: 20 }}>
            <span
              style={{
                fontSize: 13,
                color: "#374151",
                fontWeight: 600,
                display: "block",
                marginBottom: 8,
              }}
            >
              Email
            </span>
            <input
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 10,
                border: "2px solid #e5e7eb",
                background: "#ffffff",
                color: "#1E1F36",
                fontSize: 15,
                outline: "none",
                boxSizing: "border-box",
                transition: "all 0.2s",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#1E1F36";
                e.target.style.boxShadow = "0 0 0 3px rgba(30,31,54,0.1)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#e5e7eb";
                e.target.style.boxShadow = "none";
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 24 }}>
            <span
              style={{
                fontSize: 13,
                color: "#374151",
                fontWeight: 600,
                display: "block",
                marginBottom: 8,
              }}
            >
              Senha
            </span>
            <input
              type="password"
              placeholder="••••••••"
              value={senha}
              onChange={(e) => {
                setSenha(e.target.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              style={{
                width: "100%",
                padding: "14px 16px",
                borderRadius: 10,
                border: "2px solid #e5e7eb",
                background: "#ffffff",
                color: "#1E1F36",
                fontSize: 15,
                outline: "none",
                boxSizing: "border-box",
                transition: "all 0.2s",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "#1E1F36";
                e.target.style.boxShadow = "0 0 0 3px rgba(30,31,54,0.1)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "#e5e7eb";
                e.target.style.boxShadow = "none";
              }}
            />
          </label>

          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 20,
              }}
            >
              <span style={{ fontSize: 13, color: "#dc2626", fontWeight: 500 }}>
                <IconAlert /> {error}
              </span>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading}
            style={{
              width: "100%",
              padding: "16px 0",
              borderRadius: 12,
              border: "none",
              background: "#1E1F36",
              color: "#fff",
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? "wait" : "pointer",
              opacity: loading ? 0.7 : 1,
              transition: "all 0.2s",
              fontFamily: "'JetBrains Mono', monospace",
            }}
            onMouseOver={(e) => {
              if (!loading) e.target.style.background = "#2d2e4a";
            }}
            onMouseOut={(e) => {
              e.target.style.background = "#1E1F36";
            }}
          >
            {loading ? "Entrando..." : "Entrar →"}
          </button>
        </div>

        {/* Help Text */}
        <p
          style={{
            fontSize: 11,
            color: "#9ca3af",
            textAlign: "center",
            marginTop: 24,
            lineHeight: 1.6,
          }}
        >
          Novos associados recebem credenciais ao serem cadastrados pelo
          administrador
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ─── INSCRIÇÃO PÚBLICA (página acessível sem login) ───
// ═══════════════════════════════════════════════════════════════
// URL: /inscricao/:slug
// Empresa preenche formulário e fica restrita a este evento (eventoOrigemId).
// Carrega scripts de captcha (Google reCAPTCHA v3 ou Cloudflare Turnstile)
// DINAMICAMENTE quando o backend informa que o captcha está ativo.
// ═══════════════════════════════════════════════════════════════
function InscricaoPublicaPage({ slug }) {
  const [loading, setLoading] = useState(true);
  const [evento, setEvento] = useState(null);
  const [erro, setErro] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    nome: "",
    setor: "",
    porte: "Médio",
    cidade: "",
    estado: "",
    pais: "Brasil",
    tipo: "EXPORTADOR",
    email: "",
    telefone: "",
    descricao: "",
    necessidades: "",
  });
  const [errors, setErrors] = useState({});
  const [itemsOferecidos, setItemsOferecidos] = useState([]);
  const [itemsDemandados, setItemsDemandados] = useState([]);

  const captchaWidgetRef = useRef(null);

  // Carrega dados do evento
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErro(null);
      try {
        const url = `${API_URL}/public/inscricao/${slug}`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (cancelled) return;
        if (!resp.ok) {
          setErro(data.error || "Link inválido");
        } else {
          setEvento(data);
          // Se captcha está ativo, carrega o script dinamicamente
          if (data.captchaRequired && data.captchaSiteKey) {
            loadCaptchaScript(data.captchaProvider);
          }
        }
      } catch (e) {
        if (!cancelled) setErro(`Erro ao carregar evento: ${e.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const loadCaptchaScript = (provider) => {
    if (typeof document === "undefined") return;
    const existing = document.querySelector(
      `script[data-captcha="${provider}"]`,
    );
    if (existing) return;
    const script = document.createElement("script");
    script.async = true;
    script.defer = true;
    script.dataset.captcha = provider;
    if (provider === "google") {
      script.src = `https://www.google.com/recaptcha/api.js?render=${evento?.captchaSiteKey || ""}`;
    } else if (provider === "turnstile") {
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    }
    document.head.appendChild(script);
  };

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field])
      setErrors((prev) => {
        const n = { ...prev };
        delete n[field];
        return n;
      });
  };

  const validate = () => {
    const e = {};
    if (!form.nome.trim()) e.nome = "Nome é obrigatório";
    if (!form.setor) e.setor = "Segmento é obrigatório";
    if (!form.cidade.trim()) e.cidade = "Cidade é obrigatória";
    if (!form.estado.trim()) e.estado = "Estado é obrigatório";
    if (!form.email.trim()) e.email = "E-mail é obrigatório";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = "E-mail inválido";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const obterCaptchaToken = async () => {
    if (!evento?.captchaRequired) return null;
    const provider = evento.captchaProvider;
    const siteKey = evento.captchaSiteKey;
    try {
      if (
        provider === "google" &&
        typeof window !== "undefined" &&
        window.grecaptcha
      ) {
        return await new Promise((resolve, reject) => {
          window.grecaptcha.ready(() => {
            window.grecaptcha
              .execute(siteKey, { action: "inscricao" })
              .then(resolve)
              .catch(reject);
          });
        });
      }
      if (
        provider === "turnstile" &&
        typeof window !== "undefined" &&
        window.turnstile
      ) {
        // Turnstile usa widget visual; aqui assumimos que o valor já está setado
        return captchaWidgetRef.current?.value || null;
      }
    } catch (err) {
      console.error("Erro captcha:", err);
    }
    return null;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setErro(null);
    try {
      const captchaToken = await obterCaptchaToken();
      const payload = {
        nome: form.nome.trim(),
        setor: form.setor,
        porte: form.porte,
        cidade: form.cidade.trim(),
        estado: form.estado.trim(),
        tipo: form.tipo,
        email: form.email.trim(),
        telefone: form.telefone.trim() || null,
        descricao: form.descricao.trim() || null,
        necessidades: form.necessidades.trim() || null,
        captchaToken,
        items: [...itemsOferecidos, ...itemsDemandados],
      };
      const resp = await fetch(`${API_URL}/public/inscricao/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErro(data.error || "Erro ao processar inscrição");
        return;
      }
      setSuccess(true);
    } catch (e) {
      setErro(`Falha na rede: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // ═══════════════════════════════════════════════════════════
  // Estilo corporativo profissional
  // Paleta: branco, cinzas neutros, único tom de marca (#c41e3a) usado
  // com parcimônia. Sem gradients chamativos, sem decoração.
  // Inspiração: Stripe, Linear, formulários B2B sérios.
  // ═══════════════════════════════════════════════════════════

  // ─── Tela de carregamento ───
  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#fafafa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "2px solid #e5e7eb",
              borderTopColor: "#1f2937",
              margin: "0 auto 14px",
              animation: "spin 0.7s linear infinite",
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ color: "#6b7280", fontSize: 13, fontWeight: 500 }}>
            Carregando
          </div>
        </div>
      </div>
    );
  }

  // ─── Erro ou link inválido ───
  if (erro && !evento) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#fafafa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            padding: "40px 36px",
            maxWidth: 440,
            width: "100%",
            textAlign: "center",
            border: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "#fef2f2",
              color: "#dc2626",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 18px",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "#111827",
              marginBottom: 8,
              letterSpacing: -0.2,
            }}
          >
            Link indisponível
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#6b7280",
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {erro}
          </p>
        </div>
      </div>
    );
  }

  // ─── Tela de sucesso ───
  if (success) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#fafafa",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          fontFamily:
            "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            padding: "44px 40px 36px",
            maxWidth: 480,
            width: "100%",
            border: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: "#f0fdf4",
              color: "#16a34a",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 22,
            }}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "#111827",
              marginBottom: 12,
              letterSpacing: -0.3,
            }}
          >
            Inscrição confirmada
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#4b5563",
              lineHeight: 1.65,
              marginBottom: 28,
              margin: 0,
            }}
          >
            A inscrição de{" "}
            <strong style={{ color: "#111827", fontWeight: 600 }}>
              {form.nome}
            </strong>{" "}
            em{" "}
            <strong style={{ color: "#111827", fontWeight: 600 }}>
              {evento.nome}
            </strong>{" "}
            foi recebida. O organizador entrará em contato pelo e-mail
            informado.
          </p>

          <div
            style={{
              marginTop: 28,
              paddingTop: 24,
              borderTop: "1px solid #f3f4f6",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: "#6b7280",
                letterSpacing: 0.6,
                textTransform: "uppercase",
                marginBottom: 14,
              }}
            >
              Próximos passos
            </div>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <ListStep>Aguarde contato da organização do evento</ListStep>
              <ListStep>
                Verifique periodicamente o e-mail{" "}
                <strong style={{ fontWeight: 600 }}>{form.email}</strong>
              </ListStep>
              <ListStep>
                O evento ocorre em{" "}
                <strong style={{ fontWeight: 600 }}>
                  {formatEventoDate(evento.data)}
                </strong>
              </ListStep>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ─── Formulário principal ───
  const camposObrigatorios = [
    form.nome,
    form.setor,
    form.cidade,
    form.estado,
    form.email,
  ].filter((v) => v && String(v).trim());
  const progress = Math.round((camposObrigatorios.length / 5) * 100);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafafa",
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        color: "#111827",
      }}
    >
      <style>{`
        html, body, #root { margin: 0; padding: 0; width: 100%; }
        body { overflow-x: hidden; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
        *, *::before, *::after { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* ─── TOPBAR FIXA ─── */}
      <div
        style={{
          background: "#fff",
          borderBottom: "1px solid #e5e7eb",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "16px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: 1.5,
            }}
          >
            <span style={{ color: "#111827" }}>BRATECC</span>{" "}
            <span style={{ color: "#c41e3a" }}>CONNEX</span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#6b7280",
              fontWeight: 500,
            }}
          >
            Inscrição segura · {progress}% completo
          </div>
        </div>
        {/* Progress bar muito sutil */}
        <div style={{ height: 2, background: "#f3f4f6" }}>
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              background: progress === 100 ? "#16a34a" : "#c41e3a",
              transition: "width 0.3s ease, background 0.3s ease",
            }}
          />
        </div>
      </div>

      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "48px 24px 60px",
        }}
      >
        {/* ─── HERO: NOME, DATA, LOCAL, DESCRIÇÃO + CTA ─── */}
        <div style={{ marginBottom: 56 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#c41e3a",
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Inscrições abertas
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: "#111827",
              marginBottom: 18,
              lineHeight: 1.2,
              letterSpacing: -0.7,
              margin: "0 0 18px",
            }}
          >
            {evento.nome}
          </h1>

          <div
            style={{
              display: "flex",
              gap: 24,
              flexWrap: "wrap",
              marginBottom: 24,
            }}
          >
            <MetaItem
              icon={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              }
              label={formatEventoDate(evento.data)}
            />
            <MetaItem
              icon={
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              }
              label={evento.local}
            />
          </div>

          {evento.descricao && (
            <p
              style={{
                fontSize: 16,
                color: "#374151",
                lineHeight: 1.7,
                margin: 0,
                marginBottom: 32,
              }}
            >
              {evento.descricao}
            </p>
          )}

          {/* Primary CTA — desce até o form */}
          <button
            onClick={() => {
              const el = document.getElementById("form-inscricao");
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#000")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#111827")}
            style={{
              padding: "13px 28px",
              borderRadius: 6,
              border: "none",
              background: "#111827",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              transition: "background 0.15s ease",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              letterSpacing: 0.1,
            }}
          >
            Inscrever-se neste evento
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </button>
        </div>

        {/* ─── COMO FUNCIONA O MATCHMAKING ─── */}
        <div
          style={{
            marginBottom: 56,
            paddingTop: 48,
            borderTop: "1px solid #e5e7eb",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#6b7280",
              letterSpacing: 0.8,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Como funciona
          </div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#111827",
              margin: "0 0 14px",
              letterSpacing: -0.3,
              lineHeight: 1.3,
            }}
          >
            Matchmaking comercial com inteligência artificial
          </h2>
          <p
            style={{
              fontSize: 15,
              color: "#4b5563",
              lineHeight: 1.7,
              margin: "0 0 32px",
              maxWidth: 620,
            }}
          >
            Após sua inscrição, nossa IA analisa o perfil da sua empresa e
            identifica outras empresas e parceiros do evento com sinergia
            comercial real. Você só recebe contatos que fazem sentido para o seu
            negócio.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
              gap: 20,
            }}
          >
            <Step
              number="1"
              title="Inscrição"
              text="Você cadastra sua empresa e o que oferece ou busca."
            />
            <Step
              number="2"
              title="Análise por IA"
              text="Nossa plataforma cruza perfis e identifica oportunidades de negócio."
            />
            <Step
              number="3"
              title="Conexão"
              text="Empresas com afinidade entram em contato e recebem introdução guiada."
            />
          </div>
        </div>

        {/* ─── FORMULÁRIO (com âncora) ─── */}
        <div id="form-inscricao" style={{ scrollMarginTop: 80 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#6b7280",
              letterSpacing: 0.8,
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Formulário de inscrição
          </div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#111827",
              margin: "0 0 8px",
              letterSpacing: -0.3,
            }}
          >
            Cadastre sua empresa
          </h2>
          <p
            style={{
              fontSize: 14,
              color: "#6b7280",
              margin: "0 0 24px",
              lineHeight: 1.6,
            }}
          >
            Leva menos de 3 minutos. Os campos marcados com{" "}
            <span style={{ color: "#dc2626" }}>*</span> são obrigatórios.
          </p>
        </div>

        {/* ─── ERRO GLOBAL ─── */}
        {erro && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 6,
              padding: "12px 14px",
              marginBottom: 28,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#dc2626"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0, marginTop: 1 }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span
              style={{
                fontSize: 13,
                color: "#991b1b",
                flex: 1,
                lineHeight: 1.5,
              }}
            >
              {erro}
            </span>
            <button
              onClick={() => setErro(null)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#991b1b",
                fontSize: 18,
                lineHeight: 1,
                padding: 0,
                marginTop: -2,
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* ─── CARD DO FORMULÁRIO ─── */}
        <div
          style={{
            background: "#fff",
            borderRadius: 8,
            border: "1px solid #e5e7eb",
            overflow: "hidden",
          }}
        >
          {/* Seção 1: Empresa */}
          <CorporateSection
            title="Dados da empresa"
            description="Informações para identificação e contato"
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 16,
              }}
            >
              <PublicField
                label="Nome da empresa"
                required
                error={errors.nome}
                span={8}
              >
                <PublicInput
                  value={form.nome}
                  onChange={(v) => update("nome", v)}
                  placeholder="Ex: Texas Energy Solutions"
                  error={errors.nome}
                />
              </PublicField>
              <PublicField label="Porte" span={4}>
                <PublicSelect
                  value={form.porte}
                  onChange={(v) => update("porte", v)}
                  options={["MEI", "Micro", "Pequeno", "Médio", "Grande"]}
                />
              </PublicField>

              <PublicField
                label="Segmento"
                required
                error={errors.setor}
                span={6}
              >
                <PublicSelect
                  value={form.setor}
                  onChange={(v) => update("setor", v)}
                  options={SEGMENTOS_OPCOES}
                  placeholder="Selecione..."
                  error={errors.setor}
                />
              </PublicField>
              <PublicField label="Tipo de operação" required span={6}>
                <PublicSelect
                  value={form.tipo}
                  onChange={(v) => update("tipo", v)}
                  options={[
                    { value: "EXPORTADOR", label: "Exportador" },
                    { value: "IMPORTADOR", label: "Importador" },
                    { value: "AMBOS", label: "Ambos" },
                  ]}
                />
              </PublicField>

              <PublicField label="País" span={4}>
                <PublicSelect
                  value={form.pais}
                  onChange={(v) => update("pais", v)}
                  options={["Brasil", "Estados Unidos", "México", "Outro"]}
                />
              </PublicField>
              <PublicField
                label="Cidade"
                required
                error={errors.cidade}
                span={5}
              >
                <PublicInput
                  value={form.cidade}
                  onChange={(v) => update("cidade", v)}
                  placeholder="Ex: Houston"
                  error={errors.cidade}
                />
              </PublicField>
              <PublicField
                label="Estado"
                required
                error={errors.estado}
                span={3}
              >
                <PublicInput
                  value={form.estado}
                  onChange={(v) => update("estado", v)}
                  placeholder="UF"
                  error={errors.estado}
                />
              </PublicField>

              <PublicField
                label="E-mail de contato"
                required
                error={errors.email}
                span={8}
              >
                <PublicInput
                  type="email"
                  value={form.email}
                  onChange={(v) => update("email", v)}
                  placeholder="contato@empresa.com"
                  error={errors.email}
                />
              </PublicField>
              <PublicField label="Telefone" span={4}>
                <PublicInput
                  value={form.telefone}
                  onChange={(v) => update("telefone", v)}
                  placeholder="+55 11 98765-4321"
                />
              </PublicField>

              <PublicField
                label="Sobre a empresa"
                span={12}
                hint="Conte um pouco sobre o que vocês fazem"
              >
                <PublicTextarea
                  value={form.descricao}
                  onChange={(v) => update("descricao", v)}
                  placeholder="Mercados de atuação, diferenciais, anos no mercado..."
                  rows={3}
                />
              </PublicField>
            </div>
          </CorporateSection>

          {/* Seção 2: Catálogo */}
          <CorporateSection
            title="Catálogo de produtos e serviços"
            description="O que sua empresa oferece e o que está buscando"
            optional
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 16,
              }}
            >
              <ItemsManager
                items={itemsOferecidos}
                onChange={setItemsOferecidos}
                tipo="OFERECIDO"
                label="📤 OFERECIDOS"
                accentColor="#16a34a"
                placeholder="Ex: Painéis solares"
              />
              <ItemsManager
                items={itemsDemandados}
                onChange={setItemsDemandados}
                tipo="DEMANDADO"
                label="📥 DEMANDADOS"
                accentColor="#ea580c"
                placeholder="Ex: Trade finance"
              />
            </div>
          </CorporateSection>

          {/* Seção 3: Submit */}
          <div style={{ padding: "24px 32px 32px" }}>
            {evento.captchaRequired &&
              evento.captchaProvider === "turnstile" && (
                <div style={{ marginBottom: 20 }}>
                  <div
                    className="cf-turnstile"
                    data-sitekey={evento.captchaSiteKey}
                    data-callback="onTurnstileSuccess"
                    ref={captchaWidgetRef}
                  />
                </div>
              )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              onMouseEnter={(e) => {
                if (!submitting) e.currentTarget.style.background = "#000";
              }}
              onMouseLeave={(e) => {
                if (!submitting) e.currentTarget.style.background = "#111827";
              }}
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 6,
                border: "none",
                background: submitting ? "#9ca3af" : "#111827",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: submitting ? "wait" : "pointer",
                transition: "background 0.15s ease",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                letterSpacing: 0.1,
              }}
            >
              {submitting ? (
                <>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: "2px solid rgba(255,255,255,0.3)",
                      borderTopColor: "#fff",
                      animation: "spin 0.7s linear infinite",
                    }}
                  />
                  Enviando...
                </>
              ) : (
                <>Enviar inscrição</>
              )}
            </button>

            <p
              style={{
                fontSize: 12,
                color: "#6b7280",
                textAlign: "center",
                lineHeight: 1.6,
                margin: "14px 0 0",
              }}
            >
              Ao enviar, você concorda em participar do evento. Seus dados serão
              utilizados apenas pelo organizador para contato.
            </p>
          </div>
        </div>

        {/* ─── FOOTER ─── */}
        <div
          style={{
            textAlign: "center",
            marginTop: 32,
            fontSize: 11,
            color: "#9ca3af",
            letterSpacing: 0.3,
          }}
        >
          <span
            style={{
              fontFamily: "'Montserrat', sans-serif",
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            BRATECC CONNEX
          </span>
          {" · "}
          Plataforma de matchmaking comercial
        </div>
      </div>
    </div>
  );
}

// ─── Auxiliares de layout (formulário público corporativo) ───

// Card de seção: borda inferior separa do próximo bloco; título + descrição
// alinhados no topo, conteúdo embaixo. Sem badges chamativos.
function CorporateSection({ title, description, optional, children }) {
  return (
    <div
      style={{
        padding: "28px 32px",
        borderBottom: "1px solid #f3f4f6",
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            marginBottom: 4,
          }}
        >
          <h2
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "#111827",
              margin: 0,
              letterSpacing: -0.2,
            }}
          >
            {title}
          </h2>
          {optional && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#9ca3af",
              }}
            >
              opcional
            </span>
          )}
        </div>
        {description && (
          <p
            style={{
              fontSize: 13,
              color: "#6b7280",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

// Item do header (data, local) com ícone+texto inline
function MetaItem({ icon, label }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        color: "#4b5563",
        fontSize: 14,
        fontWeight: 500,
      }}
    >
      <span style={{ color: "#9ca3af", display: "flex" }}>{icon}</span>
      {label}
    </div>
  );
}

// Passo numerado da seção "Como funciona o matchmaking"
// Numeração discreta no estilo de documentação técnica
function Step({ number, title, text }) {
  return (
    <div>
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "#fff",
          border: "1.5px solid #e5e7eb",
          color: "#111827",
          fontSize: 12,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        {number}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "#111827",
          marginBottom: 6,
          letterSpacing: -0.1,
        }}
      >
        {title}
      </div>
      <p
        style={{
          fontSize: 13,
          color: "#6b7280",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {text}
      </p>
    </div>
  );
}

// Item de lista na tela de sucesso
function ListStep({ children }) {
  return (
    <li
      style={{
        fontSize: 13,
        color: "#4b5563",
        lineHeight: 1.6,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
      }}
    >
      <span style={{ color: "#16a34a", marginTop: 4, flexShrink: 0 }}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      <span>{children}</span>
    </li>
  );
}

// ─── Helpers/sub-componentes da inscrição pública ───
// Design system limpo, sem dependência do tema escuro do admin.
function PublicField({ label, required, error, hint, children, span = 1 }) {
  return (
    <div style={{ gridColumn: `span ${span}`, minWidth: 0 }}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          color: "#374151",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          marginBottom: 7,
        }}
      >
        {label}
        {required && <span style={{ color: "#dc2626" }}>*</span>}
      </label>
      {children}
      {error && (
        <div
          style={{
            fontSize: 11,
            color: "#dc2626",
            marginTop: 5,
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 500,
          }}
        >
          <span>⚠</span> {error}
        </div>
      )}
      {hint && !error && (
        <div
          style={{
            fontSize: 11,
            color: "#9ca3af",
            marginTop: 5,
            fontWeight: 400,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function PublicInput({ value, onChange, placeholder, type = "text", error }) {
  const [focused, setFocused] = useState(false);
  const border = error ? "#dc2626" : focused ? "#1E1F36" : "#e5e7eb";
  return (
    <input
      type={type}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: "100%",
        padding: "12px 14px",
        borderRadius: 10,
        border: `1.5px solid ${border}`,
        background: "#fff",
        color: "#1E1F36",
        fontSize: 14,
        outline: "none",
        boxSizing: "border-box",
        transition: "border-color 0.18s ease, box-shadow 0.18s ease",
        boxShadow:
          focused && !error
            ? "0 0 0 3px rgba(30,31,54,0.08)"
            : error
              ? "0 0 0 3px rgba(220,38,38,0.08)"
              : "none",
        fontFamily: "inherit",
      }}
    />
  );
}

function PublicSelect({ value, onChange, options, placeholder, error }) {
  const [focused, setFocused] = useState(false);
  const border = error ? "#dc2626" : focused ? "#1E1F36" : "#e5e7eb";
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: "100%",
        padding: "12px 14px",
        borderRadius: 10,
        border: `1.5px solid ${border}`,
        background: "#fff",
        color: "#1E1F36",
        fontSize: 14,
        outline: "none",
        cursor: "pointer",
        boxSizing: "border-box",
        transition: "border-color 0.18s ease, box-shadow 0.18s ease",
        boxShadow: focused && !error ? "0 0 0 3px rgba(30,31,54,0.08)" : "none",
        appearance: "none",
        WebkitAppearance: "none",
        MozAppearance: "none",
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 14px center",
        paddingRight: 36,
        fontFamily: "inherit",
      }}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((opt) => {
        const v = typeof opt === "string" ? opt : opt.value;
        const l = typeof opt === "string" ? opt : opt.label;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

function PublicTextarea({ value, onChange, placeholder, rows = 3 }) {
  const [focused, setFocused] = useState(false);
  const border = focused ? "#1E1F36" : "#e5e7eb";
  return (
    <textarea
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        width: "100%",
        padding: "12px 14px",
        borderRadius: 10,
        border: `1.5px solid ${border}`,
        background: "#fff",
        color: "#1E1F36",
        fontSize: 14,
        outline: "none",
        boxSizing: "border-box",
        resize: "vertical",
        fontFamily: "inherit",
        transition: "border-color 0.18s ease, box-shadow 0.18s ease",
        boxShadow: focused ? "0 0 0 3px rgba(30,31,54,0.08)" : "none",
        lineHeight: 1.5,
      }}
    />
  );
}

function formatEventoDate(data) {
  if (!data) return "—";
  try {
    return new Date(data).toLocaleDateString("pt-BR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return String(data);
  }
}

// ═══════════════════
// ─── MAIN APP ───
// ═══════════════════
// Wrapper que decide entre a rota pública de inscrição e o app autenticado.
// Mantido como default export para compatibilidade com main.jsx.
export default function App() {
  const location = useLocation();
  const publicMatch = location.pathname.match(
    /^\/inscricao\/([a-zA-Z0-9_-]+)\/?$/,
  );
  if (publicMatch) {
    return <InscricaoPublicaPage slug={publicMatch[1]} />;
  }
  return <AppAutenticado />;
}

function AppAutenticado() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ─── Shared State ───
  const [empresas, setEmpresas] = useState([]);
  const [associados, setAssociados] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [matches, setMatches] = useState([]);
  // Módulo Universidades × Associados
  const [universidades, setUniversidades] = useState([]);
  const [candidatos, setCandidatos] = useState([]);
  const [vagas, setVagas] = useState([]);
  const [matchVagas, setMatchVagas] = useState([]);

  // ─── Notificações lidas (persistido em localStorage) ───
  const {
    readIds,
    markAsRead,
    markAllAsRead,
    clearAll: clearReadNotifications,
  } = useReadNotifications();

  // ─── Estado da sidebar (colapsada, seções expandidas) persistido em localStorage ───
  const {
    collapsed: sidebarCollapsed,
    toggleCollapsed: toggleSidebarCollapsed,
    toggleSection: toggleSidebarSection,
    isSectionOpen: isSidebarSectionOpen,
  } = useSidebarState();

  // ─── Carregar dados do backend ───
  const loadData = async () => {
    try {
      setLoading(true);
      const [
        empresasRes,
        associadosRes,
        eventosRes,
        matchesRes,
        universidadesRes,
        candidatosRes,
        vagasRes,
        matchVagasRes,
      ] = await Promise.all([
        api.get("/empresas").catch(() => ({ data: [] })),
        api.get("/associados").catch(() => ({ data: [] })),
        api.get("/eventos").catch(() => ({ data: [] })),
        api.get("/matches").catch(() => ({ data: [] })),
        api.get("/universidades").catch(() => ({ data: [] })),
        api.get("/candidatos").catch(() => ({ data: [] })),
        api.get("/vagas").catch(() => ({ data: [] })),
        api.get("/match-vagas").catch(() => ({ data: [] })),
      ]);

      // Mapear dados do backend para o formato do frontend
      const mappedEmpresas = (empresasRes.data || empresasRes || []).map(
        (e) => ({
          id: e.id,
          nome: e.nome,
          segmento: e.setor,
          porte: e.porte || "Médio",
          cidade: e.cidade,
          estado: e.estado,
          tipo:
            e.tipo === "EXPORTADOR"
              ? "Exportador"
              : e.tipo === "IMPORTADOR"
                ? "Importador"
                : "Ambos",
          email: e.email,
          telefone: e.telefone,
          produtosOferecidos: e.produtosOferecidos || "",
          produtosDemandados: e.produtosDemandados || e.necessidades || "",
          desc: e.descricao,
          // Marcador crítico: empresas com eventoOrigemId != null vieram via
          // inscrição no link público de evento e NÃO devem aparecer em matches
          // normais (Assoc × Empresa, Eventos × Empresas convidadas etc).
          eventoOrigemId: e.eventoOrigemId ?? null,
        }),
      );

      const mappedAssociados = (associadosRes.data || associadosRes || []).map(
        (a) => ({
          id: a.id,
          nome: a.nome,
          segmento: a.segmento,
          porte: a.porte || "Médio",
          email: a.email,
          telefone: a.telefone,
          whatsapp: a.whatsapp,
          servicos: a.servicos,
          produtosOferecidos: a.produtosOferecidos || a.servicos || "",
          produtosDemandados: a.produtosDemandados || "",
          descricao: a.descricao,
          categorias: a.categorias || [],
          userId: a.userId,
        }),
      );

      const mappedEventos = (eventosRes.data || eventosRes || []).map((e) => ({
        id: e.id,
        nome: e.nome,
        local: e.local,
        data: new Date(e.data).toLocaleDateString("pt-BR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        dataFim: e.dataFim
          ? new Date(e.dataFim).toLocaleDateString("pt-BR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })
          : null,
        participantes: e._count?.participantes || e.participantes?.length || 0,
        associados: e._count?.associados || e.associados?.length || 0,
        matches: 0,
        taxaMatch: 0,
        status:
          e.status === "ATIVO"
            ? "Ativo"
            : e.status === "PLANEJADO"
              ? "Planejado"
              : e.status,
        numero: e.numeroWhatsapp,
        categorias: e.categorias || [],
        descricao: e.descricao,
        inscricaoSlug: e.inscricaoSlug || null,
        inscricaoAtiva: e.inscricaoAtiva !== false,
        // Lista de participantes (apenas IDs + status confirmado) — usada na
        // tela Eventos × Empresas pra mostrar a coluna Participação. Vem do
        // backend (eventoController.getAll inclui esse campo).
        participantesList: e.participantesList || [],
      }));

      const mappedMatches = (matchesRes.data || matchesRes || []).map((m) => ({
        id: m.id,
        empresa: m.empresa?.nome || "Empresa",
        cidade: m.empresa ? `${m.empresa.cidade}, ${m.empresa.estado}` : "",
        setor: m.empresa?.setor || "",
        produto: m.produto || "",
        associado: m.associado?.nome || "Associado",
        score: m.score,
        status:
          m.status === "CONFIRMED"
            ? "Confirmed"
            : m.status === "INTERESTED"
              ? "Interested"
              : m.status === "CONTACTED"
                ? "Contacted"
                : m.status === "REJECTED"
                  ? "Rejected"
                  : "Pending",
        prioridade: m.prioridade,
      }));

      setEmpresas(mappedEmpresas);
      setAssociados(mappedAssociados);
      setEventos(mappedEventos);
      setMatches(mappedMatches);

      // ─── Módulo Universidades × Associados ───
      // Os dados aqui vêm crus do backend (sem mapeamento) porque as telas
      // consomem diretamente o formato Prisma (candidato.universidade, etc).
      setUniversidades(universidadesRes.data || universidadesRes || []);
      setCandidatos(candidatosRes.data || candidatosRes || []);
      setVagas(vagasRes.data || vagasRes || []);
      setMatchVagas(matchVagasRes.data || matchVagasRes || []);

      setError(null);
    } catch (err) {
      console.error("Erro ao carregar dados:", err);
      // Se for 401, o helper api já limpou o token — sinalizar re-login
      if (err.status === 401) {
        setError("Sua sessão expirou. Faça login novamente.");
      } else {
        setError(`Não foi possível conectar ao servidor: ${err.message}`);
      }
      // NÃO usa fallback para dados mockados: se API falhar, estado fica vazio
      // e o usuário é informado claramente. Evita mascarar problemas de conexão.
      setEmpresas([]);
      setAssociados([]);
      setEventos([]);
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  // Carregar dados quando o usuário fizer login
  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user]);

  // ─── CRUD handlers com API + AI Matching ───
  const addEmpresa = async (emp) => {
    try {
      const response = await api.post("/empresas", {
        nome: emp.nome,
        setor: emp.segmento,
        porte: emp.porte,
        cidade: emp.cidade,
        estado: emp.estado,
        tipo:
          emp.tipo === "Exportador"
            ? "EXPORTADOR"
            : emp.tipo === "Importador"
              ? "IMPORTADOR"
              : "AMBOS",
        email: emp.email,
        telefone: emp.telefone,
        descricao: emp.desc,
        produtosOferecidos: emp.produtosOferecidos,
        produtosDemandados: emp.produtosDemandados,
        items: Array.isArray(emp.items) ? emp.items : [],
      });
      const novaEmpresa = {
        ...emp,
        id: response.id || response.data?.id || Date.now(),
      };
      setEmpresas((prev) => [...prev, novaEmpresa]);

      // 🤖 Backend já dispara Gemini automaticamente em empresaController.create.
      // Aguarda alguns segundos e recarrega matches do banco — dá tempo do Gemini
      // terminar e cria com scores reais. Não geramos no front pra evitar
      // exibir score local "fake" antes do Gemini terminar.
      setTimeout(async () => {
        try {
          const fresh = await api.get("/matches");
          const list = Array.isArray(fresh) ? fresh : fresh?.data || [];
          if (list.length > 0) {
            setMatches(
              list.map((m) => ({
                ...m,
                empresa: m.empresa?.nome || m.empresa,
                associado: m.associado?.nome || m.associado,
                empObj: m.empresa,
                assocObj: m.associado,
              })),
            );
            console.log(
              `🎯 Matches Gemini sincronizados após criação de "${novaEmpresa.nome}"`,
            );
          }
        } catch (e) {
          console.warn("Falha ao recarregar matches:", e.message);
        }
      }, 3500); // ~3.5s — tempo médio de uma chamada Gemini

      return { empresa: novaEmpresa, matches: [] };
    } catch (err) {
      console.error("Erro ao criar empresa:", err);
      setError(`Erro ao criar empresa: ${err.message}`);
      // Não faz fallback local: propaga o erro pro formulário tratar
      throw err;
    }
  };

  const addAssociado = async (assoc) => {
    try {
      const response = await api.post("/associados", {
        nome: assoc.nome,
        tipoPessoa: assoc.tipoPessoa || null,
        segmento: assoc.segmento,
        porte: assoc.porte,
        email: assoc.email,
        telefone: assoc.telefone,
        whatsapp: assoc.whatsapp,
        servicos: assoc.servicos,
        produtosOferecidos: assoc.produtosOferecidos,
        produtosDemandados: assoc.produtosDemandados,
        descricao: assoc.descricao,
        criarUsuario: !!assoc.criarUsuario,
        senha: assoc.senha || null,
        items: Array.isArray(assoc.items) ? assoc.items : [],
      });
      const novoAssociado = {
        ...assoc,
        id: response.id || response.data?.id || Date.now(),
      };
      setAssociados((prev) => [...prev, novoAssociado]);

      // 🤖 Backend já dispara Gemini automaticamente em associadoController.create.
      // Aguarda e recarrega — mesma lógica do addEmpresa.
      setTimeout(async () => {
        try {
          const fresh = await api.get("/matches");
          const list = Array.isArray(fresh) ? fresh : fresh?.data || [];
          if (list.length > 0) {
            setMatches(
              list.map((m) => ({
                ...m,
                empresa: m.empresa?.nome || m.empresa,
                associado: m.associado?.nome || m.associado,
                empObj: m.empresa,
                assocObj: m.associado,
              })),
            );
            console.log(
              `🎯 Matches Gemini sincronizados após criação de "${novoAssociado.nome}"`,
            );
          }
        } catch (e) {
          console.warn("Falha ao recarregar matches:", e.message);
        }
      }, 3500);

      return { associado: novoAssociado, matches: [] };
    } catch (err) {
      console.error("Erro ao criar associado:", err);
      setError(`Erro ao criar associado: ${err.message}`);
      throw err;
    }
  };

  // ─── Regenerar todos os matches com IA ───
  const regenerateAllMatches = async () => {
    console.log("🤖 Regenerando matches com IA Gemini (backend)...");

    // 1. Pra cada empresa ativa, dispara o endpoint backend de Gemini.
    //    O backend (aiController.gerarMatchesInteligentes):
    //    - Pula pares já existentes no banco (anti-duplicação rígida v15)
    //    - Cria novos matches em PENDING com score Gemini real
    //    - Retorna o conjunto criado + contagem de preservados
    let totalNovos = 0;
    let totalPreservados = 0;

    for (const empresa of empresas) {
      if (!empresa.id) continue;
      // Empresas restritas a evento (eventoOrigemId != null) não geram matches
      // normais — pulamos pra evitar chamadas desnecessárias ao backend.
      if (empresa.eventoOrigemId) continue;
      try {
        const resp = await api
          .post(`/ai/matches/${empresa.id}`)
          .catch((err) => {
            console.warn(
              `⚠️ Gemini falhou para empresa #${empresa.id} (${empresa.nome}):`,
              err.message,
            );
            return null;
          });
        if (!resp) continue;

        totalNovos += resp.totalMatches || 0;
        totalPreservados += resp.preservados || 0;
      } catch (e) {
        console.warn(
          `⚠️ Erro ao gerar matches Gemini para "${empresa.nome}":`,
          e.message,
        );
      }
    }

    console.log(
      `✅ Gemini: ${totalNovos} novo(s) gerado(s); ${totalPreservados} preservado(s) (já existiam no banco).`,
    );

    // 2. Recarrega a lista de matches do backend pra ter os scores Gemini reais
    let finalMatches = matches;
    let allPendingMatchIds = [];
    try {
      const fresh = await api.get("/matches");
      const list = Array.isArray(fresh) ? fresh : fresh?.data || [];
      finalMatches = list.map((m) => ({
        ...m,
        empresa: m.empresa?.nome || m.empresa,
        associado: m.associado?.nome || m.associado,
        empresaId: m.empresaId,
        associadoId: m.associadoId,
        empObj: m.empresa,
        assocObj: m.associado,
      }));
      setMatches(finalMatches);
      // Coleta TODOS os matches em PENDING (recém-criados E preservados que
      // ainda não foram contactados). Status CONTACTED/INTERESTED/CONFIRMED/REJECTED
      // são pulados — não disparamos HSM neles. Backend ainda faz double-check
      // por status; aqui só evitamos round-trip desnecessário.
      allPendingMatchIds = list
        .filter((m) => {
          const s = String(m.status || "").toUpperCase();
          return s === "PENDING" || s === "PENDENTE";
        })
        .map((m) => m.id)
        .filter(Boolean);
    } catch (e) {
      console.warn("⚠️ Falha ao recarregar matches:", e.message);
    }

    // 3. Enviar HSM hsmbra pra TODOS os matches PENDING (handshake etapa 1: só
    //    pro associado). Backend faz anti-duplicação adicional por status —
    //    matches que já tiveram HSM disparado (status CONTACTED+) são pulados
    //    mesmo que cheguem na lista por engano.
    let hsmInfo = { sent: 0, failed: 0, skipped: 0, errors: [] };
    if (allPendingMatchIds.length > 0) {
      try {
        const hsmResult = await api.post("/whatsapp/send-hsm-matches", {
          matchIds: allPendingMatchIds,
        });
        hsmInfo.sent = hsmResult.sent || 0;
        hsmInfo.failed = hsmResult.failed || 0;
        hsmInfo.skipped = hsmResult.skipped || 0;
        if (Array.isArray(hsmResult.details)) {
          const errMsgs = new Set();
          hsmResult.details.forEach((d) => {
            if (!d.success && !d.skipped && d.error) {
              errMsgs.add(String(d.error).substring(0, 200));
            }
          });
          hsmInfo.errors = Array.from(errMsgs);
        }
        console.log(
          `📱 HSM hsmbra: ${hsmInfo.sent}/${hsmResult.total} enviados aos associados${hsmInfo.skipped ? ` (${hsmInfo.skipped} pulados)` : ""}${hsmInfo.failed ? ` (${hsmInfo.failed} falhas)` : ""}`,
        );
        if (hsmInfo.errors.length > 0)
          console.warn("⚠️ Erros HSM:", hsmInfo.errors);
      } catch (hsmErr) {
        console.warn("⚠️ Erro ao enviar HSM hsmbra:", hsmErr.message);
        hsmInfo.errors.push(hsmErr.message);
        hsmInfo.failed = allPendingMatchIds.length;
      }
    }

    return {
      matches: finalMatches,
      novos: totalNovos,
      preservados: totalPreservados,
      hsmInfo,
    };
  };

  // Wrapper que retorna array (compat com outros consumidores) com hsmInfo anexado
  const regenerateAllMatchesWrapped = async () => {
    const r = await regenerateAllMatches();
    const arr = r.matches;
    arr.hsmInfo = r.hsmInfo;
    arr.novos = r.novos;
    return arr;
  };

  const addEvento = async (ev) => {
    try {
      const raw = await api.post("/eventos", {
        nome: ev.nome,
        local: ev.local,
        data: ev.dataInicio || new Date().toISOString(),
        dataFim: ev.dataFim || null,
        descricao: ev.descricao,
        numeroWhatsapp: ev.numero,
        status: ev.status === "Ativo" ? "ATIVO" : "PLANEJADO",
        categorias: ev.categorias || [],
      });
      // Debug: log pra facilitar diagnóstico se algum campo vier undefined
      if (!raw || !raw.nome) {
        console.error("⚠️ Evento criado mas resposta veio incompleta:", raw);
      }
      // Mapeia pro formato que a lista usa (data como string formatada pt-BR).
      const formatDate = (d) =>
        d
          ? new Date(d).toLocaleDateString("pt-BR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })
          : null;
      const novoEvento = {
        id: raw.id,
        nome: raw.nome || ev.nome,
        local: raw.local || ev.local,
        data: formatDate(raw.data || ev.dataInicio),
        dataFim: formatDate(raw.dataFim || ev.dataFim),
        participantes: 0,
        associados: 0,
        matches: 0,
        taxaMatch: 0,
        status:
          raw.status === "ATIVO"
            ? "Ativo"
            : raw.status === "PLANEJADO"
              ? "Planejado"
              : ev.status || "Planejado",
        numero: raw.numeroWhatsapp || ev.numero,
        categorias: raw.categorias || ev.categorias || [],
        descricao: raw.descricao || ev.descricao,
        tipo: ev.tipo,
        inscricaoSlug: raw.inscricaoSlug || null,
        inscricaoAtiva: raw.inscricaoAtiva !== false,
      };
      setEventos((prev) => [...prev, novoEvento]);
      return novoEvento;
    } catch (err) {
      console.error("Erro ao criar evento:", err);
      setError(`Erro ao criar evento: ${err.message}`);
      throw err;
    }
  };

  const deleteEmpresa = async (id) => {
    try {
      await api.delete(`/empresas/${id}`);
    } catch (err) {
      console.error("Erro ao deletar empresa:", err);
    }
    setEmpresas((prev) => prev.filter((e) => e.id !== id));
  };

  const deleteAssociado = async (id) => {
    try {
      await api.delete(`/associados/${id}`);
    } catch (err) {
      console.error("Erro ao deletar associado:", err);
    }
    setAssociados((prev) => prev.filter((a) => a.id !== id));
  };

  const deleteEvento = async (id) => {
    try {
      await api.delete(`/eventos/${id}`);
    } catch (err) {
      console.error("Erro ao deletar evento:", err);
    }
    setEventos((prev) => prev.filter((e) => e.id !== id));
  };

  const toggleEventoStatus = async (id) => {
    const evento = eventos.find((e) => e.id === id);
    if (!evento) return;

    const novoStatus = evento.status === "Ativo" ? "Planejado" : "Ativo";
    try {
      await api.patch(`/eventos/${id}/toggle-status`);
    } catch (err) {
      console.error("Erro ao alterar status do evento:", err);
    }
    setEventos((prev) =>
      prev.map((e) => (e.id === id ? { ...e, status: novoStatus } : e)),
    );
  };

  const updateEvento = async (id, data) => {
    try {
      await api.put(`/eventos/${id}`, data);
    } catch (err) {
      console.error("Erro ao atualizar evento:", err);
    }
    setEventos((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...data } : e)),
    );
  };

  const updateAssociado = async (id, data) => {
    try {
      await api.put(`/associados/${id}`, data);
    } catch (err) {
      console.error("Erro ao atualizar associado:", err);
    }
    setAssociados((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...data } : a)),
    );
  };

  // Resetar senha do associado. Se senhaCustom for vazio/nulo, backend gera
  // automaticamente. Retorna { novaSenha, geradaPorSistema, email } pra UI mostrar.
  const resetSenhaAssociado = async (id, senhaCustom = null) => {
    try {
      const body = senhaCustom ? { senha: senhaCustom } : {};
      const r = await api.post(`/associados/${id}/reset-senha`, body);
      return { success: true, ...r };
    } catch (err) {
      const msg = err?.message || "Falha ao resetar senha";
      console.error("Erro ao resetar senha:", err);
      return { success: false, error: msg };
    }
  };

  // Confirmar / desconfirmar participação de uma empresa em um evento.
  // Atualiza o estado local de eventos pra refletir imediatamente.
  const toggleConfirmacaoParticipante = async (
    eventoId,
    empresaId,
    confirmado,
  ) => {
    try {
      await api.patch(
        `/eventos/${eventoId}/participantes/${empresaId}/confirmar`,
        { confirmado },
      );
      // Atualiza state local — substitui o item participantesList do evento
      setEventos((prev) =>
        prev.map((ev) => {
          if (ev.id !== eventoId) return ev;
          const list = (ev.participantesList || []).map((p) =>
            p.empresaId === empresaId ? { ...p, confirmado } : p,
          );
          return { ...ev, participantesList: list };
        }),
      );
      return { success: true };
    } catch (err) {
      console.error("Erro ao alterar confirmação:", err);
      return { success: false, error: err.message };
    }
  };

  // ═══════════════════════════════════════════════════════════
  // HANDLERS — MÓDULO UNIVERSIDADES × ASSOCIADOS
  // ═══════════════════════════════════════════════════════════

  const addUniversidade = async (data) => {
    try {
      const r = await api.post("/universidades", data);
      const novo = r.data || r;
      setUniversidades((prev) => [novo, ...prev]);
      return { success: true, universidade: novo };
    } catch (err) {
      console.error("Erro ao criar universidade:", err);
      return { success: false, error: err?.message || "Falha ao criar" };
    }
  };

  const updateUniversidade = async (id, data) => {
    try {
      await api.put(`/universidades/${id}`, data);
      setUniversidades((prev) =>
        prev.map((u) => (u.id === id ? { ...u, ...data } : u)),
      );
      return { success: true };
    } catch (err) {
      console.error("Erro ao atualizar universidade:", err);
      return { success: false, error: err?.message };
    }
  };

  const deleteUniversidade = async (id) => {
    if (
      !confirm(
        "Excluir esta universidade? Os candidatos vinculados também serão removidos.",
      )
    )
      return;
    try {
      await api.delete(`/universidades/${id}`);
      setUniversidades((prev) => prev.filter((u) => u.id !== id));
    } catch (err) {
      console.error("Erro ao excluir universidade:", err);
      alert("Erro ao excluir: " + (err?.message || "erro de rede"));
    }
  };

  const resetSenhaUniversidade = async (id, senhaCustom = null) => {
    try {
      const body = senhaCustom ? { senha: senhaCustom } : {};
      const r = await api.post(`/universidades/${id}/reset-senha`, body);
      return { success: true, ...r };
    } catch (err) {
      console.error("Erro ao resetar senha universidade:", err);
      return {
        success: false,
        error: err?.message || "Falha ao resetar senha",
      };
    }
  };

  // Gera matches Candidato × Vaga via Gemini e dispara HSM nos novos PENDING
  // (sequência similar a regenerateAllMatches mas pra MatchVaga).
  const regenerateMatchVagasWrapped = async () => {
    try {
      // 1. Gera matches via backend (Gemini par-a-par, anti-duplicação)
      const r = await api.post("/match-vagas/gerar", {});
      const novos = r?.totalNovos ?? r?.novos ?? 0;
      const preservados = r?.preservados ?? 0;

      // 2. Recarrega lista
      const fresh = await api.get("/match-vagas");
      const list = Array.isArray(fresh) ? fresh : fresh?.data || [];
      setMatchVagas(list);

      // 3. Dispara HSM em todos os PENDING (regra: associado dono da vaga
      //    recebe primeiro)
      const allPendingIds = list
        .filter((m) => String(m.status || "").toUpperCase() === "PENDING")
        .map((m) => m.id);

      let hsmInfo = { sent: 0, failed: 0, skipped: 0 };
      if (allPendingIds.length > 0) {
        try {
          const hsmResult = await api.post("/whatsapp/send-hsm-matches-vaga", {
            matchIds: allPendingIds,
          });
          hsmInfo.sent = hsmResult.sent || 0;
          hsmInfo.failed = hsmResult.failed || 0;
          hsmInfo.skipped = hsmResult.skipped || 0;
        } catch (hsmErr) {
          console.warn("Erro ao disparar HSM matchVaga:", hsmErr.message);
          hsmInfo.failed = allPendingIds.length;
        }
      }

      return { success: true, novos, preservados, hsmInfo };
    } catch (err) {
      console.error("Erro ao gerar match-vagas:", err);
      return {
        success: false,
        error: err?.message || "Falha ao gerar matches",
      };
    }
  };

  // ─── HANDLERS DE VAGAS (associado loga e gerencia as próprias) ───
  const addVaga = async (data) => {
    try {
      const r = await api.post("/vagas", data);
      const nova = r.data || r;
      setVagas((prev) => [nova, ...prev]);
      return { success: true, vaga: nova };
    } catch (err) {
      console.error("Erro ao criar vaga:", err);
      return { success: false, error: err?.message || "Falha ao criar vaga" };
    }
  };

  const updateVaga = async (id, data) => {
    try {
      await api.put(`/vagas/${id}`, data);
      setVagas((prev) =>
        prev.map((v) => (v.id === id ? { ...v, ...data } : v)),
      );
      return { success: true };
    } catch (err) {
      console.error("Erro ao atualizar vaga:", err);
      return { success: false, error: err?.message };
    }
  };

  const deleteVaga = async (id) => {
    if (
      !confirm(
        "Excluir esta vaga? Os matches associados também serão removidos.",
      )
    )
      return;
    try {
      await api.delete(`/vagas/${id}`);
      setVagas((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      console.error("Erro ao excluir vaga:", err);
      alert("Erro ao excluir: " + (err?.message || "erro de rede"));
    }
  };

  // ─── HANDLERS DE CANDIDATOS (universidade loga e gerencia os próprios) ───
  const addCandidato = async (data) => {
    try {
      const r = await api.post("/candidatos", data);
      const novo = r.data || r;
      setCandidatos((prev) => [novo, ...prev]);
      return { success: true, candidato: novo };
    } catch (err) {
      console.error("Erro ao criar candidato:", err);
      return {
        success: false,
        error: err?.message || "Falha ao criar candidato",
      };
    }
  };

  const updateCandidato = async (id, data) => {
    try {
      await api.put(`/candidatos/${id}`, data);
      setCandidatos((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...data } : c)),
      );
      return { success: true };
    } catch (err) {
      console.error("Erro ao atualizar candidato:", err);
      return { success: false, error: err?.message };
    }
  };

  const deleteCandidato = async (id) => {
    if (
      !confirm(
        "Excluir este candidato? Os matches associados também serão removidos.",
      )
    )
      return;
    try {
      await api.delete(`/candidatos/${id}`);
      setCandidatos((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.error("Erro ao excluir candidato:", err);
      alert("Erro ao excluir: " + (err?.message || "erro de rede"));
    }
  };

  const handleLogin = async (
    role,
    associadoData = null,
    token = null,
    universidadeData = null,
  ) => {
    if (token) {
      api.setToken(token);
    }
    setUser({ role, associado: associadoData, universidade: universidadeData });
    navigate(`${APP_BASE}/dashboard`, { replace: true });
  };

  const handleLogout = () => {
    api.clearToken();
    clearReadNotifications();
    setUser(null);
    setEmpresas([]);
    setAssociados([]);
    setEventos([]);
    setMatches([]);
    setUniversidades([]);
    setCandidatos([]);
    setVagas([]);
    setMatchVagas([]);
    navigate("/", { replace: true });
  };

  // Verificar token salvo ao iniciar (revalida via /auth/me)
  useEffect(() => {
    const token = api.token;
    if (!token) {
      setAuthChecked(true);
      return;
    }
    api
      .get("/auth/me")
      .then((userData) => {
        const userRole = (userData.role || "").toLowerCase();
        if (userRole === "admin") {
          setUser({ role: "admin" });
        } else if (userRole === "universidade" && userData.universidade) {
          setUser({
            role: "universidade",
            universidade: userData.universidade,
          });
        } else if (userData.associado) {
          setUser({ role: "associado", associado: userData.associado });
        } else {
          api.clearToken();
        }
      })
      .catch(() => {
        api.clearToken();
      })
      .finally(() => {
        setAuthChecked(true);
      });
  }, []);

  const roleForNav = user?.role;

  const setPage = useCallback(
    (id) => {
      if (!roleForNav) return;
      const target = sanitizeModuleId(id, roleForNav);
      navigate(`${APP_BASE}/${target}`);
    },
    [navigate, roleForNav],
  );

  const currentPage = useMemo(() => {
    if (!roleForNav) return "dashboard";
    const raw = rawPageFromPathname(location.pathname);
    if (raw === null) return "dashboard";
    return sanitizeModuleId(raw, roleForNav);
  }, [location.pathname, roleForNav]);

  useEffect(() => {
    if (!user || !authChecked || !user.role) return;
    const role = user.role;
    const norm = (p) => (p || "/").replace(/\/+$/, "") || "/";
    const path = norm(location.pathname);
    if (path === "/" || path === "") {
      navigate(`${APP_BASE}/dashboard`, { replace: true });
      return;
    }
    const raw = rawPageFromPathname(location.pathname);
    if (raw === null) {
      navigate(`${APP_BASE}/dashboard`, { replace: true });
      return;
    }
    const target = sanitizeModuleId(raw, role);
    const expected = norm(`${APP_BASE}/${target}`);
    if (path !== expected) {
      navigate(`${APP_BASE}/${target}`, { replace: true });
    }
  }, [user, authChecked, location.pathname, navigate]);

  // Se está deslogado MAS a URL ainda aponta pra rota autenticada (/app/*),
  // força pra "/" pra mostrar a tela de login coerentemente. Isso evita que
  // o navegador fique com URL tipo /app/novo-evento enquanto exibe o login.
  useEffect(() => {
    if (!authChecked || user) return;
    const path = (location.pathname || "/").replace(/\/+$/, "") || "/";
    if (path.startsWith(APP_BASE)) {
      navigate("/", { replace: true });
    }
  }, [authChecked, user, location.pathname, navigate]);

  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#1E1F36",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#94a3b8",
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          fontSize: 14,
        }}
      >
        Carregando sessão…
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} associados={associados} />;
  }

  const role = user.role;

  const titles = {
    dashboard:
      role === "admin"
        ? "Dashboard"
        : role === "universidade"
          ? "Portal da Universidade"
          : "Portal do Associado",
    "assoc-empresa": role === "admin" ? "Assoc × Empresa" : "Meus Matches",
    "assoc-assoc": "Assoc. x Assoc.",
    "univ-assoc": "Universidades × Associados",
    "eventos-empresas": "Eventos × Empresas",
    "eventos-associados": "Eventos × Associados",
    "eventos-assoc-empresa": "Eventos × Assoc × Empresa",
    "gestao-eventos": "Gestão de Eventos",
    "gestao-empresa": "Gestão de Empresas",
    "gestao-associados": "Gestão de Associados",
    "gestao-universidades": "Gestão de Universidades",
    "meu-perfil": "Meu Perfil",
    "meu-perfil-univ": "Meu Perfil",
    "minhas-vagas": "Minhas Vagas",
    "meus-candidatos": "Meus Candidatos",
    "univ-matches": "Matches dos Candidatos",
    "nova-empresa": "Cadastro de Empresas",
    "novo-associado": "Novo Associado",
    "novo-evento": "Cadastro de Eventos",
    "nova-universidade": "Cadastro de Universidades",
  };

  const adminPages = {
    dashboard: (
      <DashboardPage
        setPage={setPage}
        matchesData={matches}
        empresas={empresas}
        associados={associados}
        eventos={eventos}
        onRegenerateMatches={regenerateAllMatchesWrapped}
      />
    ),
    "assoc-empresa": (
      <MatchesPage
        matchesData={matches}
        role="admin"
        onRegenerateMatches={regenerateAllMatchesWrapped}
        associados={associados}
        empresas={empresas}
      />
    ),
    "assoc-assoc": (
      <B2BPage
        role="admin"
        onRegenerateMatches={regenerateAllMatchesWrapped}
        associados={associados}
      />
    ),
    "eventos-empresas": (
      <EventosEmpresasPage
        eventosData={eventos}
        empresas={empresas}
        associados={associados}
        matchesData={matches}
        onRegenerateMatches={regenerateAllMatchesWrapped}
        onToggleConfirmacao={toggleConfirmacaoParticipante}
      />
    ),
    "eventos-associados": (
      <EventosAssociadosPage
        eventosData={eventos}
        associados={associados}
        empresas={empresas}
        matchesData={matches}
        onRegenerateMatches={regenerateAllMatchesWrapped}
      />
    ),
    "eventos-assoc-empresa": <EventosAssocEmpresaPage eventosData={eventos} />,
    "gestao-eventos": (
      <GestaoEventosPage
        setPage={setPage}
        eventosData={eventos}
        onUpdate={updateEvento}
        onDelete={deleteEvento}
        onToggleStatus={toggleEventoStatus}
      />
    ),
    "gestao-empresa": (
      <GestaoPage
        setPage={setPage}
        empresasData={empresas}
        onDelete={deleteEmpresa}
      />
    ),
    "gestao-associados": (
      <GestaoAssociadosPage
        setPage={setPage}
        associadosData={associados}
        onDelete={deleteAssociado}
        onUpdate={updateAssociado}
        onResetSenha={resetSenhaAssociado}
      />
    ),
    "nova-empresa": (
      <NovaEmpresaPage
        setPage={setPage}
        onAdd={addEmpresa}
        associados={associados}
      />
    ),
    "novo-associado": (
      <NovoAssociadoPage
        setPage={setPage}
        onAdd={addAssociado}
        empresas={empresas}
      />
    ),
    "novo-evento": <NovoEventoPage setPage={setPage} onAdd={addEvento} />,
    // Módulo Universidades × Associados
    "univ-assoc": (
      <UnivAssocPage
        matchVagasData={matchVagas}
        universidadesData={universidades}
        onRegenerate={regenerateMatchVagasWrapped}
      />
    ),
    "gestao-universidades": (
      <GestaoUniversidadesPage
        setPage={setPage}
        universidadesData={universidades}
        onDelete={deleteUniversidade}
        onUpdate={updateUniversidade}
        onResetSenha={resetSenhaUniversidade}
      />
    ),
    "nova-universidade": (
      <NovaUniversidadePage setPage={setPage} onAdd={addUniversidade} />
    ),
  };

  const assocPages = {
    dashboard: (
      <AssociadoDashboard
        setPage={setPage}
        associadoLogado={user?.associado}
        matchesData={matches}
        empresasData={empresas}
      />
    ),
    "assoc-empresa": (
      <MatchesPage
        matchesData={matches}
        role="associado"
        associadoLogado={user?.associado}
      />
    ),
    "assoc-assoc": (
      <B2BPage
        role="associado"
        associadoLogado={user?.associado}
        associados={associados}
      />
    ),
    "minhas-vagas": (
      <MinhasVagasPage
        associadoLogado={user?.associado}
        vagasData={vagas}
        onAdd={addVaga}
        onUpdate={updateVaga}
        onDelete={deleteVaga}
      />
    ),
    "meu-perfil": (
      <MeuPerfilPage
        associadoLogado={user?.associado}
        onUpdate={updateAssociado}
      />
    ),
  };

  // Páginas do portal da Universidade
  const univPages = {
    dashboard: (
      <UnivDashboard
        setPage={setPage}
        universidadeLogada={user?.universidade}
        candidatosData={candidatos}
        matchVagasData={matchVagas}
      />
    ),
    "meus-candidatos": (
      <MeusCandidatosPage
        universidadeLogada={user?.universidade}
        candidatosData={candidatos}
        onAdd={addCandidato}
        onUpdate={updateCandidato}
        onDelete={deleteCandidato}
      />
    ),
    "univ-matches": (
      <UnivMatchesPage
        universidadeLogada={user?.universidade}
        matchVagasData={matchVagas}
      />
    ),
    "meu-perfil-univ": (
      <MeuPerfilUnivPage
        universidadeLogada={user?.universidade}
        onUpdate={updateUniversidade}
      />
    ),
  };

  const pages =
    role === "admin"
      ? adminPages
      : role === "universidade"
        ? univPages
        : assocPages;

  const activePage = pages[currentPage] || pages["dashboard"];

  // ─── Gerar Notificações ───
  // Nota: hoje não há fonte real de notificações (precisaria de uma tabela
  // Notification no banco populada por eventos de negócio). Enquanto não existe,
  // esta função retorna vazio. Antes, ela fabricava "notificações" derivadas de
  // contagens do banco (tipo "5 empresas no sistema"), com horários hardcoded
  // ("5 min atrás") que não refletiam eventos reais — confundia o usuário.
  const generateNotifications = () => {
    return [];
  };

  const notifications = generateNotifications();

  const handleNotificationClick = (action) => {
    if (action) setPage(action);
  };

  return (
    <div
      style={{
        background: colors.bg,
        minHeight: "100vh",
        color: colors.text,
        fontFamily: "'Segoe UI', -apple-system, sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700;800&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@800;900&display=swap');

        /* Reset global */
        html, body, #root { margin: 0; padding: 0; width: 100%; }
        body { overflow-x: hidden; }
        *, *::before, *::after { box-sizing: border-box; }

        /* Scrollbar padrão (contexto CLARO: main content, modais, listas brancas) */
        ::-webkit-scrollbar { width: 10px; height: 10px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
          background: rgba(100, 116, 139, 0.28);
          border-radius: 10px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        ::-webkit-scrollbar-thumb:hover { background: rgba(100, 116, 139, 0.55); background-clip: padding-box; border: 2px solid transparent; }
        ::-webkit-scrollbar-corner { background: transparent; }

        /* Scrollbar contextual para elementos com fundo escuro (sidebar, cards dark) */
        .scroll-dark::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          background-clip: padding-box;
          border: 2px solid transparent;
        }
        .scroll-dark::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.28);
          background-clip: padding-box;
          border: 2px solid transparent;
        }

        /* Firefox usa propriedades diferentes */
        html { scrollbar-width: thin; scrollbar-color: rgba(100,116,139,0.28) transparent; }
        .scroll-dark { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }

        input::placeholder, textarea::placeholder { color: #9ca3af; opacity: 1; }
        select option { background: #fff; color: ${colors.text}; }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <Sidebar
        page={currentPage}
        setPage={setPage}
        role={role}
        onLogout={handleLogout}
        matchesCount={matches.filter((m) => m.status === "Pending").length}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebarCollapsed}
        toggleSection={toggleSidebarSection}
        isSectionOpen={isSidebarSectionOpen}
      />
      <div
        style={{
          marginLeft: sidebarCollapsed ? 64 : 240,
          display: "flex",
          flexDirection: "column",
          minHeight: "100vh",
          transition: "margin-left 0.22s ease",
        }}
      >
        <TopBar
          title={titles[currentPage]}
          notifications={notifications}
          onNotificationClick={handleNotificationClick}
          readIds={readIds}
          onMarkAsRead={markAsRead}
          onMarkAllAsRead={markAllAsRead}
        />
        <div style={{ overflowY: "auto", flex: 1 }}>{activePage}</div>
        {/* Footer */}
        <div
          style={{
            padding: "6px 28px",
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11, color: "#888" }}>Desenvolvido por</span>
          <img
            src="https://atlantyx.io/wp-content/uploads/2025/06/img-atx-logo-w.png"
            alt="Atlantyx"
            style={{ height: 14, opacity: 0.7 }}
          />
        </div>
      </div>
    </div>
  );
}
