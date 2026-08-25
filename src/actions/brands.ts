"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/db/server";
import { getOwnedBrand } from "@/lib/db/queries";
import { brandInputSchema, fieldErrors, uuidSchema } from "@/lib/validation";
import { describeError, failure } from "@/actions/result";
import type { ActionResult } from "@/actions/result";

function readBrandForm(formData: FormData) {
  return brandInputSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    industry: formData.get("industry") ?? "",
    website: formData.get("website") ?? "",
    audience: formData.get("audience") ?? "",
    positioning: formData.get("positioning") ?? "",
  });
}

export async function createBrand(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const parsed = readBrandForm(formData);
  if (!parsed.success) return failure("Check the fields below.", fieldErrors(parsed.error));

  let brandId: string;

  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("brands")
      .insert({
        owner_id: user.id,
        name: parsed.data.name,
        description: parsed.data.description,
        industry: parsed.data.industry,
        website: parsed.data.website,
        audience: parsed.data.audience,
        positioning: parsed.data.positioning,
      })
      .select("id")
      .single();

    if (error) return failure("The brand could not be created.");
    brandId = data.id as string;
  } catch (error) {
    return failure(describeError(error));
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/brands/${brandId}`);
}

export async function updateBrand(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const id = uuidSchema.safeParse(formData.get("brandId"));
  if (!id.success) return failure("Missing brand identifier.");

  const parsed = readBrandForm(formData);
  if (!parsed.success) return failure("Check the fields below.", fieldErrors(parsed.error));

  try {
    const { supabase } = await requireUser();
    await getOwnedBrand(supabase, id.data);

    const { error } = await supabase
      .from("brands")
      .update({
        name: parsed.data.name,
        description: parsed.data.description,
        industry: parsed.data.industry,
        website: parsed.data.website,
        audience: parsed.data.audience,
        positioning: parsed.data.positioning,
      })
      .eq("id", id.data);

    if (error) return failure("The brand could not be updated.");
  } catch (error) {
    return failure(describeError(error));
  }

  revalidatePath(`/dashboard/brands/${id.data}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteBrand(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const id = uuidSchema.safeParse(formData.get("brandId"));
  if (!id.success) return failure("Missing brand identifier.");

  try {
    const { supabase } = await requireUser();
    await getOwnedBrand(supabase, id.data);

    const { error } = await supabase.from("brands").delete().eq("id", id.data);
    if (error) return failure("The brand could not be deleted.");
  } catch (error) {
    return failure(describeError(error));
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
