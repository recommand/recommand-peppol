import { describe, expect, it } from "bun:test";
import { playgroundEmailSender } from "../data/playground/email";

describe("mailing a document from a playground", () => {
  const mailed: string[] = [];
  const send = playgroundEmailSender(["Dev@Example.com"], async ({ to }) => {
    mailed.push(to);
    return { messageId: `msg-${mailed.length}` };
  });

  it("mails a member of the team, whatever the case of the address", async () => {
    const result = await send({ to: " dev@example.COM", metadata: {} });

    expect(result).toEqual({ messageId: "msg-1" });
    expect(mailed).toEqual([" dev@example.COM"]);
  });

  it("simulates any other address without mailing it", async () => {
    const result = await send({ to: "accounting@customer.example", metadata: {} });

    expect(result).toEqual({ messageId: null, simulated: true });
    expect(mailed).toHaveLength(1);
  });
});
