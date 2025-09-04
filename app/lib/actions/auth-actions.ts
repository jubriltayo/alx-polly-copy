'use server';

import { createClient } from '@/lib/supabase/server';
import { LoginFormData, RegisterFormData } from '../types';
import { z } from 'zod';

const rateLimit = new Map<string, { count: number; lastReset: number }>();
const MAX_ATTEMPTS = 5;
const RESET_INTERVAL = 60 * 1000; // 1 minute

function checkRateLimit(key: string) {
  const now = Date.now();
  if (!rateLimit.has(key) || now - rateLimit.get(key)!.lastReset > RESET_INTERVAL) {
    rateLimit.set(key, { count: 1, lastReset: now });
    return true;
  }

  const entry = rateLimit.get(key)!;
  if (entry.count >= MAX_ATTEMPTS) {
    return false; // Rate limit exceeded
  }

  entry.count++;
  return true;
}

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters long'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
});

export async function login(data: LoginFormData) {
  const supabase = await createClient();

  if (!checkRateLimit(`login-${data.email}`)) {
    return { error: 'Too many login attempts. Please try again later.' };
  }

  const validatedData = loginSchema.safeParse(data);
  if (!validatedData.success) {
    return { error: validatedData.error.flatten().formErrors[0] };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: validatedData.data.email,
    password: validatedData.data.password,
  });

  if (error) {
    return { error: 'Login failed. Please check your credentials.' };
  }

  // Success: no error
  return { error: null };
}

export async function register(data: RegisterFormData) {
  const supabase = await createClient();

  if (!checkRateLimit(`register-${data.email}`)) {
    return { error: 'Too many registration attempts. Please try again later.' };
  }

  const validatedData = registerSchema.safeParse(data);
  if (!validatedData.success) {
    return { error: validatedData.error.flatten().formErrors[0] };
  }

  const { error } = await supabase.auth.signUp({
    email: validatedData.data.email,
    password: validatedData.data.password,
    options: {
      data: {
        name: validatedData.data.name,
      },
    },
  });

  if (error) {
    return { error: 'Registration failed' };
  }

  // Success: no error
  return { error: null };
}

export async function logout() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    // Log the actual error for debugging, but return a generic message
    console.error("Logout error:", error);
    return { error: 'Logout failed. Please try again.' };
  }
  return { error: null };
}

export async function getCurrentUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function getSession()
 {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session;
}
