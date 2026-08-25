"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/db/server";
import { getOwnedBrand, getOwnedConversation, listMessages } from "@/lib/db/queries";
import { generateForBrand } from "@/lib/ai/generation";
import { generateInputSchema } from "@/lib/validation";
import { describeError, failure } from "@/actions/result";
import type { ActionResult } from "@/actions/result";
import type { ChatMessage } from "@/types/domain";
import { toChatMessage } from "@/lib/db/mappers";
import type { MessageRow } from "@/types/database";

export interface GenerationResponse {
  conversationId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  conflicts: string[];
}

export async function sendMessage(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<GenerationResponse>> {
  const parsed = generateInputSchema.safeParse({
    brandId: formData.get("brandId"),
    conversationId: formData.get("conversationId") || null,
    mode: formData.get("mode") ?? "ASK",
    prompt: formData.get("prompt"),
  });

  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? "That request is not valid.");
  }

  try {
    const { supabase } = await requireUser();
    const brand = await getOwnedBrand(supabase, parsed.data.brandId);

    let conversationId = parsed.data.conversationId ?? null;
    if (conversationId) {
      const conversation = await getOwnedConversation(supabase, conversationId);
      conversationId = conversation.id;
    } else {
      const { data, error } = await supabase
        .from("conversations")
        .insert({ brand_id: brand.id, title: parsed.data.prompt.slice(0, 80) })
        .select("id")
        .single();
      if (error || !data) return failure("The conversation could not be started.");
      conversationId = data.id as string;
    }

    const history = await listMessages(supabase, conversationId);

    const { data: userRow, error: userError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        brand_id: brand.id,
        role: "user",
        content: parsed.data.prompt,
        mode: parsed.data.mode,
        retrieval: [],
      })
      .select("*")
      .single();

    if (userError || !userRow) return failure("Your message could not be saved.");

    const result = await generateForBrand(
      supabase,
      brand,
      parsed.data.prompt,
      parsed.data.mode,
      history.map((message) => ({ role: message.role, content: message.content })),
    );

    const { data: assistantRow, error: assistantError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        brand_id: brand.id,
        role: "assistant",
        content: result.text,
        mode: parsed.data.mode,
        retrieval: result.citations,
      })
      .select("*")
      .single();

    if (assistantError || !assistantRow) return failure("The response could not be saved.");

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    revalidatePath(`/dashboard/brands/${brand.id}/generate`);

    return {
      ok: true,
      data: {
        conversationId,
        userMessage: toChatMessage(userRow as MessageRow),
        assistantMessage: toChatMessage(assistantRow as MessageRow),
        conflicts: result.conflicts,
      },
    };
  } catch (error) {
    return failure(describeError(error));
  }
}
