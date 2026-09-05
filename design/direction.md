# Overflow: friends, spare allowance, a little help

2026-09-05. Prepared for the 0.7.0 release.

The requester keeps talking to Codex. Automatic delegation at 15% remaining
is the main path; /work is the manual shortcut. The earner runs /earn because
spare allowance today can earn credits for work later. Ask where to work before
anything else, recommending a subfolder in the current project. Display public
work to everyone; Google sign-in reveals only the visitor's own balance.

## Visual direction

- Paper #f5f5ef, charcoal #29342f, sea green #376451, muted ink #606c63,
  quiet rule #d5dbd1, pale wash #e8ede5.
- Geist for text, headings and controls, matching the calm simplicity of Nexus.
- A small wordmark and personal sign-in above an open two-column introduction.
  A single work list sits below it. Left-aligned text; no metric dashboard.
  No task counts or account breakdowns; show only the signed-in balance.
- A Mumbai shoreline drawing is the memorable element. Dark tetrapods and
  overflowing surf remain visible around the quiet work surface.

Layout:

    overflow                              Add to Codex    Sign in
    A little help from your friends.                     /earn
    Earn credits now. Use them later.
    Running low? Overflow steps in at 15%.
    [ Available | In progress | Returned | All work             ]
    [ task                       requester -> worker     state  ]
    by kushalsm.com
                    sea, spray, tetrapods, wet promenade

Review against the brief: the previous dark green terminal, seven counters,
member ledger and activity panel made this feel like infrastructure. Keep the
compact work stream, remove competing panels, and use personal credits only
behind sign-in. Sparse color comes from the water; typography stays secondary
to the original illustration. The empty board stays honest.

## Art provenance

Generated with the built-in imagegen tool. Original selected PNG: shoreline-v2.png;
web JPEG: shoreline-v2.jpg; embedded asset: relay/src/shoreline.js.
Pinterest references inspected visually:
https://in.pinterest.com/search/pins/?q=mumbai%20marine%20drive%20tetrapods%20monsoon
https://in.pinterest.com/pin/587016132724834166/
The generated artwork is an original composition, not a copied photograph.

Initial prompt (superseded by the selected crop refinement in shoreline-v2-prompt.md):

Create an original wide landscape editorial ink and watercolor illustration for
the background of Overflow, a quiet friends-sharing-compute website. Scene:
Mumbai Marine Drive during monsoon; unmistakable dark charcoal concrete tetrapod
breakwaters, interlocking chunky four-armed geometric rocks at bottom and right;
a grey-green Arabian Sea wave hits them hard, white spray spills over a low
curved seawall onto a wet promenade in the lower right. Fine expressive black
pen contour lines, restrained graphite hatching, very light muted sage/sea-glass
watercolor washes, subtle cloudy lavender-grey sky, warm pale off-white paper
#f4f5ef. Delicate hand-traced architectural travel sketch, sparse color, not
photorealistic or cartoon. Ocean horizon in upper third and tiny distant Mumbai
buildings far left. Plenty of nearly blank pale sky and open pale area in upper
left/center for a UI, with the strongest drawing concentrated across the bottom
third and right quarter. Wide 3:2 composition, high resolution. No people,
words, typography, logos, UI, border or watermark. Water should visibly overflow
the barrier but the overall composition remains calm and spacious. Rocks have
a specific sculptural tetrapod shape rather than generic boulders.
