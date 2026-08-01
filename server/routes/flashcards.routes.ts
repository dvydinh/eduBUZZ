import { Router } from "express";
import { z } from "zod";
import db from "../db.js";
import { requireAuth } from "../middleware.js";
import multer from "multer";
import path from "node:path";

const router = Router();

/* ------------------------------------------------------------------ */
/*  SM-2 Spaced Repetition Algorithm                                   */
/* ------------------------------------------------------------------ */

function sm2(quality: number, prev: { ease_factor: number; interval_days: number; repetitions: number }) {
  let { ease_factor, interval_days, repetitions } = prev;

  if (quality >= 3) {
    // Correct / known
    if (repetitions === 0) {
      interval_days = 1;
    } else if (repetitions === 1) {
      interval_days = 6;
    } else {
      interval_days = Math.round(interval_days * ease_factor);
    }
    repetitions += 1;
  } else {
    // Incorrect / unknown — reset
    repetitions = 0;
    interval_days = 0;
  }

  ease_factor = Math.max(1.3, ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

  const next_review = new Date();
  next_review.setDate(next_review.getDate() + interval_days);

  return { ease_factor, interval_days, repetitions, next_review: next_review.toISOString(), last_reviewed: new Date().toISOString() };
}

/* ------------------------------------------------------------------ */
/*  GET /api/courses/:courseId/flashcards — list decks                  */
/* ------------------------------------------------------------------ */

router.get("/courses/:courseId/flashcards", requireAuth, async (req, res) => {
  const { data: rows, error } = await db
    .from("flashcard_decks")
    .select("*, flashcard_cards(id)")
    .eq("course_id", req.params.courseId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("List flashcard decks error:", error);
    res.status(500).json({ error: "Failed to fetch flashcard decks" });
    return;
  }

  // Map to include card count
  const decks = (rows || []).map((d: any) => ({
    id: d.id,
    course_id: d.course_id,
    name: d.name,
    description: d.description,
    created_by: d.created_by,
    created_at: d.created_at,
    card_count: d.flashcard_cards?.length || 0,
  }));

  res.json(decks);
});

/* ------------------------------------------------------------------ */
/*  POST /api/courses/:courseId/flashcards — create deck                */
/* ------------------------------------------------------------------ */

const deckSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(500).default(""),
});

router.post("/courses/:courseId/flashcards", requireAuth, async (req, res) => {
  const parsed = deckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const { data: course } = await db.from("courses").select("id").eq("id", req.params.courseId).maybeSingle();
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const { data: deck, error } = await db
    .from("flashcard_decks")
    .insert({
      course_id: req.params.courseId,
      name: parsed.data.name,
      description: parsed.data.description,
      created_by: req.user!.userId,
    })
    .select()
    .single();

  if (error) {
    console.error("Create deck error:", error);
    res.status(500).json({ error: "Failed to create deck" });
    return;
  }

  res.status(201).json({ ...deck, card_count: 0 });
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/flashcards/:deckId — delete deck (only creator)        */
/* ------------------------------------------------------------------ */

router.delete("/flashcards/:deckId", requireAuth, async (req, res) => {
  const deckId = Number(req.params.deckId);
  const { data: deck } = await db.from("flashcard_decks").select("created_by").eq("id", deckId).maybeSingle();

  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }
  if (deck.created_by !== req.user!.userId) {
    res.status(403).json({ error: "Only the creator can delete this deck" });
    return;
  }

  await db.from("flashcard_decks").delete().eq("id", deckId);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  GET /api/flashcards/:deckId/cards — list cards (sorted by SR)      */
/* ------------------------------------------------------------------ */

router.get("/flashcards/:deckId/cards", requireAuth, async (req, res) => {
  const deckId = Number(req.params.deckId);
  const userId = req.user!.userId;

  // Fetch all cards
  const { data: cards, error } = await db
    .from("flashcard_cards")
    .select("*")
    .eq("deck_id", deckId)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("List cards error:", error);
    res.status(500).json({ error: "Failed to fetch cards" });
    return;
  }

  // Fetch user's progress for these cards
  const cardIds = (cards || []).map((c: any) => c.id);
  let progressMap: Record<number, any> = {};

  if (cardIds.length > 0) {
    const { data: progress } = await db
      .from("flashcard_progress")
      .select("*")
      .eq("user_id", userId)
      .in("card_id", cardIds);

    if (progress) {
      progress.forEach((p: any) => {
        progressMap[p.card_id] = p;
      });
    }
  }

  // Merge and sort by next_review (soonest first = needs review most)
  const now = new Date();
  const merged = (cards || []).map((c: any) => {
    const prog = progressMap[c.id];
    return {
      ...c,
      progress: prog ? {
        ease_factor: prog.ease_factor,
        interval_days: prog.interval_days,
        repetitions: prog.repetitions,
        next_review: prog.next_review,
        last_reviewed: prog.last_reviewed,
      } : null,
      _sort: prog ? new Date(prog.next_review).getTime() : 0, // No progress = needs review first
    };
  });

  // Sort: cards that need review soonest come first
  merged.sort((a: any, b: any) => a._sort - b._sort);

  // Remove internal sort key
  const result = merged.map(({ _sort, ...rest }: any) => rest);

  res.json(result);
});

/* ------------------------------------------------------------------ */
/*  POST /api/flashcards/:deckId/cards — add card                      */
/* ------------------------------------------------------------------ */

const cardSchema = z.object({
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(1000),
  image_url: z.string().max(2000).optional(),
});

router.post("/flashcards/:deckId/cards", requireAuth, async (req, res) => {
  const deckId = Number(req.params.deckId);
  const parsed = cardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const { data: deck } = await db.from("flashcard_decks").select("id").eq("id", deckId).maybeSingle();
  if (!deck) {
    res.status(404).json({ error: "Deck not found" });
    return;
  }

  // Get max sort_order
  const { data: maxRow } = await db
    .from("flashcard_cards")
    .select("sort_order")
    .eq("deck_id", deckId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data: card, error } = await db
    .from("flashcard_cards")
    .insert({
      deck_id: deckId,
      front: parsed.data.front,
      back: parsed.data.back,
      image_url: parsed.data.image_url || null,
      sort_order: sortOrder,
      created_by: req.user!.userId,
    })
    .select()
    .single();

  if (error) {
    console.error("Create card error:", error);
    res.status(500).json({ error: "Failed to create card" });
    return;
  }

  res.status(201).json(card);
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/flashcards/cards/:cardId — delete card (only creator)   */
/* ------------------------------------------------------------------ */

router.delete("/flashcards/cards/:cardId", requireAuth, async (req, res) => {
  const cardId = Number(req.params.cardId);
  const { data: card } = await db.from("flashcard_cards").select("created_by").eq("id", cardId).maybeSingle();

  if (!card) {
    res.status(404).json({ error: "Card not found" });
    return;
  }
  if (card.created_by !== req.user!.userId) {
    res.status(403).json({ error: "Only the creator can delete this card" });
    return;
  }

  await db.from("flashcard_cards").delete().eq("id", cardId);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  POST /api/flashcards/cards/:cardId/review — record review result   */
/* ------------------------------------------------------------------ */

const reviewSchema = z.object({
  quality: z.number().min(0).max(5), // 0-2 = fail, 3-5 = pass
});

router.post("/flashcards/cards/:cardId/review", requireAuth, async (req, res) => {
  const cardId = Number(req.params.cardId);
  const userId = req.user!.userId;

  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  // Get existing progress
  const { data: existing } = await db
    .from("flashcard_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("card_id", cardId)
    .maybeSingle();

  const prev = existing || { ease_factor: 2.5, interval_days: 0, repetitions: 0 };
  const updated = sm2(parsed.data.quality, prev);

  if (existing) {
    const { error } = await db
      .from("flashcard_progress")
      .update(updated)
      .eq("id", existing.id);

    if (error) {
      console.error("Update progress error:", error);
      res.status(500).json({ error: "Failed to update progress" });
      return;
    }
  } else {
    const { error } = await db
      .from("flashcard_progress")
      .insert({
        user_id: userId,
        card_id: cardId,
        ...updated,
      });

    if (error) {
      console.error("Create progress error:", error);
      res.status(500).json({ error: "Failed to create progress" });
      return;
    }
  }

  res.json({ ok: true, ...updated });
});

/* ------------------------------------------------------------------ */
/*  POST /api/flashcards/:deckId/cards/upload-image — upload card img  */
/* ------------------------------------------------------------------ */

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

router.post("/flashcards/:deckId/cards/upload-image", requireAuth, upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const ext = path.extname(file.originalname);
  const filename = `flashcards/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  const { error: storageError } = await db.storage
    .from("edubuzz-resources")
    .upload(filename, file.buffer, { contentType: file.mimetype });

  if (storageError) {
    console.error("Flashcard image upload error:", storageError);
    res.status(500).json({ error: "Failed to upload image" });
    return;
  }

  const { data: publicUrlData } = db.storage
    .from("edubuzz-resources")
    .getPublicUrl(filename);

  res.json({ url: publicUrlData.publicUrl });
});

/* ------------------------------------------------------------------ */
/*  GET /api/my-resources — personal resources + decks                 */
/* ------------------------------------------------------------------ */

router.get("/my-resources", requireAuth, async (req, res) => {
  const userId = req.user!.userId;

  const [resourcesRes, decksRes] = await Promise.all([
    db.from("resources").select("*").eq("created_by", userId).order("id", { ascending: false }),
    db.from("flashcard_decks").select("*, flashcard_cards(id)").eq("created_by", userId).order("created_at", { ascending: false }),
  ]);

  const resources = (resourcesRes.data || []).map((r: any) => ({
    id: r.id,
    course_id: r.course_id,
    name: r.name,
    size: r.size,
    file_url: r.file_url,
    type: "resource" as const,
  }));

  const decks = (decksRes.data || []).map((d: any) => ({
    id: d.id,
    course_id: d.course_id,
    name: d.name,
    description: d.description,
    card_count: d.flashcard_cards?.length || 0,
    type: "flashcard_deck" as const,
  }));

  res.json({ resources, decks });
});

export default router;
