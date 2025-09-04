"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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

const pollSchema = z.object({
  question: z.string().min(5, "Question must be at least 5 characters long").max(255, "Question cannot exceed 255 characters").trim(),
  options: z.array(z.string().min(1, "Option cannot be empty").max(100, "Option cannot exceed 100 characters").trim()).min(2, "Please provide at least two options"),
});

const voteSchema = z.object({
  pollId: z.string().uuid("Invalid poll ID format"),
  optionIndex: z.number().int().min(0, "Option index cannot be negative"),
});

const idSchema = z.string().uuid("Invalid ID format");

// CREATE POLL
export async function createPoll(formData: FormData) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  const rateLimitKey = user ? `create-poll-${user.id}` : `create-poll-anonymous`;
  if (!checkRateLimit(rateLimitKey)) {
    return { error: "Too many poll creation attempts. Please try again later." };
  }

  const { question, options } = pollSchema.parse({
    question: formData.get("question"),
    options: formData.getAll("options").filter(Boolean),
  });

  // Get user from session
  const {
    data: { user: sessionUser },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    return { error: userError.message };
  }
  if (!sessionUser) {
    return { error: "You must be logged in to create a poll." };
  }

  const { error } = await supabase.from("polls").insert([
    {
      user_id: sessionUser.id,
      question,
      options,
    },
  ]);

  if (error) {
    console.error("Error creating poll:", error);
    return { error: "Failed to create poll. Please try again." };
  }

  revalidatePath("/polls");
  return { error: null };
}

// GET USER POLLS
export async function getUserPolls() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { polls: [], error: "Not authenticated" };

  const { data, error } = await supabase
    .from("polls")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error getting user polls:", error);
    return { polls: [], error: "Failed to retrieve user polls." };
  }
  return { polls: data ?? [], error: null };
}

// GET POLL BY ID
export async function getPollById(id: string) {
  const supabase = await createClient();
  const validatedId = idSchema.safeParse(id);
  if (!validatedId.success) {
    return { poll: null, error: validatedId.error.flatten().formErrors[0] };
  }

  const { data, error } = await supabase
    .from("polls")
    .select("*")
    .eq("id", validatedId.data)
    .single();

  if (error) {
    console.error("Error getting poll by ID:", error);
    return { poll: null, error: "Failed to retrieve poll." };
  }
  return { poll: data, error: null };
}

// SUBMIT VOTE
export async function submitVote(pollId: string, optionIndex: number) {
  const supabase = await createClient();
  const validatedVoteData = voteSchema.safeParse({ pollId, optionIndex });
  if (!validatedVoteData.success) {
    return { error: validatedVoteData.error.flatten().formErrors[0] };
  }

  const { pollId: validatedPollId, optionIndex: validatedOptionIndex } = validatedVoteData.data;

  const { data: { user } } = await supabase.auth.getUser();
  const rateLimitKey = user ? `submit-vote-${user.id}` : `submit-vote-anonymous`;
  if (!checkRateLimit(rateLimitKey)) {
    return { error: "Too many voting attempts. Please try again later." };
  }

  const { data: pollData, error: pollError } = await supabase
    .from("polls")
    .select("options")
    .eq("id", validatedPollId)
    .single();

  if (pollError || !pollData) {
    console.error("Error fetching poll for voting:", pollError);
    return { error: "Poll not found or failed to retrieve poll options." };
  }

  if (validatedOptionIndex < 0 || validatedOptionIndex >= pollData.options.length) {
    return { error: "Invalid option selected." };
  }

  const { data: { user: sessionUser } } = await supabase.auth.getUser();

  // Prevent duplicate votes for authenticated users
  if (sessionUser) {
    const { data: existingVote, error: existingVoteError } = await supabase
      .from("votes")
      .select("id")
      .eq("poll_id", validatedPollId)
      .eq("user_id", sessionUser.id)
      .single();

    if (existingVote) {
      return { error: "You have already voted on this poll." };
    }
    if (existingVoteError && existingVoteError.code !== 'PGRST116') { // PGRST116 is 'no rows found'
      console.error("Error checking for existing vote:", existingVoteError);
      return { error: "Failed to check for existing vote." };
    }
  }

  const { error } = await supabase.from("votes").insert([
    {
      poll_id: validatedPollId,
      user_id: sessionUser?.id ?? null,
      option_index: validatedOptionIndex,
    },
  ]);

  if (error) {
    console.error("Error submitting vote:", error);
    return { error: "Failed to submit vote. Please try again." };
  }
  return { error: null };
}

// DELETE POLL
export async function deletePoll(id: string) {
  const supabase = await createClient();

  const validatedId = idSchema.safeParse(id);
  if (!validatedId.success) {
    return { error: validatedId.error.flatten().formErrors[0] };
  }

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  const rateLimitKey = user ? `delete-poll-${user.id}` : `delete-poll-anonymous`;
  if (!checkRateLimit(rateLimitKey)) {
    return { error: "Too many poll deletion attempts. Please try again later." };
  }

  if (userError) {
    return { error: userError.message };
  }
  if (!user) {
    return { error: "You must be logged in to delete a poll." };
  }

  // Check if the user is the owner of the poll
  const { data: poll, error: fetchPollError } = await supabase
    .from("polls")
    .select("user_id")
    .eq("id", validatedId.data)
    .single();

  if (fetchPollError || !poll) {
    console.error("Error fetching poll for deletion:", fetchPollError);
    return { error: "Poll not found or failed to verify ownership." };
  }

  if (poll.user_id !== user.id) {
    return { error: "You are not authorized to delete this poll." };
  }

  const { error } = await supabase.from("polls").delete().eq("id", validatedId.data).eq("user_id", user.id);
  if (error) {
    console.error("Error deleting poll:", error);
    return { error: "Failed to delete poll. Please try again." };
  }
  revalidatePath("/polls");
  return { error: null };
}

// UPDATE POLL
export async function updatePoll(pollId: string, formData: FormData) {
  const supabase = await createClient();

  const validatedPollId = idSchema.safeParse(pollId);
  if (!validatedPollId.success) {
    return { error: validatedPollId.error.flatten().formErrors[0] };
  }

  const { data: { user } } = await supabase.auth.getUser();
  const rateLimitKey = user ? `update-poll-${user.id}` : `update-poll-anonymous`;
  if (!checkRateLimit(rateLimitKey)) {
    return { error: "Too many poll update attempts. Please try again later." };
  }

  const { question, options } = pollSchema.parse({
    question: formData.get("question"),
    options: formData.getAll("options").filter(Boolean),
  });

  // Get user from session
  const {
    data: { user: sessionUser },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) {
    return { error: userError.message };
  }
  if (!sessionUser) {
    return { error: "You must be logged in to update a poll." };
  }

  // Only allow updating polls owned by the user
  const { error } = await supabase
    .from("polls")
    .update({ question, options })
    .eq("id", validatedPollId.data)
    .eq("user_id", sessionUser.id);

  if (error) {
    console.error("Error updating poll:", error);
    return { error: "Failed to update poll. Please try again." };
  }

  return { error: null };
}
