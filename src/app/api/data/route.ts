import { NextResponse } from "next/server";
import { exportUserData, getDb, resetUserData } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Local-first escape hatch: the whole study record is one JSON document. */
export async function GET() {
  return new NextResponse(JSON.stringify(exportUserData(), null, 1), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="quiz-progress-${Date.now()}.json"`,
    },
  });
}

/** 每类记录的必填字段与类型；导入前整体校验，坏行直接 400，绝不写一半。 */
const REQUIRED: Record<string, Record<string, "string" | "number">> = {
  sessions: { id: "number", mode: "string" },
  attempts: { id: "number", question_id: "string", correct: "number" },
  wrongBook: { question_id: "string", wrong_count: "number" },
  favorites: { question_id: "string" },
  notes: { question_id: "string", text: "string" },
  tags: { id: "number", name: "string" },
  questionTags: { question_id: "string", tag_id: "number" },
};

function validateBackup(body: Record<string, unknown>): string | null {
  for (const [key, spec] of Object.entries(REQUIRED)) {
    const rows = body[key];
    if (rows === undefined) continue;
    if (!Array.isArray(rows)) return `${key} 应为数组`;
    if (rows.length > 200_000) return `${key} 超过行数上限`;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as Record<string, unknown>;
      if (!row || typeof row !== "object") return `${key}[${i}] 不是对象`;
      for (const [field, kind] of Object.entries(spec)) {
        const v = row[field];
        if (kind === "number" && !Number.isFinite(v as number)) return `${key}[${i}].${field} 缺失或不是数字`;
        if (kind === "string" && typeof v !== "string") return `${key}[${i}].${field} 缺失或不是字符串`;
      }
    }
  }
  return null;
}

export async function POST(req: Request) {
  const body = (await req.json()) as ReturnType<typeof exportUserData>;
  if (!body || !Array.isArray(body.attempts)) {
    return NextResponse.json({ error: "unrecognised backup file" }, { status: 400 });
  }
  const problem = validateBackup(body as unknown as Record<string, unknown>);
  if (problem) {
    return NextResponse.json({ error: `备份文件不合法：${problem}` }, { status: 400 });
  }
  const db = getDb();
  const tx = db.transaction(() => {
    db.exec(`DELETE FROM attempts; DELETE FROM sessions; DELETE FROM wrong_book;
             DELETE FROM favorites; DELETE FROM notes; DELETE FROM question_tags; DELETE FROM tags;`);
    for (const r of body.sessions ?? []) {
      db.prepare(`INSERT INTO sessions (id,title,mode,scope,total,correct,duration_ms,started_at,finished_at)
                  VALUES (@id,@title,@mode,@scope,@total,@correct,@duration_ms,@started_at,@finished_at)`).run(r);
    }
    for (const r of body.attempts) {
      db.prepare(`INSERT INTO attempts (id,question_id,session_id,answer,correct,duration_ms,mode,created_at)
                  VALUES (@id,@question_id,@session_id,@answer,@correct,@duration_ms,@mode,@created_at)`).run(r);
    }
    for (const r of body.wrongBook ?? []) {
      db.prepare(`INSERT INTO wrong_book (question_id,wrong_count,first_at,last_at,status,note,box,next_review,resolved_at)
                  VALUES (@question_id,@wrong_count,@first_at,@last_at,@status,@note,@box,@next_review,@resolved_at)`).run(r);
    }
    for (const r of body.favorites ?? []) {
      db.prepare(`INSERT OR IGNORE INTO favorites (question_id,added_at,note) VALUES (@question_id,@added_at,@note)`).run(r);
    }
    for (const r of body.notes ?? []) {
      db.prepare(`INSERT OR IGNORE INTO notes (question_id,text,updated_at) VALUES (@question_id,@text,@updated_at)`).run(r);
    }
    for (const r of body.tags ?? []) {
      db.prepare(`INSERT OR IGNORE INTO tags (id,name) VALUES (@id,@name)`).run(r);
    }
    for (const r of body.questionTags ?? []) {
      db.prepare(`INSERT OR IGNORE INTO question_tags (question_id,tag_id) VALUES (@question_id,@tag_id)`).run(r);
    }
  });
  tx();
  return NextResponse.json({ ok: true, attempts: body.attempts.length });
}

export async function DELETE() {
  resetUserData();
  return NextResponse.json({ ok: true });
}
