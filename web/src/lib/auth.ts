// SynapseDB Authentication Layer
// Stores user accounts and active session in localStorage (zero external API keys needed)

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  token: string;
}

const SESSION_KEY = "synapsedb_auth_session";
const USERS_KEY = "synapsedb_registered_users";

function getRegisteredUsers(): Record<string, { name: string; passwordHash: string; createdAt: string; id: string }> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveRegisteredUsers(users: Record<string, { name: string; passwordHash: string; createdAt: string; id: string }>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch {}
}

export function getCurrentUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function signUp(name: string, email: string, password: string): { success: boolean; user?: User; error?: string } {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanName) {
    return { success: false, error: "Please enter your full name." };
  }
  if (!cleanEmail || !cleanEmail.includes("@") || !cleanEmail.includes(".")) {
    return { success: false, error: "Please enter a valid email address." };
  }
  if (!password || password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters long." };
  }

  const users = getRegisteredUsers();
  if (users[cleanEmail]) {
    return { success: false, error: "An account with this email already exists. Please sign in." };
  }

  const id = "usr_" + Math.random().toString(36).substring(2, 9);
  const userRecord = {
    id,
    name: cleanName,
    passwordHash: btoa(password), // simple base64 obfuscation for local storage
    createdAt: new Date().toISOString(),
  };

  users[cleanEmail] = userRecord;
  saveRegisteredUsers(users);

  const user: User = {
    id,
    name: cleanName,
    email: cleanEmail,
    createdAt: userRecord.createdAt,
    token: "synapse_tok_" + Math.random().toString(36).substring(2, 15),
  };

  if (typeof window !== "undefined") {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }

  return { success: true, user };
}

export function signIn(email: string, password: string): { success: boolean; user?: User; error?: string } {
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanEmail) {
    return { success: false, error: "Please enter your email address." };
  }
  if (!password) {
    return { success: false, error: "Please enter your password." };
  }

  const users = getRegisteredUsers();
  const found = users[cleanEmail];

  if (!found) {
    return { success: false, error: "No account found with this email. Please create an account." };
  }

  if (found.passwordHash !== btoa(password)) {
    return { success: false, error: "Incorrect password. Please try again." };
  }

  const user: User = {
    id: found.id,
    name: found.name,
    email: cleanEmail,
    createdAt: found.createdAt,
    token: "synapse_tok_" + Math.random().toString(36).substring(2, 15),
  };

  if (typeof window !== "undefined") {
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }

  return { success: true, user };
}

export function demoLogin(): User {
  const demoUser: User = {
    id: "demo_guest",
    name: "Demo Explorer",
    email: "demo@synapsedb.local",
    createdAt: new Date().toISOString(),
    token: "demo_token_quick_access",
  };

  if (typeof window !== "undefined") {
    localStorage.setItem(SESSION_KEY, JSON.stringify(demoUser));
  }

  return demoUser;
}

export function signOut(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}
