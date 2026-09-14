import { describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  claimEmailFallbackStatement,
  noteEmailFallbackAttemptStatement,
  releaseEmailFallbackStatement,
  stalledEmailFallbacksStatement,
} from "../data/deliveries/email-fallback-consume";

// The shape of these statements is what makes taking a request atomic and correct:
// the request must be read from a locked selection made before the update, because
// an update's RETURNING clause yields the row after the update, and the claim must
// exclude a request another run is holding. The database is not needed to assert the
// shape; a container run asserts the behaviour (see test/db).

const now = new Date("2026-09-10T12:00:00Z");
const staleBefore = new Date("2026-09-10T11:45:00Z");

function compact(statement: { toSQL(): { sql: string; params: unknown[] } }) {
  const { sql, params } = statement.toSQL();
  return { sql: sql.replace(/\s+/g, " "), params };
}

describe("the statement that takes a document's email fallback for a run", () => {
  const { sql, params } = compact(
    claimEmailFallbackStatement(drizzle.mock(), "doc_1", { now, staleBefore })
  );

  it("locks the row while the request is there and unheld, in a common table expression", () => {
    expect(sql).toMatch(
      /^with "taken" as \(select .*"email_fallback" from "peppol_transmitted_documents" where \("peppol_transmitted_documents"\."id" = \$1 and "peppol_transmitted_documents"\."email_fallback" is not null and .*\) for update\) update /
    );
    expect(params[0]).toBe("doc_1");
  });

  it("passes over a request a run started on recently, and takes over one left by a run that died", () => {
    expect(sql).toContain(
      `(("peppol_transmitted_documents"."email_fallback"->>'startedAt')::timestamptz is null or ("peppol_transmitted_documents"."email_fallback"->>'startedAt')::timestamptz < $2)`
    );
    expect(params[1]).toEqual(staleBefore);
  });

  it("marks the request started rather than clearing it, and returns the value read before the update", () => {
    expect(sql).toContain(
      `set "email_fallback" = "taken"."email_fallback" || jsonb_build_object('startedAt', $3::text)`
    );
    expect(params[2]).toBe(now.toISOString());
    expect(sql).toContain('from "taken" where "peppol_transmitted_documents"."id" = "taken"."id"');
    expect(sql).toMatch(/returning .*"taken"\."email_fallback"$/);
    // Nothing is returned from the updated row itself.
    expect(sql.split(" returning ")[1]).not.toContain('"peppol_transmitted_documents"."');
  });
});

describe("the statement that notes an address before its message leaves", () => {
  const { sql, params } = compact(
    noteEmailFallbackAttemptStatement(drizzle.mock(), "doc_1", "a@example.com", "dlv_1")
  );

  it("adds the address to the request's attempts without touching the rest of it", () => {
    expect(sql).toContain(
      `set "email_fallback" = jsonb_set("peppol_transmitted_documents"."email_fallback" || jsonb_build_object('attempts', coalesce("peppol_transmitted_documents"."email_fallback"->'attempts', '{}'::jsonb)), array['attempts', $1], $2::jsonb, true)`
    );
    expect(params).toEqual(["a@example.com", JSON.stringify({ deliveryId: "dlv_1" }), "doc_1"]);
  });

  it("writes nothing once the request is closed", () => {
    expect(sql).toContain(
      `where ("peppol_transmitted_documents"."id" = $3 and "peppol_transmitted_documents"."email_fallback" is not null)`
    );
  });
});

describe("the statement that hands a request back after a failed run", () => {
  const { sql, params } = compact(releaseEmailFallbackStatement(drizzle.mock(), "doc_1"));

  it("drops only the start time, so what the run noted survives", () => {
    expect(sql).toContain(
      `set "email_fallback" = "peppol_transmitted_documents"."email_fallback" - 'startedAt'`
    );
    expect(sql).toContain(
      `where ("peppol_transmitted_documents"."id" = $1 and "peppol_transmitted_documents"."email_fallback" is not null)`
    );
    expect(params).toEqual(["doc_1"]);
  });
});

describe("the statement that finds the fallbacks a stopped run left half done", () => {
  const { sql, params } = compact(stalledEmailFallbacksStatement(drizzle.mock(), staleBefore, 20));

  it("takes the requests with attempts noted that no live run holds, oldest first and bounded", () => {
    expect(sql).toContain(`"peppol_transmitted_documents"."email_fallback" ? 'attempts'`);
    expect(sql).toContain(
      `(("peppol_transmitted_documents"."email_fallback"->>'startedAt')::timestamptz is null or ("peppol_transmitted_documents"."email_fallback"->>'startedAt')::timestamptz < $1)`
    );
    expect(sql).toContain('order by "peppol_transmitted_documents"."id" limit $2');
    expect(params).toEqual([staleBefore, 20]);
  });
});
