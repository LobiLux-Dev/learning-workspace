/**
 * Vistas de solo lectura de §9.2: formas estrictas inferidas de la
 * especificación, compuestas con esquemas existentes. No son entradas, no
 * llevan métodos ni motor: solo estructura que Core devuelve.
 *
 * Casing: snake_case, igual que las entidades de dominio (los *inputs* de
 * comando son los únicos camelCase). Las vistas de ítems servidos
 * ({@link servedItemSchema}) **no incluyen `solution`** ni rúbrica: mostrar la
 * solución antes de responder rompería el ítem (§7.1).
 */
import { z } from 'zod';
import {
  attemptItemSnapshotSchema,
  provenanceSchema,
} from './academic.js';
import { MAX_LIST_ITEMS } from './constants.js';
import {
  digestAlgorithmSchema,
  masteryAlgorithmVersionSchema,
  masteryLabelSchema,
  releaseStateSchema,
  verificationStatusSchema,
} from './enums.js';
import { operationResultSchema } from './errors.js';
import {
  contentTextSchema,
  nameTextSchema,
  packageIdSchema,
  resourceIdSchema,
  semverSchema,
  sha256Schema,
  utcInstantSchema,
  uuidV7Schema,
} from './primitives.js';
import { portablePathSchema } from './paths.js';
import { assignmentSchema, enrollmentSchema, sessionSchema } from './portfolio.js';

/* ------------------------------------------------------------------ *
 * Notebooks instalados (§3.2, §9.2 listNotebooks/verifyNotebook)
 * ------------------------------------------------------------------ */

export const installedNotebookSchema = z
  .object({
    release_id: uuidV7Schema,
    package_uid: uuidV7Schema,
    package_id: packageIdSchema,
    name: nameTextSchema,
    version: semverSchema,
    content_digest: sha256Schema,
    digest_algorithm: digestAlgorithmSchema,
    state: releaseStateSchema,
    verification_status: verificationStatusSchema,
    /** Relativo al workspace, p. ej. `notebooks/<release_id>`; nunca elegido por un agente. */
    install_path: portablePathSchema,
    revision: z.int().min(1),
    installed_at: utcInstantSchema,
  })
  .strict()
  .meta({
    'x-runtime-validation':
      '`package_id` es namespace humano, no prueba de autoría (§3.1); `state` y `revision` los asigna Core y solo `ready` sirve fuentes académicas (§3.2).',
  });

export type InstalledNotebook = z.output<typeof installedNotebookSchema>;

export const verificationFindingSchema = z
  .object({
    kind: z.enum(['missing', 'extra', 'modified']),
    path: portablePathSchema,
    expected_sha256: sha256Schema.optional(),
    observed_sha256: sha256Schema.optional(),
    observed_size: z.int().min(0).optional(),
  })
  .strict();

export type VerificationFinding = z.output<typeof verificationFindingSchema>;

/** §3.2/§9.2: informar faltantes, extras y diferentes; nunca repara automáticamente. */
export const verificationReportSchema = z
  .object({
    release_id: uuidV7Schema,
    state: releaseStateSchema,
    verification_status: verificationStatusSchema,
    content_digest: sha256Schema,
    checked_file_count: z.int().min(0),
    findings: z.array(verificationFindingSchema).max(MAX_LIST_ITEMS),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'La cuarentena (`ready` → `quarantined`) es una mutación aparte con aprobación e idempotencia: `verifyNotebook` solo informa (§3.2, §9.2).',
  });

export type VerificationReport = z.output<typeof verificationReportSchema>;

/* ------------------------------------------------------------------ *
 * Inscripción y sesiones (§5, §9.2 getEnrollment/diagnose)
 * ------------------------------------------------------------------ */

export const enrollmentViewSchema = z
  .object({
    enrollment: enrollmentSchema,
    active_session: sessionSchema.nullable(),
    assignments: z.array(assignmentSchema).max(MAX_LIST_ITEMS),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'Vista: Core garantiza a lo sumo una sesión `active` por enrollment y que los assignments pertenezcan a su enrollment (§5.4); eso no se puede comprobar dentro de un único objeto.',
  });

export type EnrollmentView = z.output<typeof enrollmentViewSchema>;

/** Ítem servido a un agente/alumno: enunciado y contexto, **sin solución**. */
export const servedItemSchema = z
  .object({
    item_uid: uuidV7Schema,
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    assignment_uid: uuidV7Schema.nullable(),
    snapshot: attemptItemSnapshotSchema,
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'La solución y la rúbrica quedan fuera a propósito: mostrarlos antes de responder revelaría la respuesta (§7.1). La rúbrica se muestra, como mucho, tras el envío.',
  });

export type ServedItem = z.output<typeof servedItemSchema>;

/** §9.3 `diagnose`: sesión diagnóstica con ítems disponibles o explicación de ausencia. */
export const diagnosticSessionSchema = z
  .object({
    session: sessionSchema,
    enrollment_uid: uuidV7Schema,
    items: z.array(servedItemSchema).max(MAX_LIST_ITEMS),
    /** Presente cuando no hay banco ni propuestas: el CLI explica y no inventa diagnóstico. */
    unavailable_reason: z.string().max(1000).optional(),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'La sesión es `kind=diagnostic`; sin banco declarado el Core explica la ausencia en vez de generar ítems (§9.3, CAPABILITY_UNAVAILABLE).',
  });

export type DiagnosticSession = z.output<typeof diagnosticSessionSchema>;

/* ------------------------------------------------------------------ *
 * Pistas (§6.2, §9.2 serveHint)
 * ------------------------------------------------------------------ */

export const hintSchema = z
  .object({
    enrollment_uid: uuidV7Schema,
    release_id: uuidV7Schema,
    session_uid: uuidV7Schema,
    item_uid: uuidV7Schema,
    ordinal: z.int().min(1),
    hint_snapshot: contentTextSchema,
    provenance: provenanceSchema,
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'El `ordinal` consecutivo por ítem lo asigna Core bajo bloqueo y `hints_used` se fija al enviar el intento (§6.2): nunca viene del modelo.',
  });

export type Hint = z.output<typeof hintSchema>;

/* ------------------------------------------------------------------ *
 * Mastery (§7.3, §9.2 getMastery/rebuildProjections)
 * ------------------------------------------------------------------ */

/** Fila derivada de `mastery-rules-v1`. Recalculable; jamás sustituye evidencias. */
export const masteryStateSchema = z
  .object({
    enrollment_uid: uuidV7Schema,
    skill_id: resourceIdSchema,
    release_id: uuidV7Schema,
    /** 0..10000 en bps; `null` sin evidencias (n = 0). */
    score_bps: z.int().min(0).max(10000).nullable(),
    evidence_count: z.int().min(0),
    context_count: z.int().min(0),
    coverage_gap_bps: z.int().min(0).max(10000),
    label: masteryLabelSchema,
    /** Total histórico de intentos de la habilidad: se muestra, no entra en la fórmula. */
    historical_attempt_count: z.int().min(0),
    algorithm_version: masteryAlgorithmVersionSchema,
    through_event_seq: z.int().min(1),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'Las relaciones entre score/evidencia/etiqueta (ventana de 20, umbrales, coverage_gap = 10000 - min(10000, 2000·n)) las calcula Core en replay; este esquema solo acota la forma del resultado (§7.3). Sin solver ni scoring aquí.',
  });

export type MasteryState = z.output<typeof masteryStateSchema>;

export const masteryViewSchema = z
  .object({
    enrollment_uid: uuidV7Schema,
    /** `through_event_seq` congelado al iniciar el replay. */
    watermark: z.int().min(1),
    /** `true` cuando hay hechos posteriores al watermark: no presentar como actual. */
    stale: z.boolean(),
    rows: z.array(masteryStateSchema).max(MAX_LIST_ITEMS),
  })
  .strict();

export type MasteryView = z.output<typeof masteryViewSchema>;

export const rebuildReportSchema = z
  .object({
    enrollment_uid: uuidV7Schema,
    run_uid: uuidV7Schema,
    algorithm_version: masteryAlgorithmVersionSchema,
    through_event_seq: z.int().min(1),
    row_count: z.int().min(0),
    result_digest: sha256Schema,
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'Rebuild es siempre un comando explícito con clave de idempotencia; el digest excluye `run_uid`/fecha para que el mismo H dé idénticos resultados (§7.3).',
  });

export type RebuildReport = z.output<typeof rebuildReportSchema>;

/* ------------------------------------------------------------------ *
 * Recuperación y doctor (§9.2, §10.3)
 * ------------------------------------------------------------------ */

export const recoveryReportSchema = z
  .object({
    enrollment_uid: uuidV7Schema,
    pending_operations: z.array(operationResultSchema).max(MAX_LIST_ITEMS),
    failed_operations: z.array(operationResultSchema).max(MAX_LIST_ITEMS),
    current_session: sessionSchema.nullable(),
    current_assignment: assignmentSchema.nullable(),
    prepared_item_uids: z.array(uuidV7Schema).max(MAX_LIST_ITEMS),
    ungraded_attempt_uids: z.array(uuidV7Schema).max(MAX_LIST_ITEMS),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'La recuperación reconcilia planes ya aceptados y no regenera con LLM ni vuelve a aprobar nada (§6.4, §10.3).',
  });

export type RecoveryReport = z.output<typeof recoveryReportSchema>;

export const doctorFindingSchema = z
  .object({
    severity: z.enum(['error', 'warning', 'info']),
    /** Código diagnóstico en mayúsculas, p. ej. `HASH_MISMATCH`; Core lo define. */
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    message: z.string().min(1).max(1000),
    path: z.string().max(500).optional(),
    ids: z.array(z.string().min(1).max(200)).max(32).optional(),
  })
  .strict();

export type DoctorFinding = z.output<typeof doctorFindingSchema>;

/** §10.3: `doctor` solo informa. No reconcilia, no borra, no repara. */
export const doctorReportSchema = z
  .object({
    ok: z.boolean(),
    findings: z.array(doctorFindingSchema).max(MAX_LIST_ITEMS),
  })
  .strict()
  .meta({
    'x-runtime-validation':
      'El informe es solo lectura: reconciliar y reparar son comandos separados con aprobación (§10.3). SQLite ilegible se informa, no se reescribe.',
  });

export type DoctorReport = z.output<typeof doctorReportSchema>;
