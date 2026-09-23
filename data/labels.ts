import { labels } from "@peppol/db/schema";
import { db } from "@recommand/db";
import { eq, and } from "drizzle-orm";
import { UserFacingError } from "@peppol/utils/util";

export type Label = typeof labels.$inferSelect;
export type InsertLabel = typeof labels.$inferInsert;

export async function getLabels(teamId: string): Promise<Label[]> {
  return await db.select().from(labels).where(eq(labels.teamId, teamId));
}

export async function getLabel(
  teamId: string,
  labelId: string
): Promise<Label | undefined> {
  return await db
    .select()
    .from(labels)
    .where(and(eq(labels.teamId, teamId), eq(labels.id, labelId)))
    .then((rows) => rows[0]);
}

export async function createLabel(label: InsertLabel): Promise<Label> {
  const createdLabel = await db
    .insert(labels)
    .values(label)
    .returning()
    .then((rows) => rows[0]);

  return createdLabel;
}

export async function updateLabel(
  label: Partial<InsertLabel> & { id: string; teamId: string }
): Promise<Label> {
  const oldLabel = await getLabel(label.teamId, label.id);
  if (!oldLabel) {
    throw new UserFacingError("Label not found");
  }

  const updatedFields = Object.fromEntries(
    Object.entries(label).filter(([_, value]) => value !== undefined)
  );

  const updatedLabel = await db
    .update(labels)
    .set(updatedFields)
    .where(and(eq(labels.teamId, label.teamId), eq(labels.id, label.id)))
    .returning()
    .then((rows) => rows[0]);

  return updatedLabel;
}

export async function deleteLabel(
  teamId: string,
  labelId: string
): Promise<void> {
  const label = await db
    .select()
    .from(labels)
    .where(and(eq(labels.teamId, teamId), eq(labels.id, labelId)))
    .then((rows) => rows[0]);
  if (!label) {
    throw new UserFacingError("Label not found");
  }
  await db
    .delete(labels)
    .where(and(eq(labels.teamId, teamId), eq(labels.id, labelId)));
}

