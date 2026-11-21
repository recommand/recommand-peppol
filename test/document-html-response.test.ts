import { expect, test } from "bun:test";
import { Hono } from "hono";
import { documentHtmlResponse } from "../utils/document-renderer";

test("a rendered document is sent as HTML that loads nothing and runs no script", async () => {
  const app = new Hono().get("/", (c) => documentHtmlResponse(c, "<p>Invoice</p>"));
  const response = await app.request("/");

  expect(response.headers.get("content-type")).toStartWith("text/html");
  expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
  expect(await response.text()).toBe("<p>Invoice</p>");
});
