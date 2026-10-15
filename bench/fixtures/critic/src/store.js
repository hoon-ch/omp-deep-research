import { hashPassword, verifyPassword } from "./password.js";

const users = new Map();
export function register(name, password) { users.set(name, hashPassword(password)); }
export function login(name, password) { const h = users.get(name); return h !== undefined && verifyPassword(password, h); }
