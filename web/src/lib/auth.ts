// SynapseDB Authentication Layer
// Fully connected to backend Heroku REST API with local session caching

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  token: string;
}

const SESSION_KEY = "synapsedb_auth_session";

export function getCachedUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(user: User): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } catch {}
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

export async function signUp(
  name: string,
  email: string,
  password: string,
  apiUrl: string
): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    const base = (apiUrl || "").replace(/\/$/, "");
    const res = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok || data.status === "error") {
      return { success: false, error: data.error || data.message || "Registration failed." };
    }
    const user: User = {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      createdAt: data.user.created_at || new Date().toISOString(),
      token: data.token,
    };
    saveSession(user);
    return { success: true, user };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to connect to backend." };
  }
}

export async function signIn(
  email: string,
  password: string,
  apiUrl: string
): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    const base = (apiUrl || "").replace(/\/$/, "");
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok || data.status === "error") {
      return { success: false, error: data.error || data.message || "Invalid email or password." };
    }
    const user: User = {
      id: data.user.id,
      name: data.user.name,
      email: data.user.email,
      createdAt: data.user.created_at || new Date().toISOString(),
      token: data.token,
    };
    saveSession(user);
    return { success: true, user };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to connect to backend." };
  }
}

export async function verifySession(apiUrl: string): Promise<User | null> {
  const cached = getCachedUser();
  if (!cached || !cached.token) return null;
  try {
    const base = (apiUrl || "").replace(/\/$/, "");
    const res = await fetch(`${base}/auth/me`, {
      headers: {
        Authorization: `Bearer ${cached.token}`,
      },
    });

    if (res.status === 401) {
      try {
        const data = await res.json();
        if (data.status === "error") {
          clearSession();
          return null;
        }
      } catch {
        clearSession();
        return null;
      }
    }

    if (!res.ok) {
      // Backend is cold-booting / waking up from Heroku sleep (502/503/504)
      // Retain cached session so user is not logged out during wake-up
      return cached;
    }

    const data = await res.json();
    if (data.status === "success" && data.user) {
      const updated: User = {
        ...cached,
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
      };
      saveSession(updated);
      return updated;
    }
    return cached;
  } catch {
    // Network error or timeout during cold-boot wake-up: keep cached user
    return cached;
  }
}

export async function signOut(apiUrl: string): Promise<void> {
  const cached = getCachedUser();
  if (cached && cached.token) {
    try {
      const base = (apiUrl || "").replace(/\/$/, "");
      await fetch(`${base}/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cached.token}`,
        },
      });
    } catch {}
  }
  clearSession();
}

export async function demoLogin(apiUrl: string): Promise<{ success: boolean; user?: User; error?: string }> {
  try {
    const base = (apiUrl || "").replace(/\/$/, "");
    const res = await fetch(`${base}/auth/demo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (res.ok && data.status === "success") {
      const user: User = {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        createdAt: data.user.created_at || new Date().toISOString(),
        token: data.token,
      };
      saveSession(user);
      return { success: true, user };
    }
  } catch {}

  const fallbackGuest: User = {
    id: "guest_" + Math.random().toString(36).substring(2, 7),
    name: "Guest Explorer",
    email: "guest@synapsedb.demo",
    createdAt: new Date().toISOString(),
    token: "syn_guest_offline",
  };
  saveSession(fallbackGuest);
  return { success: true, user: fallbackGuest };
}
