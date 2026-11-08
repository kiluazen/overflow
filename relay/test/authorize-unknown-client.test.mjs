// /authorize with a client the server doesn't know (expired, deleted, typo)
// must answer with a 4xx page, not a bare 500. A vanished ChatGPT client
// 500'd every Nexus connect for ~22h on 2026-11-07.
import { SELF } from "cloudflare:test";
import { expect, it } from "vitest";

it("answers an unknown client_id with a 400 page, not a 500", async () => {
  const res = await SELF.fetch(
    "https://overflow.kushalsm.com/authorize?response_type=code&client_id=doesnotexist"
      + "&redirect_uri=http%3A%2F%2Flocalhost%3A3118%2Fcallback"
      + "&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=x",
    { redirect: "manual" },
  );
  expect(res.status).toBe(400);
  expect(res.headers.get("location")).toBeNull();
  expect(await res.text()).toContain("This connection request isn");
});
