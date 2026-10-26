/**
 * Rúbrica fijada antes de responder (spec §7.1).
 *
 * - `max_points` entero 1..100.
 * - `anchors` cubre exactamente los enteros 0..max (sin huecos, duplicados ni fuera de rango).
 * - `skill_weights` con al menos un peso entero 1..100 por criterio.
 * - Todo skill del ítem debe aparecer en al menos un criterio (`uncoveredSkills`).
 *
 * La rúbrica se congela con su digest canónico antes de la respuesta; nada de scoring vive aquí.
 */
import { z } from 'zod';
import { canonicalDigest } from './canonical.js';
import { MAX_DESCRIPTION_CHARS, MAX_LIST_ITEMS } from './constants.js';
import { extensionsSchema, resourceIdSchema, schemaVersionSchema, semverSchema } from './primitives.js';

export const rubricAnchorSchema = z
  .object({
    points: z.int().min(0).max(100),
    description: z.string().min(1).max(MAX_DESCRIPTION_CHARS),
  })
  .strict();

export type RubricAnchor = z.output<typeof rubricAnchorSchema>;

export const rubricCriterionSchema = z
  .object({
    id: resourceIdSchema,
    description: z.string().min(1).max(MAX_DESCRIPTION_CHARS),
    max_points: z.int().min(1).max(100),
    anchors: z.array(rubricAnchorSchema).min(1).max(101),
    skill_weights: z.record(resourceIdSchema, z.int().min(1).max(100)),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.anchors.forEach((anchor, index) => {
      if (anchor.points > value.max_points) {
        ctx.addIssue({
          code: 'custom',
          path: ['anchors', index, 'points'],
          message: `anchor points ${anchor.points} exceed max_points ${value.max_points}`,
        });
        return;
      }
      if (seen.has(anchor.points)) {
        ctx.addIssue({
          code: 'custom',
          path: ['anchors', index, 'points'],
          message: `duplicate anchor for points ${anchor.points}`,
        });
      }
      seen.add(anchor.points);
    });
    for (let points = 0; points <= value.max_points; points += 1) {
      if (!seen.has(points)) {
        ctx.addIssue({
          code: 'custom',
          path: ['anchors'],
          message: `missing anchor for points ${points} (anchors must cover 0..${value.max_points})`,
        });
      }
    }
    if (Object.keys(value.skill_weights).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['skill_weights'],
        message: 'each criterion needs at least one skill weight (1..100)',
      });
    }
  })
  .meta({
    'x-runtime-validation':
      'Zod superRefine enforces the complete anchor set 0..max_points and a non-empty weight map; JSON Schema cannot check coverage of a numeric range with uniqueness by property.',
  });

export type RubricCriterion = z.output<typeof rubricCriterionSchema>;

export const rubricSchema = z
  .object({
    schema_version: schemaVersionSchema,
     rubric_id: resourceIdSchema,
    version: semverSchema,
    criteria: z.array(rubricCriterionSchema).min(1).max(MAX_LIST_ITEMS),
    extensions: extensionsSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.criteria.forEach((criterion, index) => {
      if (seen.has(criterion.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['criteria', index, 'id'],
          message: `duplicate criterion id: ${criterion.id}`,
        });
      }
      seen.add(criterion.id);
    });
  })
  .meta({
    'x-runtime-validation':
      'Zod superRefine enforces unique criterion ids; JSON Schema uniqueItems cannot compare by a property.',
  });

export type Rubric = z.output<typeof rubricSchema>;

/**
 * Habilidades del ítem sin ningún criterio que las evalúe (§7.1: «todas sus habilidades
 * tienen al menos un criterio»). Devuelve las que faltan, en orden declarado.
 */
export function uncoveredSkills(rubric: Rubric, skillIds: readonly string[]): string[] {
  const covered = new Set<string>();
  for (const criterion of rubric.criteria) {
    for (const skillId of Object.keys(criterion.skill_weights)) covered.add(skillId);
  }
  return skillIds.filter((skillId) => !covered.has(skillId));
}

/** SHA-256 canónico de la rúbrica, fijado antes de la respuesta (RFC 8785, §6.2). */
export function rubricDigest(rubric: Rubric): string {
  return canonicalDigest(rubric);
}
